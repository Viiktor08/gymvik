import type { MiddlewareHandler } from "hono";

/**
 * Cabeceras de seguridad de la spec §8. public/_headers repite estos mismos
 * valores para los estáticos, que no pasan por el Worker; un test comprueba que
 * ambos coinciden.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' https: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "Strict-Transport-Security": "max-age=31536000",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
};

/**
 * Añade las cabeceras de seguridad a toda respuesta, también a las 404 y a las
 * de error (el 404 y onError de Hono se resuelven dentro de la cadena, antes de
 * que `next()` devuelva el control).
 */
export function securityHeaders(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      c.res.headers.set(name, value);
    }
  };
}
