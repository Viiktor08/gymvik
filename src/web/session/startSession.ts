import type { Exercise, Routine, SetEntry } from "../../shared/types";
import { draftFromRoutine } from "./draftOps";
import { loadDraft, type Draft } from "./draftStore";
import { LOAD_TIMEOUT_MS, loadExercises, loadLast, loadRoutines } from "./offlineData";

export type SessionContext = {
  routines: Routine[];
  /** Con los archivados: una rutina o un entreno pueden seguir teniéndolos. */
  exercises: Exercise[];
  /** Qué se hizo la última vez en cada ejercicio de la sesión (`null` si nunca). */
  lasts: Record<string, SetEntry[] | null>;
  /** Las rutinas y los ejercicios salen de la copia guardada en el móvil, no del servidor. */
  fromCache: boolean;
};

export type StartOutcome =
  /** Hay sesión con la que trabajar. Si es nueva, todavía no está guardada: lo hace la pantalla. */
  | { kind: "ready"; draft: Draft; context: SessionContext }
  /** Hay otro entreno en curso: antes de sustituirlo hay que preguntar. */
  | { kind: "ask"; routineName: string }
  | { kind: "missing" };

async function loadLasts(exerciseIds: string[]): Promise<Record<string, SetEntry[] | null>> {
  const ids = [...new Set(exerciseIds)];
  const loaded = await Promise.all(ids.map(async (id) => [id, (await loadLast(id, { timeoutMs: LOAD_TIMEOUT_MS })).sets] as const));
  return Object.fromEntries(loaded);
}

/**
 * Decide con qué sesión se abre la pantalla (spec §5.3):
 * - sin `routineId`: continúa el borrador guardado o, si no hay, un entreno libre;
 * - con `routineId`: si el borrador es de esa misma rutina, lo continúa; si es de otra cosa, pregunta
 *   (salvo `replace`, que ya lo ha aprobado el usuario); si no hay borrador, empieza la rutina.
 * Sin red usa la instantánea local. No guarda nada: eso lo hace la pantalla al montarse, así que montarla
 * dos veces (StrictMode) no deja dos sesiones.
 */
export async function beginSession(
  routineId: string | null,
  replace: boolean,
  now: Date = new Date(),
  newId: () => string = () => crypto.randomUUID(),
): Promise<StartOutcome> {
  const [routines, exercises, saved] = await Promise.all([
    loadRoutines({ timeoutMs: LOAD_TIMEOUT_MS }),
    loadExercises({ archived: true, timeoutMs: LOAD_TIMEOUT_MS }),
    // Sin IndexedDB no hay borrador que continuar: se sigue como si no lo hubiera.
    loadDraft().catch(() => null),
  ]);
  const base = { routines: routines.data, exercises: exercises.data, fromCache: routines.fromCache || exercises.fromCache };
  const existing = replace ? null : saved;

  if (existing && (routineId === null || existing.routineId === routineId)) {
    const lasts = await loadLasts(existing.exercises.map((exercise) => exercise.exerciseId));
    return { kind: "ready", draft: existing, context: { ...base, lasts } };
  }

  const routine = routineId === null ? null : routines.data.find((candidate) => candidate.id === routineId);
  if (routineId !== null && !routine) return { kind: "missing" };
  if (existing && routine) return { kind: "ask", routineName: routine.name };

  if (!routine) {
    const draft: Draft = { id: newId(), routineId: null, startedAt: now.toISOString(), exercises: [] };
    return { kind: "ready", draft, context: { ...base, lasts: {} } };
  }

  const lasts = await loadLasts(routine.items.map((item) => item.exerciseId));
  const catalog = new Map(exercises.data.map((exercise) => [exercise.id, exercise]));
  return { kind: "ready", draft: draftFromRoutine(routine, catalog, lasts, newId(), now), context: { ...base, lasts } };
}
