// Envío de avisos push (spec §6): cifrado aes128gcm (RFC 8291) y firma VAPID (RFC 8292) con WebCrypto, que es
// lo que ofrece workerd. La librería `web-push` de Node no sirve aquí (usa los módulos http y crypto de Node).
import { buildPushPayload } from "@block65/webcrypto-web-push";
import type { PushMessage } from "../../shared/notifications";
import { type Subscription, deleteSubscription } from "../db/push";
import type { Env } from "../env";

/** Firma de `sendPush`. `runNotifications` recibe una función de este tipo para poder simularla en los tests. */
export type SendPush = (sub: Subscription, msg: PushMessage, env: Env) => Promise<{ gone: boolean }>;

// Si el dispositivo está sin conexión, el servicio de push guarda el aviso este tiempo. Una hora: pasado
// eso el texto ("Llevas 4.210 de 8.000 pasos") ya no es de fiar y el cron enviará el del día siguiente.
const TTL_SECONDS = 60 * 60;
// Un servicio de push que no contesta no debe dejar colgada la tarea programada.
const TIMEOUT_MS = 10_000;

/**
 * Envía `msg` a una suscripción. `gone` es true si el servicio de push responde 404 o 410: la suscripción
 * ya no existe y hay que borrarla. Cualquier otra respuesta que no sea 2xx, o un fallo de red, lanza un
 * error: el aviso no llegó, pero la suscripción puede seguir siendo válida.
 */
export const sendPush: SendPush = async (sub, msg, env) => {
  const payload = await buildPushPayload(
    // El cuerpo cifrado es el JSON de PushMessage; el service worker lo lee con `event.data.json()`.
    { data: JSON.stringify(msg), options: { ttl: TTL_SECONDS } },
    { endpoint: sub.endpoint, expirationTime: null, keys: { p256dh: sub.p256dh, auth: sub.auth } },
    { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY },
  );
  const response = await fetch(sub.endpoint, { ...payload, signal: AbortSignal.timeout(TIMEOUT_MS) });
  // El cuerpo no interesa; se descarta para liberar la conexión.
  await response.body?.cancel();
  if (response.status === 404 || response.status === 410) return { gone: true };
  if (!response.ok) throw new Error(`El servicio de push respondió ${response.status}`);
  return { gone: false };
};

export type Delivery = {
  /** Suscripciones a las que llegó el aviso. */
  sent: number;
  /** Suscripciones que fallaron (red, 5xx, 429…). Se conservan: el fallo puede ser pasajero. */
  failed: number;
  /** Suscripciones que el servicio de push dio por inexistentes (404 o 410). Ya están borradas. */
  gone: Subscription[];
};

/**
 * Envía `msg` a todas las suscripciones. Un fallo en una no impide las demás: se anota en el registro del
 * Worker y se cuenta en `failed`. Las que devuelven `gone` se borran de la base de datos.
 */
export async function broadcast(
  env: Env,
  subs: Subscription[],
  msg: PushMessage,
  send: SendPush = sendPush,
): Promise<Delivery> {
  const outcomes = await Promise.all(
    subs.map(async (sub) => {
      try {
        return (await send(sub, msg, env)).gone ? "gone" : "sent";
      } catch (error) {
        // Sin el endpoint: es la dirección privada del dispositivo.
        console.error(`No se pudo enviar el aviso ${msg.type}`, error);
        return "failed";
      }
    }),
  );
  const gone = subs.filter((_sub, index) => outcomes[index] === "gone");
  await Promise.all(gone.map((sub) => deleteSubscription(env.DB, sub.endpoint)));
  return { sent: outcomes.filter((o) => o === "sent").length, failed: outcomes.filter((o) => o === "failed").length, gone };
}
