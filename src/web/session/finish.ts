import { formatThousands, localDate, weekStart } from "../../shared/dates";
import type { RecordKind } from "../../shared/records";
import type { Exercise, Workout, WorkoutExercise } from "../../shared/types";
import { weeklySummary } from "../../shared/weekly";
import { formatDecimal, formatPace } from "../format";
import type { Draft } from "./draftStore";

// El servidor rechaza con un 400 lo que no cumple el esquema, y un 400 saca el entreno de la cola para siempre:
// lo que se envía tiene que cumplirlo aunque el campo admita escribir "-5" o un RIR de 12.
function nonNegative(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value >= 0 ? value : null;
}

function whole(value: number | null, max = Number.MAX_SAFE_INTEGER): number | null {
  const found = nonNegative(value);
  return found === null ? null : Math.min(max, Math.round(found));
}

const MAX_RIR = 10;

/**
 * Las series marcadas ✓ de cada ejercicio, sin el campo `done` y con los valores dentro de lo que admite el
 * servidor (nada negativo, repeticiones y RIR enteros, RIR de 0 a 10). Los ejercicios sin ninguna marcada no salen.
 */
export function doneExercises(draft: Draft): WorkoutExercise[] {
  const exercises: WorkoutExercise[] = [];
  for (const exercise of draft.exercises) {
    const sets = exercise.sets
      .filter((set) => set.done)
      .map((set) => ({
        weightKg: nonNegative(set.weightKg),
        reps: whole(set.reps),
        rir: whole(set.rir, MAX_RIR),
        durationMin: nonNegative(set.durationMin),
        distanceKm: nonNegative(set.distanceKm),
      }));
    if (sets.length > 0) exercises.push({ exerciseId: exercise.exerciseId, sets });
  }
  return exercises;
}

export function countDoneSets(draft: Draft): number {
  return draft.exercises.reduce((total, exercise) => total + exercise.sets.filter((set) => set.done).length, 0);
}

/**
 * El entreno a guardar: solo lo marcado ✓. `localDate` se calcula con la zona del móvil para completar el tipo;
 * el servidor lo recalcula con la zona de los ajustes y descarta este valor.
 */
export function buildWorkout(draft: Draft, options: { endedAt: Date; notes: string; timeZone: string }): Workout {
  return {
    id: draft.id,
    routineId: draft.routineId,
    startedAt: draft.startedAt,
    endedAt: options.endedAt.toISOString(),
    localDate: localDate(new Date(draft.startedAt), options.timeZone),
    notes: options.notes,
    source: "live",
    exercises: doneExercises(draft),
  };
}

// Máximo de series de un ejercicio en una rutina (routineSchema).
const MAX_ROUTINE_SETS = 20;

/** La estructura de la sesión tal como está en pantalla (todas las filas, marcadas o no): lo que se lleva a la rutina. */
export function structureOf(draft: Draft): { exerciseId: string; sets: number }[] {
  return draft.exercises.map((exercise) => ({
    exerciseId: exercise.exerciseId,
    sets: Math.min(MAX_ROUTINE_SETS, exercise.sets.length),
  }));
}

export type SessionTotals = {
  durationMin: number;
  volumeKg: number;
  sets: number;
  cardioMin: number;
  cardioKm: number;
};

/** Lo que enseña el resumen, calculado en el móvil con las mismas reglas que el resto de la app (`weeklySummary`). */
export function sessionTotals(workout: Workout, catalog: Map<string, Exercise>): SessionTotals {
  const week = weeklySummary(weekStart(workout.localDate), {
    workouts: [workout],
    steps: [],
    creatineDates: [],
    exercises: catalog,
  });
  const elapsed = (Date.parse(workout.endedAt) - Date.parse(workout.startedAt)) / 60000;
  return {
    durationMin: Number.isFinite(elapsed) && elapsed > 0 ? Math.round(elapsed) : 0,
    // Redondeo a 2 decimales: el orden de las sumas no deja ruido de coma flotante.
    volumeKg: Math.round(week.volumeKg * 100) / 100,
    sets: workout.exercises.reduce((total, exercise) => total + exercise.sets.length, 0),
    cardioMin: Math.round(week.cardioMin * 100) / 100,
    cardioKm: Math.round(week.cardioKm * 100) / 100,
  };
}

/** Un récord nuevo en palabras: el nombre del ejercicio y qué marca es, con su valor y su unidad. */
export function describeRecord(
  record: { exerciseId: string; kind: RecordKind; value: number },
  names: ReadonlyMap<string, string>,
): { name: string; label: string } {
  const name = names.get(record.exerciseId) ?? "Ejercicio";
  switch (record.kind) {
    case "maxWeight":
      return { name, label: `Peso máximo: ${formatDecimal(record.value)} kg` };
    case "best1RM":
      return { name, label: `1RM estimado: ${formatDecimal(record.value)} kg` };
    case "volume":
      return { name, label: `Volumen: ${formatThousands(record.value)} kg` };
    case "maxDistance":
      return { name, label: `Mayor distancia: ${formatDecimal(record.value)} km` };
    case "bestPace":
      return { name, label: `Mejor ritmo: ${formatPace(record.value)}` };
  }
}

/** Los récords nuevos agrupados por ejercicio, en el orden en que salen, con una línea por marca. */
export function groupRecords(
  records: { exerciseId: string; kind: RecordKind; value: number }[],
  names: ReadonlyMap<string, string>,
): { name: string; labels: string[] }[] {
  const byExercise = new Map<string, { name: string; labels: string[] }>();
  for (const record of records) {
    const { name, label } = describeRecord(record, names);
    const group = byExercise.get(record.exerciseId) ?? { name, labels: [] };
    group.labels.push(label);
    byExercise.set(record.exerciseId, group);
  }
  return [...byExercise.values()];
}
