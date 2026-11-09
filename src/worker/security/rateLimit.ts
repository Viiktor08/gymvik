import type { Context, MiddlewareHandler } from "hono";
import type { Env } from "../env";

// Los cubos con una ventana más antigua que esto se borran. Es mucho mayor que
// cualquier windowSec en uso (minutos).
const RETENTION_SEC = 24 * 60 * 60;

export type RateLimitOptions = {
  /** Clave del contador, por ejemplo `login:<ip>` o `hook:<id de la clave>`. */
  bucket: (c: Context<{ Bindings: Env }>) => string;
  /** Peticiones permitidas por ventana. */
  limit: number;
  /** Duración de la ventana, en segundos. */
  windowSec: number;
};

/**
 * Limita las peticiones por cubo con una ventana fija que empieza en la primera
 * petición. Responde 429 al superar `limit`. El contador vive en `rate_limits`
 * y se actualiza con una única sentencia, así que es atómico aunque lleguen
 * peticiones simultáneas.
 */
export function rateLimit(options: RateLimitOptions): MiddlewareHandler<{ Bindings: Env }> {
  const { bucket, limit, windowSec } = options;
  return async (c, next) => {
    const now = Math.floor(Date.now() / 1000);
    const row = await c.env.DB.prepare(
      `INSERT INTO rate_limits (bucket, window_start, count) VALUES (?1, ?2, 1)
       ON CONFLICT (bucket) DO UPDATE SET
         count = CASE WHEN window_start <= ?3 THEN 1 ELSE count + 1 END,
         window_start = CASE WHEN window_start <= ?3 THEN ?2 ELSE window_start END
       RETURNING count, window_start`,
    )
      .bind(bucket(c), now, now - windowSec)
      .first<{ count: number; window_start: number }>();
    if (row === null) throw new Error("rate_limits no devolvió ninguna fila");

    // Una ventana nueva es el momento oportuno para limpiar las caducadas.
    if (row.count === 1) {
      await c.env.DB.prepare("DELETE FROM rate_limits WHERE window_start < ?")
        .bind(now - RETENTION_SEC)
        .run();
    }

    if (row.count > limit) {
      c.header("Retry-After", String(Math.max(1, row.window_start + windowSec - now)));
      return c.json({ error: "Demasiadas peticiones" }, 429);
    }
    return next();
  };
}
