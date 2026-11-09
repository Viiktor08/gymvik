// Qué avisos push toca enviar ahora. Función pura: la tarea programada del Worker (cada 15 minutos)
// le pasa el estado ya leído de la base de datos y envía lo que devuelva. Las reglas están en la spec §6.
import { addDays, daysLeftInWeek, formatThousands, localDate, localTime } from "./dates";
import { streakWeeks, weekProgress } from "./streak";
import type { NotificationType, Settings } from "./types";

export interface NotificationState {
  /** Instante actual; la fecha y la hora locales salen de `settings.timezone`. */
  now: Date;
  settings: Settings;
  /** Tipos que ya se enviaron hoy (tabla `notifications_sent`). */
  sentToday: Set<NotificationType>;
  /** Fechas locales (YYYY-MM-DD) de todos los entrenos, con repetidos si hubo más de uno en un día. */
  workoutDates: string[];
  /** Rutina que toca hoy, o null si no hay ninguna en rotación. */
  next: { name: string; exerciseCount: number } | null;
  creatineToday: boolean;
  /** Pasos de hoy, o null si el Atajo todavía no ha enviado nada. */
  stepsToday: number | null;
  /** Fecha local del último peso apuntado, o null si nunca se ha apuntado. */
  lastWeightDate: string | null;
}

export interface PushMessage {
  type: NotificationType;
  title: string;
  body: string;
  url: string;
}

const TITLE = "Gymvik";

// Orden en el que se devuelven los avisos cuando hay varios pendientes.
const ORDER: NotificationType[] = ["today", "creatine", "steps", "streak", "weight"];

function plural(n: number, one: string, many: string): string {
  return `${formatThousands(n)} ${n === 1 ? one : many}`;
}

function streakBody(s: NotificationState, today: string, missing: number, daysLeft: number): string {
  const missingText = `${missing === 1 ? "Te falta" : "Te faltan"} ${plural(missing, "entreno", "entrenos")}`;
  const daysText = `${daysLeft === 1 ? "queda" : "quedan"} ${plural(daysLeft, "día", "días")}`;
  // La semana actual está sin cumplir (missing > 0), así que la racha son solo las semanas ya cerradas.
  const streak = streakWeeks(s.workoutDates, s.settings.weeklyGoal, today);
  const ending = streak >= 1 ? `para mantener ${plural(streak, "semana", "semanas")} 🔥` : "para cumplir la semana";
  return `${missingText} y ${daysText} ${ending}`;
}

/** Mensaje de `type` si su condición se cumple con el estado dado, o null si no toca avisar. */
function message(type: NotificationType, s: NotificationState, today: string): PushMessage | null {
  switch (type) {
    case "today": {
      if (s.next === null || s.workoutDates.includes(today)) return null;
      const exercises = plural(s.next.exerciseCount, "ejercicio", "ejercicios");
      return { type, title: TITLE, body: `Hoy toca ${s.next.name} (${exercises})`, url: "/" };
    }
    case "creatine": {
      if (s.creatineToday) return null;
      return { type, title: TITLE, body: "¿Creatina? Aún no la has marcado hoy", url: "/" };
    }
    case "steps": {
      const steps = s.stepsToday ?? 0;
      const goal = s.settings.stepsGoal;
      if (steps >= goal) return null;
      const body = `Llevas ${formatThousands(steps)} de ${formatThousands(goal)} pasos`;
      return { type, title: TITLE, body, url: "/" };
    }
    case "streak": {
      const missing = s.settings.weeklyGoal - weekProgress(s.workoutDates, today).count;
      const daysLeft = daysLeftInWeek(today);
      if (!(missing > 0 && missing >= daysLeft)) return null;
      return { type, title: TITLE, body: streakBody(s, today, missing, daysLeft), url: "/entreno" };
    }
    case "weight": {
      // Las fechas YYYY-MM-DD se ordenan igual como texto que como fechas.
      if (s.lastWeightDate !== null && s.lastWeightDate > addDays(today, -7)) return null;
      return { type, title: TITLE, body: "Hace una semana que no apuntas tu peso", url: "/?peso=1" };
    }
  }
}

/**
 * Avisos que toca enviar ahora. Un aviso sale si está activado, la hora local ya ha pasado la suya
 * (HH:MM, así que basta comparar el texto), no se ha enviado hoy y se cumple su condición.
 */
export function dueNotifications(s: NotificationState): PushMessage[] {
  const tz = s.settings.timezone;
  const today = localDate(s.now, tz);
  const time = localTime(s.now, tz);

  const due: PushMessage[] = [];
  for (const type of ORDER) {
    const config = s.settings.notifications[type];
    if (!config.enabled || time < config.time || s.sentToday.has(type)) continue;
    const msg = message(type, s, today);
    if (msg !== null) due.push(msg);
  }
  return due;
}
