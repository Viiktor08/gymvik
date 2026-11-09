import { Hono } from "hono";
import type { Env } from "./env";

export const app = new Hono<{ Bindings: Env }>();

// Público: lo usan la CI y las comprobaciones de despliegue.
app.get("/api/health", (c) => c.json({ ok: true }));

export default {
  fetch: app.fetch,
  // Sin efecto hasta la Tarea 16 (avisos push cada 15 minutos).
  async scheduled(_controller, _env, _ctx) {},
} satisfies ExportedHandler<Env>;
