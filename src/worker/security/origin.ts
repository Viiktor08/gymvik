import type { MiddlewareHandler } from "hono";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Con la barra final: /api/hook-keys NO es un hook. Los hooks de los Atajos se autentican con su propia
// clave Bearer, no con la cookie de sesión, así que quedan fuera de la puerta de sesión y del control CSRF.
export const HOOK_PREFIX = "/api/hook/";

/**
 * Defensa CSRF (spec §8): los métodos que modifican datos deben llevar una
 * cabecera `Origin` igual a la del propio sitio. Un `Origin` ausente también se
 * rechaza. Los hooks de los Atajos (`/api/hook/*`) quedan exentos porque no usan
 * cookie de sesión, sino una clave Bearer.
 */
export function requireSameOrigin(): MiddlewareHandler {
  return async (c, next) => {
    if (!MUTATING_METHODS.has(c.req.method) || c.req.path.startsWith(HOOK_PREFIX)) {
      return next();
    }
    if (c.req.header("Origin") !== new URL(c.req.url).origin) {
      return c.json({ error: "Origen no permitido" }, 403);
    }
    return next();
  };
}
