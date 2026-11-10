import type { Context, MiddlewareHandler } from "hono";
import type { Env } from "../env";

// Los cubos con una ventana más antigua que esto se borran. Es mucho mayor que
// cualquier windowSec en uso (minutos).
const RETENTION_SEC = 24 * 60 * 60;

type RateLimitEnv = { Bindings: Env };

export type RateLimitOptions<E extends RateLimitEnv = RateLimitEnv> = {
  /** Clave del contador, por ejemplo `login:<ip>` o `hook:<id de la clave>`. */
  bucket: (c: Context<E>) => string;
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
 *
 * Un cubo que ya ha agotado su límite en la ventana actual no vuelve a escribir:
 * el `WHERE` del `DO UPDATE` lo deja como está, así que un cliente insistente no
 * genera una escritura en D1 por cada intento rechazado. El contador nunca pasa
 * de `limit`; la petición `limit + 1` y las siguientes dan 429 sin tocar la fila.
 */
export function rateLimit<E extends RateLimitEnv = RateLimitEnv>(options: RateLimitOptions<E>): MiddlewareHandler<E> {
  const { bucket, limit, windowSec } = options;
  return async (c, next) => {
    const now = Math.floor(Date.now() / 1000);
    const key = bucket(c);
    const row = await c.env.DB.prepare(
      `INSERT INTO rate_limits (bucket, window_start, count) VALUES (?1, ?2, 1)
       ON CONFLICT (bucket) DO UPDATE SET
         count = CASE WHEN window_start <= ?3 THEN 1 ELSE count + 1 END,
         window_start = CASE WHEN window_start <= ?3 THEN ?2 ELSE window_start END
       WHERE window_start <= ?3 OR count < ?4
       RETURNING count, window_start`,
    )
      .bind(key, now, now - windowSec, limit)
      .first<{ count: number; window_start: number }>();

    if (row === null) {
      // Cubo agotado en la ventana actual: no se ha escrito nada. Solo falta saber cuándo se abre la siguiente.
      const current = await c.env.DB.prepare("SELECT window_start FROM rate_limits WHERE bucket = ?")
        .bind(key)
        .first<{ window_start: number }>();
      c.header("Retry-After", String(Math.max(1, (current?.window_start ?? now) + windowSec - now)));
      return c.json({ error: "Demasiadas peticiones" }, 429);
    }

    // Una ventana nueva es el momento oportuno para limpiar las caducadas.
    if (row.count === 1) {
      await c.env.DB.prepare("DELETE FROM rate_limits WHERE window_start < ?")
        .bind(now - RETENTION_SEC)
        .run();
    }
    return next();
  };
}
