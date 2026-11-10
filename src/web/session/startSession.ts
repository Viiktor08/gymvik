import type { Exercise, Routine, SetEntry } from "../../shared/types";
import { draftFromRoutine } from "./draftOps";
import { loadDraft, type Draft } from "./draftStore";
import { LOAD_TIMEOUT_MS, loadExercises, loadLast, loadRoutines, type Cached } from "./offlineData";

/** Un borrador más viejo que esto es un entreno olvidado, no el de hoy: al pedir su rutina se pregunta qué hacer. */
export const STALE_DRAFT_MS = 12 * 3_600_000;

export type SessionContext = {
  routines: Routine[];
  /** Con los archivados: una rutina o un entreno pueden seguir teniéndolos. */
  exercises: Exercise[];
  /** Qué se hizo la última vez en cada ejercicio de la sesión (`null` si nunca). */
  lasts: Record<string, SetEntry[] | null>;
  /** Las rutinas y los ejercicios salen de la copia guardada en el móvil, no del servidor. */
  fromCache: boolean;
  /** No se pudieron cargar los ejercicios ni hay copia: el borrador se abre sin nombres de ejercicio. */
  catalogMissing: boolean;
};

export type StartOutcome =
  /** Hay sesión con la que trabajar. Si es nueva, todavía no está guardada: lo hace la pantalla. */
  | { kind: "ready"; draft: Draft; context: SessionContext }
  /**
   * Hay un entreno en curso y se ha pedido una rutina: antes de tocarlo hay que preguntar. `other`: es de otra
   * rutina (o libre); `stale`: es de la misma pero lleva olvidado más de 12 h. `routineName` es `null` si no se
   * pudo saber (rutinas sin cargar), y entonces no se puede empezar la rutina de nuevo.
   */
  | { kind: "ask"; reason: "other" | "stale"; routineName: string | null; startedAt: string }
  | { kind: "missing" };

async function loadLasts(exerciseIds: string[]): Promise<Record<string, SetEntry[] | null>> {
  const ids = [...new Set(exerciseIds)];
  const loaded = await Promise.all(ids.map(async (id) => [id, (await loadLast(id, { timeoutMs: LOAD_TIMEOUT_MS })).sets] as const));
  return Object.fromEntries(loaded);
}

/** Un fallo de la carga solo se tolera si hay un borrador al que no se puede dejar sin abrir. */
async function tolerate<T>(load: () => Promise<Cached<T[]>>, draftExists: boolean): Promise<Cached<T[]> | null> {
  try {
    return await load();
  } catch (failure) {
    if (draftExists) return null;
    throw failure;
  }
}

/**
 * Decide con qué sesión se abre la pantalla (spec §5.3):
 * - sin `routineId` (el aviso de Hoy): continúa el borrador o, si no hay, un entreno libre;
 * - con `routineId`: si el borrador es de esa misma rutina y es de hoy (menos de 12 h), lo continúa; si es de
 *   esa rutina pero está olvidado, o es de otra cosa, pregunta (salvo `replace`, que ya lo ha aprobado el
 *   usuario); si no hay borrador, empieza la rutina.
 * Un entreno ya empezado no puede quedarse sin abrir por un fallo del servidor ni por no tener copia: con
 * borrador, cualquier fallo cae a la instantánea y, sin ella, se abre con nombres genéricos.
 * Sin red usa la instantánea local. No guarda nada: eso lo hace la pantalla al montarse, así que montarla
 * dos veces (StrictMode) no deja dos sesiones.
 */
export async function beginSession(
  routineId: string | null,
  replace: boolean,
  now: Date = new Date(),
  newId: () => string = () => crypto.randomUUID(),
): Promise<StartOutcome> {
  // Sin IndexedDB no hay borrador que continuar: se sigue como si no lo hubiera.
  const saved = await loadDraft().catch(() => null);
  const existing = replace ? null : saved;
  const draftExists = existing !== null;

  const [routines, exercises] = await Promise.all([
    tolerate(() => loadRoutines({ timeoutMs: LOAD_TIMEOUT_MS, anyFailure: draftExists }), draftExists),
    tolerate(() => loadExercises({ archived: true, timeoutMs: LOAD_TIMEOUT_MS, anyFailure: draftExists }), draftExists),
  ]);
  const base = {
    routines: routines?.data ?? [],
    exercises: exercises?.data ?? [],
    fromCache: (routines?.fromCache ?? true) || (exercises?.fromCache ?? true),
    catalogMissing: exercises === null,
  };

  const routine = routineId === null ? null : (base.routines.find((candidate) => candidate.id === routineId) ?? null);

  if (existing) {
    const sameRoutine = existing.routineId === routineId;
    const stale = now.getTime() - Date.parse(existing.startedAt) > STALE_DRAFT_MS;
    if (routineId === null || (sameRoutine && !stale)) {
      const lasts = await loadLasts(existing.exercises.map((exercise) => exercise.exerciseId));
      return { kind: "ready", draft: existing, context: { ...base, lasts } };
    }
    // Una rutina que ya no existe (con las rutinas bien cargadas) no se puede empezar ni preguntar por ella.
    if (!sameRoutine && !routine && routines !== null) return { kind: "missing" };
    return {
      kind: "ask",
      reason: sameRoutine ? "stale" : "other",
      routineName: routine?.name ?? null,
      startedAt: existing.startedAt,
    };
  }

  if (routineId !== null && !routine) return { kind: "missing" };

  if (!routine) {
    const draft: Draft = { id: newId(), routineId: null, startedAt: now.toISOString(), exercises: [] };
    return { kind: "ready", draft, context: { ...base, lasts: {} } };
  }

  const lasts = await loadLasts(routine.items.map((item) => item.exerciseId));
  const catalog = new Map(base.exercises.map((exercise) => [exercise.id, exercise]));
  return { kind: "ready", draft: draftFromRoutine(routine, catalog, lasts, newId(), now), context: { ...base, lasts } };
}
