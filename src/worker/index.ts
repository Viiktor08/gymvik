import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Env } from "./env";
import { securityHeaders } from "./security/headers";
import { requireSameOrigin } from "./security/origin";

export const app = new Hono<{ Bindings: Env }>();

app.use("*", securityHeaders());
app.use("/api/*", requireSameOrigin());

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

export default {
  fetch: app.fetch,
  // Sin efecto hasta la Tarea 16 (avisos push cada 15 minutos).
  async scheduled(_controller, _env, _ctx) {},
} satisfies ExportedHandler<Env>;
