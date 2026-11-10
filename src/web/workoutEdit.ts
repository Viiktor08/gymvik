import type { SetEntry, WorkoutExercise } from "../shared/types";
import type { SetField } from "./session/draftOps";
import { sanitizeSet } from "./session/finish";

// Operaciones puras sobre los ejercicios de un entreno ya guardado (o de uno que se apunta a mano). Cada una
// devuelve una lista nueva, o la misma si no tienen efecto, y no toca la original.

export function blankSet(): SetEntry {
  return { weightKg: null, reps: null, rir: null, durationMin: null, distanceKm: null };
}

function withExercise(
  exercises: WorkoutExercise[],
  index: number,
  change: (exercise: WorkoutExercise) => WorkoutExercise | null,
): WorkoutExercise[] {
  const current = exercises[index];
  if (!current) return exercises;
  const next = change(current);
  if (next === null) return exercises;
  return exercises.map((exercise, i) => (i === index ? next : exercise));
}

/** Una serie más con los valores de la última (lo normal es repetir peso), o en blanco si no había ninguna. */
export function addSetTo(exercises: WorkoutExercise[], exercise: number): WorkoutExercise[] {
  return withExercise(exercises, exercise, (current) => {
    const last = current.sets[current.sets.length - 1];
    return { ...current, sets: [...current.sets, last ? { ...last } : blankSet()] };
  });
}

export function removeSetFrom(exercises: WorkoutExercise[], exercise: number, set: number): WorkoutExercise[] {
  return withExercise(exercises, exercise, (current) =>
    current.sets[set] === undefined ? null : { ...current, sets: current.sets.filter((_, i) => i !== set) },
  );
}

export function setSetField(
  exercises: WorkoutExercise[],
  exercise: number,
  set: number,
  field: SetField,
  value: number | null,
): WorkoutExercise[] {
  return withExercise(exercises, exercise, (current) =>
    current.sets[set] === undefined
      ? null
      : { ...current, sets: current.sets.map((row, i) => (i === set ? { ...row, [field]: value } : row)) },
  );
}

export function removeExerciseAt(exercises: WorkoutExercise[], exercise: number): WorkoutExercise[] {
  return exercises[exercise] === undefined ? exercises : exercises.filter((_, i) => i !== exercise);
}

/** Añade el ejercicio al final con una serie en blanco, lista para rellenar. */
export function addExerciseTo(exercises: WorkoutExercise[], exerciseId: string): WorkoutExercise[] {
  return [...exercises, { exerciseId, sets: [blankSet()] }];
}

function isBlank(set: SetEntry): boolean {
  return (
    set.weightKg === null && set.reps === null && set.rir === null && set.durationMin === null && set.distanceKm === null
  );
}

/**
 * Lo que se envía al servidor: cada serie con valores que admite (nada negativo, repeticiones y RIR enteros,
 * RIR de 0 a 10), sin las series en blanco y sin los ejercicios que se quedan sin ninguna.
 */
export function cleanExercises(exercises: readonly WorkoutExercise[]): WorkoutExercise[] {
  const cleaned: WorkoutExercise[] = [];
  for (const exercise of exercises) {
    const sets = exercise.sets.map(sanitizeSet).filter((set) => !isBlank(set));
    if (sets.length > 0) cleaned.push({ exerciseId: exercise.exerciseId, sets });
  }
  return cleaned;
}
