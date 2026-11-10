import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Env } from "../env";
import { randomToken, sha256Hex } from "../security/crypto";
import { hashRecoveryCode } from "./recovery";

export const SESSION_COOKIE = "__Host-session";

/** La sesión caduca tras 30 días sin uso: cada uso la renueva. */
export const SESSION_TTL_SEC = 30 * 24 * 60 * 60;

type AppContext = Context<{ Bindings: Env }>;

function expiresAt(nowMs: number): string {
  return new Date(nowMs + SESSION_TTL_SEC * 1000).toISOString();
}

/**
 * Crea una sesión y devuelve su token en claro (solo viaja en la cookie); en la
 * base de datos queda únicamente su hash SHA-256. De paso borra las sesiones
 * caducadas, para que la tabla no crezca.
 */
export async function createSession(db: D1Database): Promise<string> {
  const token = randomToken(32);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  await db.batch([
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(nowIso),
    db
      .prepare("INSERT INTO sessions (token_hash, created_at, last_seen_at, expires_at) VALUES (?1, ?2, ?2, ?3)")
      .bind(await sha256Hex(token), nowIso, expiresAt(now)),
  ]);
  return token;
}

/**
 * Canjea un código de recuperación. Si es válido, lo marca como usado, borra
 * TODAS las sesiones (un dispositivo perdido o robado deja de tener acceso) y
 * abre una sola nueva; devuelve su token. Si el código no existe o ya se usó,
 * no toca nada y devuelve `null`: los dos casos son indistinguibles desde fuera.
 *
 * Va en un único lote, que D1 ejecuta como una transacción sin intercalar otras
 * peticiones. La sesión nueva solo se inserta si el código sigue sin usar, y
 * solo entonces el borrado encuentra su token y vacía las demás; el código se
 * consume al final. Con peticiones simultáneas con el mismo código, el lote de
 * las que pierden no inserta ni borra nada, así que no pueden dejar sin sesión
 * a la ganadora.
 */
export async function recoverSession(db: D1Database, code: string): Promise<string | null> {
  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  const codeHash = await hashRecoveryCode(code);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const [, , consumed] = await db.batch([
    db
      .prepare(
        `INSERT INTO sessions (token_hash, created_at, last_seen_at, expires_at)
         SELECT ?1, ?2, ?2, ?3
         WHERE EXISTS (SELECT 1 FROM recovery_codes WHERE code_hash = ?4 AND used_at IS NULL)`,
      )
      .bind(tokenHash, nowIso, expiresAt(now), codeHash),
    db
      .prepare(
        "DELETE FROM sessions WHERE token_hash <> ?1 AND EXISTS (SELECT 1 FROM sessions WHERE token_hash = ?1)",
      )
      .bind(tokenHash),
    db
      .prepare("UPDATE recovery_codes SET used_at = ?1 WHERE code_hash = ?2 AND used_at IS NULL")
      .bind(nowIso, codeHash),
  ]);
  return consumed?.meta.changes === 1 ? token : null;
}

/**
 * Valida la cookie de sesión de la petición y, si es válida, la renueva
 * (`last_seen_at` y `expires_at`) en una sola sentencia. Devuelve el token o
 * `null` si falta, no existe o ha caducado.
 */
export async function authenticateSession(c: AppContext): Promise<string | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const now = Date.now();
  const row = await c.env.DB.prepare(
    `UPDATE sessions SET last_seen_at = ?1, expires_at = ?2
     WHERE token_hash = ?3 AND expires_at > ?1
     RETURNING token_hash`,
  )
    .bind(new Date(now).toISOString(), expiresAt(now), await sha256Hex(token))
    .first();
  return row === null ? null : token;
}

const COOKIE_ATTRIBUTES = {
  path: "/",
  secure: true,
  httpOnly: true,
  sameSite: "Strict",
} as const;

// `__Host-` exige Secure, Path=/ y ningún Domain: Hono lo comprueba al serializar.
export function setSessionCookie(c: AppContext, token: string): void {
  setCookie(c, SESSION_COOKIE, token, { ...COOKIE_ATTRIBUTES, maxAge: SESSION_TTL_SEC });
}

/** Abre una sesión nueva y la entrega en la cookie de la respuesta. */
export async function openSession(c: AppContext): Promise<void> {
  setSessionCookie(c, await createSession(c.env.DB));
}

/** Cierra la sesión de la petición: la borra de la base de datos y expira la cookie. */
export async function closeSession(c: AppContext): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
  }
  deleteCookie(c, SESSION_COOKIE, COOKIE_ATTRIBUTES);
}

/**
 * Exige una sesión válida (cookie `__Host-session`); si no, responde 401. Al
 * pasar, la renueva y vuelve a enviar la cookie para que su `Max-Age` también
 * se alargue; si la ruta ya puso una cookie (cerrar sesión), no la pisa.
 */
export function requireSession(): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    const token = await authenticateSession(c);
    if (token === null) return c.json({ error: "No autenticado" }, 401);
    await next();
    if (!c.res.headers.has("Set-Cookie")) setSessionCookie(c, token);
  };
}
