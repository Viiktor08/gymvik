import { prefillSets } from "../../shared/prefill";
import { NEW_REPS_TARGET } from "../../shared/routineDiff";
import type { Category, DraftSet, Exercise, Routine, SetEntry } from "../../shared/types";
import type { Draft } from "./draftStore";

// Operaciones puras sobre el borrador de la sesión: cada una devuelve un borrador nuevo (o el mismo, si la
// operación no tiene efecto) y no toca el original.

type DraftExercise = Draft["exercises"][number];
export type SetField = "weightKg" | "reps" | "rir" | "durationMin" | "distanceKm";

function emptySet(): DraftSet {
  return { weightKg: null, reps: null, rir: null, durationMin: null, distanceKm: null, done: false };
}

function withExercise(draft: Draft, index: number, change: (exercise: DraftExercise) => DraftExercise | null): Draft {
  const current = draft.exercises[index];
  if (!current) return draft;
  const next = change(current);
  if (next === null || next === current) return draft;
  return { ...draft, exercises: draft.exercises.map((exercise, i) => (i === index ? next : exercise)) };
}

export function setField(draft: Draft, exercise: number, set: number, field: SetField, value: number | null): Draft {
  return withExercise(draft, exercise, (current) =>
    current.sets[set] === undefined
      ? null
      : { ...current, sets: current.sets.map((row, i) => (i === set ? { ...row, [field]: value } : row)) },
  );
}

export function toggleDone(draft: Draft, exercise: number, set: number): Draft {
  return withExercise(draft, exercise, (current) =>
    current.sets[set] === undefined
      ? null
      : { ...current, sets: current.sets.map((row, i) => (i === set ? { ...row, done: !row.done } : row)) },
  );
}

/** Una serie más, con los valores de la última y sin hacer (como cuando la rutina pide más series que la última vez). */
export function addSet(draft: Draft, exercise: number): Draft {
  return withExercise(draft, exercise, (current) => {
    const last = current.sets[current.sets.length - 1];
    return { ...current, sets: [...current.sets, last ? { ...last, done: false } : emptySet()] };
  });
}

/** Quita la última serie. Un ejercicio no se queda sin series: para quitarlo entero está `removeExercise`. */
export function removeLastSet(draft: Draft, exercise: number): Draft {
  return withExercise(draft, exercise, (current) =>
    current.sets.length <= 1 ? null : { ...current, sets: current.sets.slice(0, -1) },
  );
}

export function moveExercise(draft: Draft, exercise: number, by: -1 | 1): Draft {
  const target = exercise + by;
  const moved = draft.exercises[exercise];
  const other = draft.exercises[target];
  if (!moved || !other) return draft;
  const exercises = [...draft.exercises];
  exercises[exercise] = other;
  exercises[target] = moved;
  return { ...draft, exercises };
}

export function removeExercise(draft: Draft, exercise: number): Draft {
  if (!draft.exercises[exercise]) return draft;
  return { ...draft, exercises: draft.exercises.filter((_, i) => i !== exercise) };
}

/** Cambia un ejercicio por otro en el mismo sitio: series nuevas, mismo descanso. */
export function replaceExercise(draft: Draft, exercise: number, exerciseId: string, sets: DraftSet[]): Draft {
  return withExercise(draft, exercise, (current) => ({ ...current, exerciseId, sets }));
}

export function appendExercise(draft: Draft, exercise: DraftExercise): Draft {
  return { ...draft, exercises: [...draft.exercises, exercise] };
}

/**
 * Las series de un ejercicio que entra en mitad de la sesión: por defecto 3 de fuerza (una de cardio), con la
 * última vez si la hay. Al cambiar un ejercicio por otro se pide el mismo número de filas (`count`).
 */
export function newExerciseSets(category: Category, last: SetEntry[] | null, count?: number): DraftSet[] {
  const cardio = category === "cardio";
  return prefillSets({ sets: count ?? (cardio ? 1 : 3), repsTarget: cardio ? "" : NEW_REPS_TARGET }, last, category);
}

/** El borrador con el que empieza una rutina: sus ejercicios en orden, con las series prerrellenadas. */
export function draftFromRoutine(
  routine: Routine,
  catalog: ReadonlyMap<string, Pick<Exercise, "category">>,
  lasts: Readonly<Record<string, SetEntry[] | null>>,
  id: string,
  startedAt: Date,
): Draft {
  const items = [...routine.items].sort((a, b) => a.position - b.position);
  return {
    id,
    routineId: routine.id,
    startedAt: startedAt.toISOString(),
    exercises: items.map((item) => ({
      exerciseId: item.exerciseId,
      restSeconds: item.restSeconds,
      sets: prefillSets(item, lasts[item.exerciseId] ?? null, catalog.get(item.exerciseId)?.category ?? "strength"),
    })),
  };
}
