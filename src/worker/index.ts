import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { WebAuthnVerifiers } from "./auth/passkeys";
import { PUBLIC_AUTH_ROUTES, authRoutes } from "./auth/routes";
import { requireSession } from "./auth/session";
import type { Env } from "./env";
import { securityHeaders } from "./security/headers";
import { requireSameOrigin } from "./security/origin";

// Con la barra final: /api/hook-keys NO es un hook. Los hooks de los Atajos se
// autentican con su propia clave Bearer, no con la cookie de sesión.
const HOOK_PREFIX = "/api/hook/";

// Rutas /api/* que no exigen sesión (`MÉTODO ruta`). Todo lo demás, exista ya o
// no, pasa por requireSession.
const PUBLIC_ROUTES: ReadonlySet<string> = new Set(["GET /api/health", ...PUBLIC_AUTH_ROUTES]);

function isPublic(method: string, path: string): boolean {
  if (path.startsWith(HOOK_PREFIX)) return true;
  // Hono atiende HEAD con el manejador de GET.
  return PUBLIC_ROUTES.has(`${method === "HEAD" ? "GET" : method} ${path}`);
}

/**
 * Monta la app completa. Los verificadores WebAuthn se pueden sustituir (solo
 * los tests lo hacen) sin cambiar el resto de la cadena: cabeceras, CSRF y
 * puerta de sesión son los de producción.
 */
export function createApp(webauthn: Partial<WebAuthnVerifiers> = {}) {
  const app = new Hono<{ Bindings: Env }>();
  const session = requireSession();

  app.use("*", securityHeaders());
  app.use("/api/*", requireSameOrigin());
  app.use("/api/*", (c, next) => (isPublic(c.req.method, c.req.path) ? next() : session(c, next)));

  // Públicos y sin detalles internos: el Worker solo atiende /api/* (ver
  // run_worker_first en wrangler.jsonc), así que las respuestas son siempre JSON.
  app.notFound((c) => c.json({ error: "No encontrado" }, 404));
  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json({ error: err.message }, err.status);
    }
    // El detalle se queda en los registros del Worker, nunca en la respuesta.
    console.error(err);
    return c.json({ error: "Error interno" }, 500);
  });

  // Público: lo usan la CI y las comprobaciones de despliegue.
  app.get("/api/health", (c) => c.json({ ok: true }));
  app.route("/api/auth", authRoutes(webauthn));

  return app;
}

export const app = createApp();

export default {
  fetch: app.fetch,
  // Sin efecto hasta la Tarea 16 (avisos push cada 15 minutos).
  async scheduled(_controller, _env, _ctx) {},
} satisfies ExportedHandler<Env>;
