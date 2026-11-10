import type { NotificationType } from "../../shared/types";

/** Una suscripción push de un dispositivo, tal como la guarda `push_subscriptions`. */
export type Subscription = { endpoint: string; p256dh: string; auth: string };

/** Todas las suscripciones, de la más antigua a la más reciente. */
export async function listSubscriptions(db: D1Database): Promise<Subscription[]> {
  const { results } = await db
    .prepare("SELECT endpoint, p256dh, auth FROM push_subscriptions ORDER BY created_at, rowid")
    .all<Subscription>();
  return results;
}

/** Guarda la suscripción; si el endpoint ya existía, solo actualiza sus claves. */
export async function upsertSubscription(db: D1Database, sub: Subscription): Promise<void> {
  await db
    .prepare(
      `INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES (?1, ?2, ?3)
       ON CONFLICT (endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`,
    )
    .bind(sub.endpoint, sub.p256dh, sub.auth)
    .run();
}

/** Borra la suscripción. False si no existía. */
export async function deleteSubscription(db: D1Database, endpoint: string): Promise<boolean> {
  const { results } = await db
    .prepare("DELETE FROM push_subscriptions WHERE endpoint = ? RETURNING endpoint")
    .bind(endpoint)
    .all();
  return results.length === 1;
}

/** Los avisos ya enviados en ese día local (YYYY-MM-DD). */
export async function listSentOn(db: D1Database, localDate: string): Promise<Set<NotificationType>> {
  const { results } = await db
    .prepare("SELECT type FROM notifications_sent WHERE local_date = ?")
    .bind(localDate)
    .all<{ type: NotificationType }>();
  return new Set(results.map((row) => row.type));
}

/** Anota que el aviso `type` ya se envió ese día. Anotarlo dos veces no hace nada. */
export async function markSent(db: D1Database, type: NotificationType, localDate: string): Promise<void> {
  await db
    .prepare("INSERT OR IGNORE INTO notifications_sent (type, local_date) VALUES (?, ?)")
    .bind(type, localDate)
    .run();
}
