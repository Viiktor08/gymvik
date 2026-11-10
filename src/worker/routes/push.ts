import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { PushMessage } from "../../shared/notifications";
import { deleteSubscription, listSubscriptions, upsertSubscription } from "../db/push";
import type { Env } from "../env";
import { readJson } from "../http";
import { broadcast } from "../push/webpush";

// El endpoint es la dirección a la que el Worker enviará los avisos: solo https:// (RFC 8030), igual que
// exige la librería de push.
const endpointSchema = z
  .string()
  .max(2048)
  .regex(/^https:\/\//i)
  .pipe(z.url({ protocol: /^https$/ }));

// Claves en base64url, como las entrega `PushSubscription.toJSON()` (p256dh: 65 bytes; auth: 16 bytes). Se
// valida el alfabeto y un tope de longitud; no el tamaño exacto, para no rechazar una variante del navegador.
const keySchema = z
  .string()
  .max(256)
  .regex(/^[A-Za-z0-9_-]+={0,2}$/);

/**
 * Cuerpo de `POST /api/push/subscribe`: lo que devuelve `PushSubscription.toJSON()` del navegador. Se ignora
 * lo demás (`expirationTime`).
 */
const subscribeSchema = z.object({
  endpoint: endpointSchema,
  keys: z.object({ p256dh: keySchema, auth: keySchema }),
});

const unsubscribeSchema = z.object({ endpoint: z.string().max(2048) });

// `PushMessage.type` solo admite los cinco avisos reales; el de prueba usa el primero.
const TEST_MESSAGE: PushMessage = { type: "today", title: "Gymvik", body: "Aviso de prueba ✓", url: "/" };

/** Rutas /api/push. La puerta de sesión y la comprobación de Origin de index.ts ya las protegen. */
export function pushRoutes(): Hono<{ Bindings: Env }> {
  const push = new Hono<{ Bindings: Env }>();

  // La clave pública VAPID, que el navegador necesita (`applicationServerKey`) para suscribirse.
  push.get("/public-key", (c) => {
    if (c.env.VAPID_PUBLIC_KEY === "") {
      throw new HTTPException(503, { message: "Las notificaciones no están configuradas" });
    }
    return c.json({ publicKey: c.env.VAPID_PUBLIC_KEY });
  });

  // Un dispositivo por endpoint: volver a suscribirse con el mismo endpoint actualiza sus claves.
  push.post("/subscribe", async (c) => {
    const { endpoint, keys } = await readJson(c, subscribeSchema);
    await upsertSubscription(c.env.DB, { endpoint, p256dh: keys.p256dh, auth: keys.auth });
    return c.json({ subscribed: true });
  });

  // Idempotente: dar de baja un endpoint que ya no está (p. ej. lo borró el cron al recibir un 410) no es un error.
  push.delete("/subscribe", async (c) => {
    const { endpoint } = await readJson(c, unsubscribeSchema);
    return c.json({ deleted: await deleteSubscription(c.env.DB, endpoint) });
  });

  // Envía el aviso de prueba a todos los dispositivos suscritos.
  push.post("/test", async (c) => {
    const delivery = await broadcast(c.env, await listSubscriptions(c.env.DB), TEST_MESSAGE);
    return c.json({ sent: delivery.sent, removed: delivery.gone.length, failed: delivery.failed });
  });

  return push;
}
