import type { Exercise, Routine, SetEntry } from "../../shared/types";
import { ApiError, api, apiWithin } from "../api";
import type { ExerciseHistoryEntry } from "../progressData";
import { lastFromHistory } from "./lastTime";
import { loadSnapshot, type Snapshot } from "./offlineCache";

// Lecturas "primero la red, y sin conexión la instantánea". Solo cae a la instantánea cuando no hay red
// (o la señal no responde a tiempo): un error del servidor se enseña tal cual, no se esconde con datos viejos.

/** Con poca señal una petición puede no fallar nunca: a los 5 s se da por perdida y se usa lo guardado en el móvil. */
export const LOAD_TIMEOUT_MS = 5000;

export type Cached<T> = { data: T; fromCache: boolean };

type Options = {
  /** Si la red no ha contestado en este tiempo se da por perdida. Sin él, se espera lo que tarde el navegador. */
  timeoutMs?: number;
  /**
   * Cae a la instantánea con cualquier fallo, no solo sin red (un 5xx, por ejemplo). Para cuando hay algo del
   * usuario que no puede quedarse bloqueado por un servidor enfermo, como un entreno ya empezado.
   */
  anyFailure?: boolean;
};

function call<T>(path: string, timeoutMs: number | undefined): Promise<T> {
  return timeoutMs === undefined ? api<T>(path) : apiWithin<T>(path, timeoutMs);
}

async function withSnapshot<T>(path: string, options: Options, pick: (snapshot: Snapshot) => T): Promise<Cached<T>> {
  try {
    return { data: await call<T>(path, options.timeoutMs), fromCache: false };
  } catch (failure) {
    if (options.anyFailure || (failure instanceof ApiError && failure.status === 0)) {
      const snapshot = await loadSnapshot();
      if (snapshot) return { data: pick(snapshot), fromCache: true };
    }
    throw failure;
  }
}

export function loadRoutines(options: Options = {}): Promise<Cached<Routine[]>> {
  return withSnapshot("/api/routines", options, (snapshot) => snapshot.routines);
}

/** Con `archived`, también los archivados (para poner nombre a lo que ya está en una rutina o en un entreno). */
export function loadExercises(options: Options & { archived: boolean }): Promise<Cached<Exercise[]>> {
  return withSnapshot(
    options.archived ? "/api/exercises?archived=1" : "/api/exercises",
    options,
    (snapshot) => (options.archived ? snapshot.exercises : snapshot.exercises.filter((exercise) => !exercise.archived)),
  );
}

/**
 * Qué se hizo la última vez en un ejercicio (`null` si nunca). Con conexión sale del historial del servidor;
 * si eso falla por lo que sea, de la instantánea.
 */
export async function loadLast(
  exerciseId: string,
  options: Options = {},
): Promise<{ sets: SetEntry[] | null; fromCache: boolean }> {
  try {
    const path = `/api/exercises/${encodeURIComponent(exerciseId)}/history`;
    const entries = await call<ExerciseHistoryEntry[]>(path, options.timeoutMs);
    return { sets: lastFromHistory(exerciseId, entries), fromCache: false };
  } catch {
    const snapshot = await loadSnapshot();
    return { sets: snapshot?.last[exerciseId] ?? null, fromCache: snapshot !== null };
  }
}
