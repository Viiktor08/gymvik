import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { Env } from "../env";
import { readJson } from "../http";
import { rateLimit } from "../security/rateLimit";
import { sha256Hex } from "../security/crypto";
import {
  addPasskey,
  challengeChecker,
  countPasskeys,
  createAuthenticationOptions,
  createRegistrationOptions,
  defaultVerifiers,
  deletePasskey,
  findPasskey,
  insertPasskeyStatement,
  listPasskeys,
  updatePasskeyCounter,
  type WebAuthnVerifiers,
} from "./passkeys";
import {
  consumeRecoveryCode,
  generateRecoveryCodes,
  hashRecoveryCode,
  insertRecoveryCodeStatements,
  regenerateRecoveryCodes,
} from "./recovery";
import { authenticateSession, closeSession, openSession, setSessionCookie } from "./session";

type AppContext = Context<{ Bindings: Env }>;

/**
 * Rutas de auth que se pueden llamar sin sesión (`MÉTODO ruta`). El resto de
 * /api/auth/* exige sesión; el control está en la puerta de src/worker/index.ts.
 */
export const PUBLIC_AUTH_ROUTES: readonly string[] = [
  "GET /api/auth/me",
  "POST /api/auth/setup/options",
  "POST /api/auth/setup/verify",
  "POST /api/auth/login/options",
  "POST /api/auth/login/verify",
  "POST /api/auth/recover",
];

// --- Entrada ---

const base64Url = z.string().regex(/^[A-Za-z0-9_-]+$/);

const clientExtensionResults = z.record(z.string(), z.unknown()).default({});

// Respuestas JSON de @simplewebauthn/browser. Se valida la forma y los tamaños;
// la comprobación criptográfica la hace la librería.
const registrationResponseSchema = z.object({
  id: base64Url.max(1400),
  rawId: base64Url.max(1400),
  type: z.literal("public-key"),
  authenticatorAttachment: z.enum(["platform", "cross-platform"]).optional(),
  clientExtensionResults,
  response: z.object({
    clientDataJSON: base64Url.max(8192),
    attestationObject: base64Url.max(32768),
    authenticatorData: base64Url.max(8192).optional(),
    transports: z.array(z.string().max(32)).max(10).optional(),
    publicKeyAlgorithm: z.number().int().optional(),
    publicKey: base64Url.max(8192).optional(),
  }),
});

const authenticationResponseSchema = z.object({
  id: base64Url.max(1400),
  rawId: base64Url.max(1400),
  type: z.literal("public-key"),
  authenticatorAttachment: z.enum(["platform", "cross-platform"]).optional(),
  clientExtensionResults,
  response: z.object({
    clientDataJSON: base64Url.max(8192),
    authenticatorData: base64Url.max(8192),
    signature: base64Url.max(1024),
    userHandle: base64Url.max(1024).optional(),
  }),
});

const registerBodySchema = z.object({
  response: registrationResponseSchema,
  label: z.string().trim().max(60).optional(),
});

const loginBodySchema = z.object({ response: authenticationResponseSchema });

const recoverBodySchema = z.object({ code: z.string().min(1).max(64) });

// --- Utilidades ---

const LIMIT_PER_MINUTE = 10;

function clientIp(c: Context<{ Bindings: Env }>): string {
  return c.req.header("CF-Connecting-IP") ?? "unknown";
}

function limitByIp(group: string) {
  return rateLimit({ bucket: (c) => `${group}:${clientIp(c)}`, limit: LIMIT_PER_MINUTE, windowSec: 60 });
}

/** El rpID es el hostname de la petición y el origen esperado, el del propio sitio. */
function relyingParty(c: AppContext): { rpID: string; origin: string } {
  const url = new URL(c.req.url);
  return { rpID: url.hostname, origin: url.origin };
}

/**
 * Compara el token de configuración recibido con `SETUP_TOKEN`. Se comparan los
 * hashes y, además, en tiempo constante, para que la respuesta no dependa de
 * cuántos caracteres coinciden. Un secreto vacío (mal configurado) nunca vale.
 */
async function isSetupTokenValid(c: AppContext): Promise<boolean> {
  const provided = c.req.header("X-Setup-Token") ?? "";
  const expected = c.env.SETUP_TOKEN ?? "";
  if (provided === "" || expected === "") return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([sha256Hex(provided), sha256Hex(expected)]);
  return crypto.subtle.timingSafeEqual(encoder.encode(a), encoder.encode(b));
}

// La librería entiende estas respuestas; zod ya ha comprobado su forma.
function asRegistration(response: unknown): RegistrationResponseJSON {
  return response as RegistrationResponseJSON;
}

function asAuthentication(response: unknown): AuthenticationResponseJSON {
  return response as AuthenticationResponseJSON;
}

const REGISTRATION_FAILED = "No se pudo registrar la passkey";

/**
 * Rutas /api/auth. Los verificadores WebAuthn se pueden sustituir para probar
 * el flujo sin un autenticador real; por defecto son los de la librería.
 */
export function authRoutes(deps: Partial<WebAuthnVerifiers> = {}): Hono<{ Bindings: Env }> {
  const { verifyRegistration, verifyAuthentication } = { ...defaultVerifiers, ...deps };
  const auth = new Hono<{ Bindings: Env }>();

  // Setup, login y recuperación: 10 por minuto por IP (spec §8).
  auth.use("/setup/*", limitByIp("setup"));
  auth.use("/login/*", limitByIp("login"));
  auth.use("/recover", limitByIp("recover"));

  auth.get("/me", async (c) => {
    const token = await authenticateSession(c);
    if (token !== null) setSessionCookie(c, token);
    return c.json({
      authenticated: token !== null,
      setupRequired: (await countPasskeys(c.env.DB)) === 0,
    });
  });

  // --- Primer acceso ---

  auth.post("/setup/options", async (c) => {
    if (!(await isSetupTokenValid(c))) {
      throw new HTTPException(403, { message: "Token de configuración no válido" });
    }
    if ((await countPasskeys(c.env.DB)) > 0) {
      throw new HTTPException(403, { message: "La configuración inicial ya está hecha" });
    }
    return c.json(await createRegistrationOptions(c.env.DB, relyingParty(c).rpID, "setup"));
  });

  auth.post("/setup/verify", async (c) => {
    const { response, label } = await readJson(c, registerBodySchema);
    const db = c.env.DB;
    if ((await countPasskeys(db)) > 0) {
      throw new HTTPException(403, { message: "La configuración inicial ya está hecha" });
    }

    // Sin un reto de propósito `setup` (solo se obtiene con el token) no hay registro.
    const { rpID, origin } = relyingParty(c);
    const verified = await verifyRegistration({
      response: asRegistration(response),
      expectedChallenge: challengeChecker(db, "setup"),
      expectedOrigin: origin,
      expectedRPID: rpID,
    });
    if (verified === null) throw new HTTPException(400, { message: REGISTRATION_FAILED });

    // Passkey y códigos en un único lote atómico. Si otra configuración ganó la
    // carrera, el insert de la passkey no hace nada y los códigos tampoco.
    const recoveryCodes = generateRecoveryCodes();
    const hashes = await Promise.all(recoveryCodes.map(hashRecoveryCode));
    const [first] = await db.batch([
      insertPasskeyStatement(db, verified, label ?? "", { onlyIfNone: true }),
      ...insertRecoveryCodeStatements(db, hashes, verified.credentialId),
    ]);
    if (first?.meta.changes !== 1) {
      throw new HTTPException(403, { message: "La configuración inicial ya está hecha" });
    }

    await openSession(c);
    return c.json({ recoveryCodes });
  });

  // --- Inicio de sesión ---

  auth.post("/login/options", async (c) => {
    return c.json(await createAuthenticationOptions(c.env.DB, relyingParty(c).rpID));
  });

  auth.post("/login/verify", async (c) => {
    const { response } = await readJson(c, loginBodySchema);
    const db = c.env.DB;
    const failed = new HTTPException(401, { message: "No se pudo iniciar sesión" });

    // Passkey desconocida y firma inválida dan exactamente la misma respuesta.
    const passkey = await findPasskey(db, response.id);
    if (passkey === null) throw failed;

    const { rpID, origin } = relyingParty(c);
    const verified = await verifyAuthentication({
      response: asAuthentication(response),
      expectedChallenge: challengeChecker(db, "login"),
      expectedOrigin: origin,
      expectedRPID: rpID,
      passkey,
    });
    if (verified === null) throw failed;

    await updatePasskeyCounter(db, passkey.credentialId, verified.newCounter);
    await openSession(c);
    return c.json({ ok: true });
  });

  // --- Recuperación ---

  auth.post("/recover", async (c) => {
    const { code } = await readJson(c, recoverBodySchema);
    // Código usado e inexistente son indistinguibles desde fuera.
    if (!(await consumeRecoveryCode(c.env.DB, code))) {
      throw new HTTPException(401, { message: "Código de recuperación no válido" });
    }
    await openSession(c);
    return c.json({ mustRegisterPasskey: true });
  });

  // --- Con sesión (la puerta de index.ts ya la ha exigido) ---

  auth.get("/passkeys", async (c) => c.json({ passkeys: await listPasskeys(c.env.DB) }));

  auth.post("/passkeys/options", async (c) => {
    return c.json(await createRegistrationOptions(c.env.DB, relyingParty(c).rpID, "register"));
  });

  auth.post("/passkeys/verify", async (c) => {
    const { response, label } = await readJson(c, registerBodySchema);
    const db = c.env.DB;

    const { rpID, origin } = relyingParty(c);
    const verified = await verifyRegistration({
      response: asRegistration(response),
      expectedChallenge: challengeChecker(db, "register"),
      expectedOrigin: origin,
      expectedRPID: rpID,
    });
    if (verified === null) throw new HTTPException(400, { message: REGISTRATION_FAILED });

    if (!(await addPasskey(db, verified, label ?? ""))) {
      throw new HTTPException(409, { message: "Esa passkey ya está registrada" });
    }
    return c.json({ ok: true });
  });

  auth.delete("/passkeys/:id", async (c) => {
    const outcome = await deletePasskey(c.env.DB, c.req.param("id"));
    if (outcome === "missing") throw new HTTPException(404, { message: "Passkey no encontrada" });
    if (outcome === "last") throw new HTTPException(409, { message: "No puedes borrar tu única passkey" });
    return c.json({ ok: true });
  });

  auth.post("/recovery-codes", async (c) => c.json({ recoveryCodes: await regenerateRecoveryCodes(c.env.DB) }));

  auth.post("/logout", async (c) => {
    await closeSession(c);
    return c.json({ ok: true });
  });

  return auth;
}
