import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { WebAuthnVerifiers } from "./auth/passkeys";
import { PUBLIC_AUTH_ROUTES, authRoutes } from "./auth/routes";
import { requireSession } from "./auth/session";
import type { Env } from "./env";
import { runNotifications } from "./push/cron";
import { backupRoutes } from "./routes/backup";
import { exerciseRoutes } from "./routes/exercises";
import { hookKeyRoutes, hookRoutes } from "./routes/hooks";
import { bodyMetricRoutes, creatineRoutes } from "./routes/metrics";
import { progressRoutes } from "./routes/progress";
import { pushRoutes } from "./routes/push";
import { routineRoutes } from "./routes/routines";
import { settingsRoutes } from "./routes/settings";
import { todayRoutes } from "./routes/today";
import { workoutRoutes } from "./routes/workouts";
import { securityHeaders } from "./security/headers";
import { HOOK_PREFIX, requireSameOrigin } from "./security/origin";

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
  app.route("/api/exercises", exerciseRoutes());
  app.route("/api/routines", routineRoutes());
  app.route("/api/workouts", workoutRoutes());
  app.route("/api/body-metrics", bodyMetricRoutes());
  app.route("/api/creatine", creatineRoutes());
  app.route("/api/settings", settingsRoutes());
  app.route("/api/today", todayRoutes());
  app.route("/api/progress", progressRoutes());
  app.route("/api/backup", backupRoutes());
  app.route("/api/push", pushRoutes());
  app.route("/api/hook-keys", hookKeyRoutes());
  app.route("/api/hook", hookRoutes());

  return app;
}

export const app = createApp();

export default {
  fetch: app.fetch,
  // Cada 15 minutos (triggers.crons en wrangler.jsonc): envía los avisos push que toquen.
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runNotifications(env, new Date()));
  },
} satisfies ExportedHandler<Env>;
