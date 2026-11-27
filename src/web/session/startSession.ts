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

/** Qué pide quien abre la pantalla de sesión (lo dice la dirección). */
export type SessionIntent =
  /** El aviso "Continuar" de Hoy: retoma el borrador, por viejo que sea, o, si no hay, empieza uno libre. */
  | { kind: "continue" }
  /** El botón "Entreno libre": uno libre. Retoma el borrador solo si es libre y de hoy; si no, pregunta. */
  | { kind: "free" }
  | { kind: "routine"; routineId: string };

/** Lo que se quiere empezar cuando hay que preguntar: un entreno libre o una rutina (`name` es `null` si no se sabe). */
export type AskTarget = { kind: "free" } | { kind: "routine"; name: string | null };

export type StartOutcome =
  /** Hay sesión con la que trabajar. Si es nueva, todavía no está guardada: lo hace la pantalla. */
  | { kind: "ready"; draft: Draft; context: SessionContext }
  /**
   * Hay un entreno en curso y se ha pedido otra cosa: antes de tocarlo hay que preguntar. `other`: es de otra
   * rutina (o libre) que la pedida; `stale`: es de lo mismo pero lleva olvidado más de 12 h. Un `target` de
   * rutina sin nombre es que no se pudo saber (rutinas sin cargar), y entonces no se puede empezar de nuevo.
   */
  | { kind: "ask"; reason: "other" | "stale"; target: AskTarget; startedAt: string }
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
 * Decide con qué sesión se abre la pantalla:
 * - `continue` (el aviso de Hoy): continúa el borrador o, si no hay, un entreno libre;
 * - `free` (el botón Entreno libre): si el borrador es libre y es de hoy (menos de 12 h), lo continúa; si es
 *   libre pero está olvidado, o es de una rutina, pregunta (salvo `replace`, que ya lo ha aprobado el usuario);
 *   si no hay borrador, empieza un entreno libre;
 * - `routine`: si el borrador es de esa misma rutina y es de hoy (menos de 12 h), lo continúa; si es de
 *   esa rutina pero está olvidado, o es de otra cosa, pregunta (salvo `replace`); si no hay borrador,
 *   empieza la rutina.
 * Un entreno ya empezado no puede quedarse sin abrir por un fallo del servidor ni por no tener copia: con
 * borrador, cualquier fallo cae a la instantánea y, sin ella, se abre con nombres genéricos.
 * Sin red usa la instantánea local. No guarda nada: eso lo hace la pantalla al montarse, así que montarla
 * dos veces (StrictMode) no deja dos sesiones.
 */
export async function beginSession(
  intent: SessionIntent,
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

  const routineId = intent.kind === "routine" ? intent.routineId : null;
  const routine = routineId === null ? null : (base.routines.find((candidate) => candidate.id === routineId) ?? null);

  if (existing) {
    const stale = now.getTime() - Date.parse(existing.startedAt) > STALE_DRAFT_MS;
    const sameThing = existing.routineId === routineId;
    if (intent.kind === "continue" || (sameThing && !stale)) {
      const lasts = await loadLasts(existing.exercises.map((exercise) => exercise.exerciseId));
      return { kind: "ready", draft: existing, context: { ...base, lasts } };
    }
    if (intent.kind === "free") {
      // Un entreno libre no necesita las rutinas: se puede preguntar aunque no hayan cargado.
      return { kind: "ask", reason: sameThing ? "stale" : "other", target: { kind: "free" }, startedAt: existing.startedAt };
    }
    // Una rutina que ya no existe (con las rutinas bien cargadas) no se puede empezar ni preguntar por ella.
    if (!sameThing && !routine && routines !== null) return { kind: "missing" };
    return {
      kind: "ask",
      reason: sameThing ? "stale" : "other",
      target: { kind: "routine", name: routine?.name ?? null },
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
