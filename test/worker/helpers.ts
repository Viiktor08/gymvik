import { env } from "cloudflare:workers";
import { SESSION_COOKIE, createSession } from "../../src/worker/auth/session";

/** Origen de las peticiones de prueba: https, porque la cookie `__Host-session` exige Secure. */
export const ORIGIN = "https://example.com";

/**
 * Cabeceras de una petición con sesión iniciada: crea una sesión de verdad y
 * devuelve su cookie y el `Origin` del propio sitio (los métodos que modifican
 * datos lo exigen). Cada llamada abre una sesión nueva.
 */
export async function authed(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const token = await createSession(env.DB);
  return { Cookie: `${SESSION_COOKIE}=${token}`, Origin: ORIGIN, ...extra };
}
