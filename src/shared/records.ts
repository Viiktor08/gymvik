// Récords personales y 1RM estimado. Funciones puras sobre entrenos ya cargados.
import type { Exercise, Workout, WorkoutExercise } from "./types";

export type RecordKind = "maxWeight" | "best1RM" | "volume" | "maxDistance" | "bestPace";

export interface SessionStats {
  maxWeight: number | null;
  best1RM: number | null;
  /** Σ peso × repeticiones de las series con ambos valores > 0. 0 si no hay ninguna. */
  volume: number;
  maxDistance: number | null;
  /** Mejor ritmo en min/km (menor es mejor). */
  bestPace: number | null;
}

/** Tipos de récord de los ejercicios de fuerza (cualquier categoría que no sea cardio). */
export const STRENGTH_KINDS: readonly RecordKind[] = ["maxWeight", "best1RM", "volume"];
/** Tipos de récord de los ejercicios de cardio. */
export const CARDIO_KINDS: readonly RecordKind[] = ["maxDistance", "bestPace"];

// Un valor solo cuenta si es un número finito mayor que 0; null, NaN e Infinity no aportan nada.
function positive(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

function roundToHalf(value: number): number {
  return Math.round(value * 2) / 2;
}

/**
 * 1RM estimado con Epley: peso × (1 + repeticiones / 30), redondeado al 0,5 kg más cercano.
 * Con una repetición el resultado es el propio peso. Sin peso o sin repeticiones (null, 0, negativos
 * o no finitos) devuelve null.
 */
export function epley1RM(weightKg: number | null, reps: number | null): number | null {
  if (!positive(weightKg) || !positive(reps)) return null;
  if (reps === 1) return weightKg;
  return roundToHalf(weightKg * (1 + reps / 30));
}

/**
 * Estadísticas de un ejercicio en una sesión.
 * - Fuerza: solo cuentan las series con peso y repeticiones > 0 (el peso corporal, sin peso, no da nada).
 * - Cardio: la distancia máxima es la mayor de las series con distancia > 0, y el ritmo (min/km)
 *   se calcula con las series que además tienen duración > 0.
 */
export function sessionStats(we: WorkoutExercise): SessionStats {
  let maxWeight: number | null = null;
  let best1RM: number | null = null;
  let volume = 0;
  let maxDistance: number | null = null;
  let bestPace: number | null = null;

  for (const set of we.sets) {
    if (positive(set.weightKg) && positive(set.reps)) {
      maxWeight = maxWeight === null ? set.weightKg : Math.max(maxWeight, set.weightKg);
      const oneRM = epley1RM(set.weightKg, set.reps);
      if (oneRM !== null) best1RM = best1RM === null ? oneRM : Math.max(best1RM, oneRM);
      volume += set.weightKg * set.reps;
    }
    if (positive(set.distanceKm)) {
      maxDistance = maxDistance === null ? set.distanceKm : Math.max(maxDistance, set.distanceKm);
      if (positive(set.durationMin)) {
        const pace = set.durationMin / set.distanceKm;
        if (Number.isFinite(pace)) bestPace = bestPace === null ? pace : Math.min(bestPace, pace);
      }
    }
  }

  // Redondeo a 2 decimales para que el orden de las series no cambie el volumen por ruido de coma flotante.
  return { maxWeight, best1RM, volume: Math.round(volume * 100) / 100, maxDistance, bestPace };
}

// Valor de cada tipo de récord en unas estadísticas, o null si no hay (el volumen 0 no cuenta como valor).
function statValue(stats: SessionStats, kind: RecordKind): number | null {
  if (kind === "volume") return stats.volume > 0 ? stats.volume : null;
  return stats[kind];
}

// Menor es mejor solo en el ritmo.
function isBetter(kind: RecordKind, candidate: number, current: number): boolean {
  return kind === "bestPace" ? candidate < current : candidate > current;
}

// Un ejercicio puede aparecer varias veces en un entreno: sus series se juntan en un único valor.
function combinedStatsByExercise(workout: Workout): Map<string, SessionStats> {
  const sets = new Map<string, WorkoutExercise>();
  for (const we of workout.exercises) {
    const existing = sets.get(we.exerciseId);
    sets.set(
      we.exerciseId,
      existing
        ? { exerciseId: we.exerciseId, sets: [...existing.sets, ...we.sets] }
        : { exerciseId: we.exerciseId, sets: we.sets },
    );
  }
  return new Map([...sets].map(([exerciseId, we]) => [exerciseId, sessionStats(we)]));
}

/**
 * Récords que `workout` bate respecto a `previous`. Un récord solo es nuevo si ya había un valor anterior
 * de ese mismo tipo y el actual lo supera estrictamente: la primera vez que se hace un ejercicio no se celebra.
 * - Se ignora el entreno de `previous` con el mismo `id` (un reintento del PUT) y los que no empezaron
 *   antes que `workout`.
 * - Fuerza (`category !== "cardio"`): peso máximo, 1RM y volumen. Cardio: distancia máxima y mejor ritmo.
 * - Un ejercicio que no esté en `exercises` se ignora, porque no se sabe qué récords le tocan.
 * - Como mucho sale un récord por ejercicio y tipo.
 */
export function newRecords(
  workout: Workout,
  previous: Workout[],
  exercises: Map<string, Exercise>,
): { exerciseId: string; kind: RecordKind; value: number }[] {
  const startedAt = Date.parse(workout.startedAt);
  const earlier = previous.filter((p) => p.id !== workout.id && Date.parse(p.startedAt) < startedAt);
  const earlierStats = earlier.map(combinedStatsByExercise);

  const records: { exerciseId: string; kind: RecordKind; value: number }[] = [];
  for (const [exerciseId, stats] of combinedStatsByExercise(workout)) {
    const exercise = exercises.get(exerciseId);
    if (!exercise) continue;
    const kinds = exercise.category === "cardio" ? CARDIO_KINDS : STRENGTH_KINDS;

    for (const kind of kinds) {
      const value = statValue(stats, kind);
      if (value === null) continue;

      let best: number | null = null;
      for (const byExercise of earlierStats) {
        const past = byExercise.get(exerciseId);
        const pastValue = past ? statValue(past, kind) : null;
        if (pastValue !== null && (best === null || isBetter(kind, pastValue, best))) best = pastValue;
      }

      if (best !== null && isBetter(kind, value, best)) records.push({ exerciseId, kind, value });
    }
  }
  return records;
}

/**
 * Mejor valor de cada tipo de récord de un ejercicio y la fecha local en que se logró. Omite los tipos
 * sin valor. Si un valor se repite en varios entrenos, conserva el primero que lo logró.
 */
export function exerciseRecords(
  exerciseId: string,
  workouts: Workout[],
): Partial<Record<RecordKind, { value: number; localDate: string }>> {
  const records: Partial<Record<RecordKind, { value: number; localDate: string }>> = {};
  const chronological = [...workouts].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));

  for (const workout of chronological) {
    const stats = combinedStatsByExercise(workout).get(exerciseId);
    if (!stats) continue;
    for (const kind of [...STRENGTH_KINDS, ...CARDIO_KINDS]) {
      const value = statValue(stats, kind);
      if (value === null) continue;
      const current = records[kind];
      if (!current || isBetter(kind, value, current.value)) records[kind] = { value, localDate: workout.localDate };
    }
  }
  return records;
}
