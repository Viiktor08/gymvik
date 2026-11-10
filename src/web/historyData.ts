import { addDays, formatThousands, isValidLocalDate, localDate, weekStart } from "../shared/dates";
import type { Workout, WorkoutExercise } from "../shared/types";
import { formatLongDate, formatMediumDate, formatMinutes, formatShortDate } from "./format";
import { cleanExercises } from "./workoutEdit";

/** Una fila de `GET /api/workouts`. */
export type WorkoutSummary = {
  id: string;
  /** `null` es un entreno libre. */
  routineName: string | null;
  localDate: string;
  durationMin: number;
  volumeKg: number;
};

export type WeekGroup = {
  /** El lunes de la semana. */
  weekStart: string;
  workouts: WorkoutSummary[];
};

/**
 * Los entrenos agrupados por semana (lunes a domingo): las semanas de más reciente a más antigua y, dentro de
 * cada una, los entrenos por fecha descendente. A igual fecha se conserva el orden de entrada (el del servidor).
 */
export function groupByWeek(workouts: readonly WorkoutSummary[]): WeekGroup[] {
  const byWeek = new Map<string, WorkoutSummary[]>();
  for (const workout of workouts) {
    const key = weekStart(workout.localDate);
    const group = byWeek.get(key);
    if (group) group.push(workout);
    else byWeek.set(key, [workout]);
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([start, group]) => ({
      weekStart: start,
      workouts: group.sort((a, b) => (a.localDate < b.localDate ? 1 : a.localDate > b.localDate ? -1 : 0)),
    }));
}

function yearOf(date: string): number {
  return Number(date.slice(0, 4));
}

/** "Semana del 9 nov al 15 nov"; si la semana no cae entera en `currentYear`, con el año en las dos fechas. */
export function weekLabel(weekStartDate: string, currentYear: number): string {
  const end = addDays(weekStartDate, 6);
  const sameYear = yearOf(weekStartDate) === currentYear && yearOf(end) === currentYear;
  const format = sameYear ? formatShortDate : formatMediumDate;
  return `Semana del ${format(weekStartDate)} al ${format(end)}`;
}

/** "Martes, 10 de noviembre · 45 min · 4.210 kg". Sin volumen de fuerza (cardio) no se pone. */
export function summaryLine(workout: WorkoutSummary): string {
  const parts = [formatLongDate(workout.localDate), formatMinutes(workout.durationMin)];
  if (Number.isFinite(workout.volumeKg) && workout.volumeKg > 0) parts.push(`${formatThousands(workout.volumeKg)} kg`);
  return parts.join(" · ");
}

export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** La fecha de hoy según el reloj del dispositivo. */
export function deviceToday(now: Date = new Date()): string {
  return localDate(now, deviceTimeZone());
}

/**
 * El inicio de un entreno apuntado a mano: el mediodía de esa fecha en la hora del dispositivo, como instante
 * UTC (el esquema exige la `Z`). Lanza RangeError si la fecha no existe.
 */
export function manualStartedAt(date: string): string {
  if (!isValidLocalDate(date)) throw new RangeError(`Fecha no válida: "${date}" (se esperaba YYYY-MM-DD)`);
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  // setFullYear y no `new Date(year, …)`, que toma los años 0–99 por 1900–1999.
  const noon = new Date(0);
  noon.setFullYear(year, month - 1, day);
  noon.setHours(12, 0, 0, 0);
  return noon.toISOString();
}

export type ManualInput = {
  id: string;
  /** YYYY-MM-DD, ya validada con `manualError`. */
  date: string;
  routineId: string | null;
  durationMin: number;
  exercises: WorkoutExercise[];
};

/** El entreno a guardar: manual, a mediodía de la fecha elegida y con `endedAt` = inicio + duración. */
export function buildManualWorkout(input: ManualInput): Workout {
  const startedAt = manualStartedAt(input.date);
  const endedAt = new Date(Date.parse(startedAt) + Math.round(input.durationMin) * 60_000).toISOString();
  return {
    id: input.id,
    routineId: input.routineId,
    startedAt,
    endedAt,
    localDate: input.date,
    notes: "",
    source: "manual",
    exercises: cleanExercises(input.exercises),
  };
}

const MAX_MANUAL_MINUTES = 24 * 60;

/** Lo que está mal en el formulario del entreno manual, en palabras; `null` si se puede guardar. */
export function manualError(input: { date: string; today: string; durationMin: number | null }): string | null {
  if (!isValidLocalDate(input.date)) return "Elige la fecha del entreno.";
  if (input.date > input.today) return "La fecha no puede ser futura.";
  if (input.durationMin === null || !Number.isFinite(input.durationMin) || input.durationMin < 1) {
    return "Indica la duración en minutos.";
  }
  if (input.durationMin > MAX_MANUAL_MINUTES) return "La duración no puede pasar de 24 horas.";
  return null;
}

/** El cuerpo de `PUT /api/workouts/:id`: sin `localDate` (lo calcula el servidor) y con las series limpias. */
export function workoutBody(workout: Workout): Omit<Workout, "localDate"> {
  return {
    id: workout.id,
    routineId: workout.routineId,
    startedAt: workout.startedAt,
    endedAt: workout.endedAt,
    notes: workout.notes,
    source: workout.source,
    exercises: cleanExercises(workout.exercises),
  };
}
