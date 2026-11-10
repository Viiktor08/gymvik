import { sha256Hex } from "../security/crypto";

const RECOVERY_CODE_COUNT = 8;

// Alfabeto de Crockford en minúsculas (sin i, l, o, u): 32 símbolos, 5 bits cada
// uno, sin caracteres que se confundan al copiarlos a mano. Cuatro grupos de 4
// dan 80 bits por código: con el hash SHA-256 sin sal, lo bastante para que
// quien lea la tabla `recovery_codes` no pueda recuperar un código por fuerza
// bruta.
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const GROUP_LENGTH = 4;
const GROUP_COUNT = 4;
const CODE_LENGTH = GROUP_LENGTH * GROUP_COUNT;

function formatCode(symbols: string): string {
  const groups: string[] = [];
  for (let i = 0; i < symbols.length; i += GROUP_LENGTH) groups.push(symbols.slice(i, i + GROUP_LENGTH));
  return groups.join("-");
}

/**
 * Símbolos aleatorios con `crypto.getRandomValues` y muestreo por rechazo: se
 * descartan los bytes que caen en el último tramo incompleto, para que el
 * módulo no favorezca a unos símbolos (con 32 símbolos no se descarta ninguno,
 * pero el código no depende de ello).
 */
function randomSymbols(length: number): string {
  const limit = 256 - (256 % ALPHABET.length);
  let out = "";
  while (out.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length))) {
      if (byte < limit && out.length < length) out += ALPHABET.charAt(byte % ALPHABET.length);
    }
  }
  return out;
}

function generateRecoveryCode(): string {
  return formatCode(randomSymbols(CODE_LENGTH));
}

/** Códigos con formato `xxxx-xxxx-xxxx-xxxx`, distintos entre sí. */
export function generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) codes.add(generateRecoveryCode());
  return [...codes];
}

/** Tolera mayúsculas, espacios y guiones de más: `ABCD 1234 …` equivale a `abcd-1234-…`. */
function normalize(input: string): string {
  const compact = input.toLowerCase().replace(/[\s-]/g, "");
  return compact.length === CODE_LENGTH ? formatCode(compact) : compact;
}

/** Hash SHA-256 con el que se guarda (y se busca) un código. */
export function hashRecoveryCode(input: string): Promise<string> {
  return sha256Hex(normalize(input));
}

/**
 * Sentencias que guardan los hashes de los códigos. Con `onlyIfPasskey` solo
 * insertan si esa passkey existe: así el primer acceso puede ir en un único
 * lote que, si pierde una carrera, no deja códigos sueltos.
 */
export function insertRecoveryCodeStatements(
  db: D1Database,
  hashes: string[],
  onlyIfPasskey?: string,
): D1PreparedStatement[] {
  return hashes.map((hash) =>
    onlyIfPasskey === undefined
      ? db.prepare("INSERT INTO recovery_codes (code_hash) VALUES (?1)").bind(hash)
      : db
          .prepare(
            "INSERT INTO recovery_codes (code_hash) SELECT ?1 WHERE EXISTS (SELECT 1 FROM passkeys WHERE credential_id = ?2)",
          )
          .bind(hash, onlyIfPasskey),
  );
}

/** Sustituye todos los códigos (usados o no) por un juego nuevo y lo devuelve en claro. */
export async function regenerateRecoveryCodes(db: D1Database): Promise<string[]> {
  const codes = generateRecoveryCodes();
  const hashes = await Promise.all(codes.map(hashRecoveryCode));
  await db.batch([db.prepare("DELETE FROM recovery_codes"), ...insertRecoveryCodeStatements(db, hashes)]);
  return codes;
}
