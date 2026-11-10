// Cambios de estructura de una sesión respecto a su rutina. Funciones puras, sin DOM ni Workers.
import type { Routine, RoutineItem } from "./types";

// Lo único que hace falta saber de un ejercicio de la sesión: cuál es y cuántas series tiene.
type SessionExercise = { exerciseId: string; sets: unknown[] };

// Valores de un ejercicio nuevo en la rutina; los de los que ya estaban se conservan.
export const NEW_REPS_TARGET = "10";
export const NEW_REST_SECONDS = 90;

function orderedItems(routine: Routine): RoutineItem[] {
  return [...routine.items].sort((a, b) => a.position - b.position);
}

/**
 * Si la estructura de la sesión difiere de la rutina. La estructura es la lista ordenada de ejercicios
 * con su número de series: cambiar pesos o repeticiones no cuenta; añadir, quitar, cambiar o mover un
 * ejercicio, o variar su número de series, sí.
 */
export function hasStructuralChanges(routine: Routine, exercises: SessionExercise[]): boolean {
  const items = orderedItems(routine);
  if (items.length !== exercises.length) return true;
  return items.some((item, index) => {
    const exercise = exercises[index];
    return exercise === undefined || exercise.exerciseId !== item.exerciseId || exercise.sets.length !== item.sets;
  });
}

/**
 * Los ejercicios de la rutina tras guardar los cambios de la sesión: mismo orden y mismo número de series
 * que la sesión. Los ejercicios que ya estaban conservan su objetivo de repeticiones y su descanso; los
 * nuevos llevan "10" repeticiones y 90 s.
 */
export function applyWorkoutToRoutine(routine: Routine, exercises: SessionExercise[]): RoutineItem[] {
  const previous = new Map<string, RoutineItem>();
  for (const item of orderedItems(routine)) {
    if (!previous.has(item.exerciseId)) previous.set(item.exerciseId, item);
  }
  return exercises.map((exercise, position) => {
    const existing = previous.get(exercise.exerciseId);
    return {
      exerciseId: exercise.exerciseId,
      position,
      sets: exercise.sets.length,
      repsTarget: existing?.repsTarget ?? NEW_REPS_TARGET,
      restSeconds: existing?.restSeconds ?? NEW_REST_SECONDS,
    };
  });
}
