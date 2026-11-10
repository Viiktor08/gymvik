import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";

const RP_NAME = "Gymvik";
// Un solo usuario: el identificador de usuario es fijo, así todas las passkeys
// (una por dispositivo) cuelgan de la misma cuenta.
const USER_NAME = "gymvik";
const USER_ID = new Uint8Array(new TextEncoder().encode("gymvik-owner"));

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

// setup: primera passkey, con el token de configuración. register: passkey
// adicional, con sesión. login: inicio de sesión. Un reto solo vale para el
// propósito con el que se creó.
export type ChallengePurpose = "setup" | "register" | "login";

export type ExpectedChallenge = (challenge: string) => Promise<boolean>;

export type VerifiedRegistration = {
  credentialId: string;
  publicKey: Uint8Array<ArrayBuffer>;
  counter: number;
  transports: string[];
};

export type StoredPasskey = {
  credentialId: string;
  publicKey: Uint8Array<ArrayBuffer>;
  counter: number;
  transports: string[];
};

export type RegistrationVerifier = (input: {
  response: RegistrationResponseJSON;
  expectedChallenge: ExpectedChallenge;
  expectedOrigin: string;
  expectedRPID: string;
}) => Promise<VerifiedRegistration | null>;

export type AuthenticationVerifier = (input: {
  response: AuthenticationResponseJSON;
  expectedChallenge: ExpectedChallenge;
  expectedOrigin: string;
  expectedRPID: string;
  passkey: StoredPasskey;
}) => Promise<{ newCounter: number } | null>;

/** Verificadores WebAuthn: los de verdad por defecto y sustituibles en los tests. */
export type WebAuthnVerifiers = {
  verifyRegistration: RegistrationVerifier;
  verifyAuthentication: AuthenticationVerifier;
};

function logRejection(kind: string, error: unknown): void {
  // El motivo queda en los registros del Worker; al cliente solo llega un error genérico.
  console.warn(`WebAuthn: ${kind} rechazado:`, error instanceof Error ? error.message : error);
}

export const verifyRegistration: RegistrationVerifier = async (input) => {
  try {
    const result = await verifyRegistrationResponse({ ...input, requireUserPresence: true, requireUserVerification: true });
    if (!result.verified) return null;
    const { credential } = result.registrationInfo;
    return {
      credentialId: credential.id,
      publicKey: credential.publicKey,
      counter: credential.counter,
      transports: credential.transports ?? [],
    };
  } catch (error) {
    logRejection("registro", error);
    return null;
  }
};

export const verifyAuthentication: AuthenticationVerifier = async ({ passkey, ...input }) => {
  try {
    const result = await verifyAuthenticationResponse({
      ...input,
      requireUserVerification: true,
      credential: {
        id: passkey.credentialId,
        publicKey: passkey.publicKey,
        counter: passkey.counter,
        transports: passkey.transports,
      },
    });
    return result.verified ? { newCounter: result.authenticationInfo.newCounter } : null;
  } catch (error) {
    logRejection("inicio de sesión", error);
    return null;
  }
};

export const defaultVerifiers: WebAuthnVerifiers = { verifyRegistration, verifyAuthentication };

// --- Retos ---

async function saveChallenge(db: D1Database, challenge: string, purpose: ChallengePurpose): Promise<void> {
  const now = Date.now();
  // De paso se borran los retos caducados que nadie llegó a usar.
  await db.batch([
    db.prepare("DELETE FROM auth_challenges WHERE expires_at <= ?").bind(new Date(now).toISOString()),
    db
      .prepare("INSERT INTO auth_challenges (challenge, purpose, expires_at) VALUES (?, ?, ?)")
      .bind(challenge, purpose, new Date(now + CHALLENGE_TTL_MS).toISOString()),
  ]);
}

/**
 * Comprobador de reto para `expectedChallenge` de la librería. Es de un solo
 * uso (lo borra al comprobarlo, valga o no la verificación posterior), solo
 * acepta el propósito indicado y solo mientras no haya caducado.
 */
export function challengeChecker(db: D1Database, purpose: ChallengePurpose): ExpectedChallenge {
  return async (challenge) => {
    const row = await db
      .prepare(
        "DELETE FROM auth_challenges WHERE challenge = ?1 AND purpose = ?2 AND expires_at > ?3 RETURNING challenge",
      )
      .bind(challenge, purpose, new Date().toISOString())
      .first();
    return row !== null;
  };
}

// --- Opciones ---

/** Opciones para registrar una passkey (`setup` o `register`) y guarda su reto. */
export async function createRegistrationOptions(
  db: D1Database,
  rpID: string,
  purpose: "setup" | "register",
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const existing = await listPasskeys(db);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userName: USER_NAME,
    userDisplayName: RP_NAME,
    userID: USER_ID,
    // Sin nombre de usuario al entrar: la passkey tiene que ser detectable.
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    // Evita registrar dos veces el mismo autenticador.
    excludeCredentials: existing.map(({ id, transports }) => (transports.length > 0 ? { id, transports } : { id })),
  });
  await saveChallenge(db, options.challenge, purpose);
  return options;
}

/** Opciones de inicio de sesión sin `allowCredentials` (passkey detectable) y guarda su reto. */
export async function createAuthenticationOptions(
  db: D1Database,
  rpID: string,
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const options = await generateAuthenticationOptions({ rpID, userVerification: "required" });
  await saveChallenge(db, options.challenge, "login");
  return options;
}

// --- Almacén de passkeys ---

type PasskeyRow = {
  credential_id: string;
  public_key: string;
  counter: number;
  transports: string;
  created_at: string;
  label: string;
};

function parseTransports(json: string): string[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export type PasskeyInfo = { id: string; label: string; createdAt: string; transports: string[] };

/** Lista para la interfaz: nunca incluye la clave pública ni el contador. */
export async function listPasskeys(db: D1Database): Promise<PasskeyInfo[]> {
  const { results } = await db
    .prepare("SELECT credential_id, transports, created_at, label FROM passkeys ORDER BY created_at, credential_id")
    .all<PasskeyRow>();
  return results.map((row) => ({
    id: row.credential_id,
    label: row.label,
    createdAt: row.created_at,
    transports: parseTransports(row.transports),
  }));
}

export async function countPasskeys(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM passkeys").first<{ n: number }>();
  return row?.n ?? 0;
}

export async function findPasskey(db: D1Database, credentialId: string): Promise<StoredPasskey | null> {
  const row = await db
    .prepare("SELECT credential_id, public_key, counter, transports FROM passkeys WHERE credential_id = ?")
    .bind(credentialId)
    .first<PasskeyRow>();
  if (row === null) return null;
  return {
    credentialId: row.credential_id,
    publicKey: isoBase64URL.toBuffer(row.public_key),
    counter: row.counter,
    transports: parseTransports(row.transports),
  };
}

/**
 * Sentencia que guarda una passkey. Con `onlyIfNone` solo inserta si todavía no
 * hay ninguna (primer acceso): la comprobación y el insert son una sola
 * sentencia, así que dos configuraciones simultáneas no pueden ganar ambas.
 * Sin él, una credencial ya registrada no se pisa (`changes` queda en 0).
 */
export function insertPasskeyStatement(
  db: D1Database,
  passkey: VerifiedRegistration,
  label: string,
  options: { onlyIfNone?: boolean } = {},
): D1PreparedStatement {
  const values = [
    passkey.credentialId,
    isoBase64URL.fromBuffer(passkey.publicKey),
    passkey.counter,
    JSON.stringify(passkey.transports),
    label,
  ];
  const columns = "credential_id, public_key, counter, transports, label";
  return options.onlyIfNone
    ? db
        .prepare(`INSERT INTO passkeys (${columns}) SELECT ?1, ?2, ?3, ?4, ?5 WHERE NOT EXISTS (SELECT 1 FROM passkeys)`)
        .bind(...values)
    : db
        .prepare(
          `INSERT INTO passkeys (${columns}) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT (credential_id) DO NOTHING`,
        )
        .bind(...values);
}

/** Añade una passkey; `false` si esa credencial ya estaba registrada. */
export async function addPasskey(db: D1Database, passkey: VerifiedRegistration, label: string): Promise<boolean> {
  const result = await insertPasskeyStatement(db, passkey, label).run();
  return result.meta.changes === 1;
}

export async function updatePasskeyCounter(db: D1Database, credentialId: string, counter: number): Promise<void> {
  await db.prepare("UPDATE passkeys SET counter = ? WHERE credential_id = ?").bind(counter, credentialId).run();
}

/**
 * Borra una passkey salvo que sea la última y, en el mismo lote, cierra todas las
 * sesiones menos `keepTokenHash` (la de quien la quita): las sesiones no están
 * ligadas a una passkey, así que quitar la de un móvil perdido no echaría a ese
 * móvil si su sesión siguiera viva. Las dos sentencias llevan la misma condición
 * (la passkey existe y quedan otras) y D1 ejecuta el lote como una transacción:
 * dos borrados simultáneos no pueden dejar la cuenta sin ninguna passkey, y un
 * borrado que no se hace (última o inexistente) no cierra ninguna sesión.
 */
export async function deletePasskey(
  db: D1Database,
  credentialId: string,
  keepTokenHash: string,
): Promise<"deleted" | "last" | "missing"> {
  const [, deleted] = await db.batch([
    db
      .prepare(
        `DELETE FROM sessions
         WHERE token_hash <> ?1
           AND EXISTS (SELECT 1 FROM passkeys WHERE credential_id = ?2)
           AND (SELECT COUNT(*) FROM passkeys) > 1`,
      )
      .bind(keepTokenHash, credentialId),
    db
      .prepare("DELETE FROM passkeys WHERE credential_id = ? AND (SELECT COUNT(*) FROM passkeys) > 1")
      .bind(credentialId),
  ]);
  if (deleted !== undefined && deleted.meta.changes > 0) return "deleted";
  const exists = await db.prepare("SELECT 1 AS found FROM passkeys WHERE credential_id = ?").bind(credentialId).first();
  return exists === null ? "missing" : "last";
}
