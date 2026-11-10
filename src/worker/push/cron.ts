// Tarea programada (cada 15 minutos, ver `triggers.crons` en wrangler.jsonc): envía los avisos que toquen.
import { localDate } from "../../shared/dates";
import { type NotificationState, dueNotifications } from "../../shared/notifications";
import { nextRoutine } from "../../shared/rotation";
import type { NotificationType } from "../../shared/types";
import { getSteps, hasCreatine, latestBodyMetricOnOrBefore } from "../db/metrics";
import { listSentOn, listSubscriptions, markSent } from "../db/push";
import { listRoutines } from "../db/routines";
import { getSettings } from "../db/settings";
import { listWorkoutRefs } from "../db/workouts";
import type { Env } from "../env";
import { type SendPush, broadcast, sendPush } from "./webpush";

/** Lee de D1 todo lo que `dueNotifications` necesita para decidir. `today` es la fecha local de `now`. */
async function loadState(env: Env, now: Date): Promise<NotificationState & { today: string }> {
  const db = env.DB;
  const settings = await getSettings(db);
  const today = localDate(now, settings.timezone);

  const [sentToday, workouts, routines, creatineToday, stepsToday, lastWeight] = await Promise.all([
    listSentOn(db, today),
    listWorkoutRefs(db),
    listRoutines(db),
    hasCreatine(db, today),
    getSteps(db, today),
    latestBodyMetricOnOrBefore(db, today),
  ]);
  const routine = nextRoutine(routines, workouts);

  return {
    now,
    today,
    settings,
    sentToday,
    workoutDates: workouts.map((workout) => workout.localDate),
    next: routine === null ? null : { name: routine.name, exerciseCount: routine.items.length },
    creatineToday,
    stepsToday,
    lastWeightDate: lastWeight?.localDate ?? null,
  };
}

/**
 * Envía los avisos que tocan a `now` a todas las suscripciones y devuelve sus tipos. Un aviso solo se anota
 * en `notifications_sent` (y por tanto no se repite hoy) si llegó al menos a una suscripción: si falla para
 * todas, la pasada siguiente lo reintenta. Sin suscripciones no se envía ni se anota nada. Las
 * suscripciones que el servicio de push da por inexistentes se borran.
 */
export async function runNotifications(env: Env, now: Date, send: SendPush = sendPush): Promise<NotificationType[]> {
  let subs = await listSubscriptions(env.DB);
  if (subs.length === 0) return [];

  const { today, ...state } = await loadState(env, now);
  const sent: NotificationType[] = [];
  for (const message of dueNotifications(state)) {
    if (subs.length === 0) break;
    const delivery = await broadcast(env, subs, message, send);
    subs = subs.filter((sub) => !delivery.gone.includes(sub));
    if (delivery.sent === 0) continue;
    await markSent(env.DB, message.type, today);
    sent.push(message.type);
  }
  return sent;
}
