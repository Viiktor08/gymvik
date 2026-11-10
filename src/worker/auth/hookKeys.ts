import type { MiddlewareHandler } from "hono";
import { hookScopeSchema } from "../../shared/schemas";
import type { HookKey, HookScope } from "../../shared/types";
import type { Env } from "../env";
import { randomToken, sha256Hex } from "../security/crypto";

/** Entorno de los hooks: `requireHookKey` deja aquí el id de la clave que autenticó la petición. */
export type HookEnv = { Bindings: Env; Variables: { hookKeyId: string } };

// `fk_` + 32 bytes en base64url sin relleno (43 caracteres). El esquema de la cabecera no distingue
// mayúsculas (RFC 7235); la clave sí.
const BEARER_KEY = /^bearer (fk_[A-Za-z0-9_-]{43})$/i;

type HookKeyRow = {
  id: string;
  label: string;
  scopes: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

function parseScopes(text: string): HookScope[] {
  return hookScopeSchema.array().parse(JSON.parse(text));
}

/**
 * Crea una clave y devuelve su secreto en claro. Es la única vez que existe: en la base de datos queda solo
 * su hash SHA-256.
 */
export async function createHookKey(db: D1Database, label: string, scopes: HookScope[]): Promise<string> {
  const key = `fk_${randomToken(32)}`;
  await db
    .prepare("INSERT INTO hook_keys (id, label, key_hash, scopes) VALUES (?1, ?2, ?3, ?4)")
    .bind(crypto.randomUUID(), label, await sha256Hex(key), JSON.stringify(scopes))
    .run();
  return key;
}

/** Todas las claves, las más recientes primero y las revocadas incluidas. Nunca el secreto ni el hash. */
export async function listHookKeys(db: D1Database): Promise<HookKey[]> {
  const { results } = await db
    .prepare(
      `SELECT id, label, scopes, created_at, last_used_at, revoked_at FROM hook_keys
        ORDER BY created_at DESC, rowid DESC`,
    )
    .all<HookKeyRow>();
  return results.map((row) => ({
    id: row.id,
    label: row.label,
    scopes: parseScopes(row.scopes),
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  }));
}

/**
 * Revoca la clave. Es idempotente: revocar otra vez una ya revocada conserva la fecha de la primera
 * revocación. False si la clave no existe.
 */
export async function revokeHookKey(db: D1Database, id: string): Promise<boolean> {
  const row = await db
    .prepare("UPDATE hook_keys SET revoked_at = COALESCE(revoked_at, ?1) WHERE id = ?2 RETURNING id")
    .bind(new Date().toISOString(), id)
    .first();
  return row !== null;
}

/**
 * Busca la clave por su hash y, si existe y no está revocada, anota el uso en la misma sentencia (así una
 * clave revocada nunca se marca como usada). Devuelve su id y sus permisos, o null.
 */
async function useHookKey(db: D1Database, keyHash: string): Promise<{ id: string; scopes: HookScope[] } | null> {
  const row = await db
    .prepare("UPDATE hook_keys SET last_used_at = ?1 WHERE key_hash = ?2 AND revoked_at IS NULL RETURNING id, scopes")
    .bind(new Date().toISOString(), keyHash)
    .first<{ id: string; scopes: string }>();
  return row === null ? null : { id: row.id, scopes: parseScopes(row.scopes) };
}

/**
 * Autentica un hook con `Authorization: Bearer <clave>` y exige el permiso `scope`.
 * 401 si la cabecera falta, está mal formada o la clave no existe o está revocada; 403 si la clave es válida
 * pero no tiene ese permiso. La cookie de sesión no cuenta aquí.
 */
export function requireHookKey(scope: HookScope): MiddlewareHandler<HookEnv> {
  return async (c, next) => {
    const key = BEARER_KEY.exec(c.req.header("Authorization") ?? "")?.[1];
    const found = key === undefined ? null : await useHookKey(c.env.DB, await sha256Hex(key));
    if (found === null) {
      c.header("WWW-Authenticate", "Bearer");
      return c.json({ error: "Clave de atajo no válida" }, 401);
    }
    if (!found.scopes.includes(scope)) {
      return c.json({ error: "La clave no tiene permiso para esta acción" }, 403);
    }
    c.set("hookKeyId", found.id);
    return next();
  };
}
