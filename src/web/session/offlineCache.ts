import { openDB, type DBSchema } from "idb";
import type { Exercise, Routine, SetEntry } from "../../shared/types";
import { api } from "../api";
import type { ExerciseHistoryEntry } from "../progressData";
import { lastFromHistory } from "./lastTime";

/**
 * Lo que hace falta para empezar un entreno sin cobertura: las rutinas, los ejercicios (con los archivados,
 * que pueden seguir en una rutina) y, de los ejercicios de las rutinas, qué se hizo la última vez.
 */
export interface Snapshot {
  savedAt: string;
  routines: Routine[];
  exercises: Exercise[];
  /** Por id de ejercicio. Un ejercicio que nunca se hizo no está. */
  last: Record<string, SetEntry[]>;
}

interface CacheDb extends DBSchema {
  snapshot: { key: string; value: Snapshot };
}

const DB_NAME = "gymvik-cache";
const STORE = "snapshot";
// Solo hay una instantánea: guardar otra sustituye la anterior.
const CURRENT = "current";

function open() {
  return openDB<CacheDb>(DB_NAME, 1, {
    upgrade(db) {
      db.createObjectStore(STORE);
    },
  });
}

export async function saveSnapshot(snapshot: Snapshot): Promise<void> {
  const db = await open();
  try {
    await db.put(STORE, snapshot, CURRENT);
  } finally {
    db.close();
  }
}

/** La instantánea guardada, o `null` si no hay (o si IndexedDB no está disponible: modo privado, por ejemplo). */
export async function loadSnapshot(): Promise<Snapshot | null> {
  try {
    const db = await open();
    try {
      return (await db.get(STORE, CURRENT)) ?? null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

/**
 * Vuelve a pedir al servidor lo que va en la instantánea y la guarda. Si no se pueden pedir las rutinas o los
 * ejercicios lanza el error (la instantánea anterior se queda como está); si falla el historial de un
 * ejercicio concreto, conserva su última vez anterior.
 */
export async function refreshSnapshot(): Promise<void> {
  const [routines, exercises] = await Promise.all([
    api<Routine[]>("/api/routines"),
    api<Exercise[]>("/api/exercises?archived=1"),
  ]);
  const previous = await loadSnapshot();
  const ids = [...new Set(routines.flatMap((routine) => routine.items.map((item) => item.exerciseId)))];

  const last: Record<string, SetEntry[]> = {};
  await Promise.all(
    ids.map(async (id) => {
      try {
        const entries = await api<ExerciseHistoryEntry[]>(`/api/exercises/${encodeURIComponent(id)}/history`);
        const sets = lastFromHistory(id, entries);
        if (sets) last[id] = sets;
      } catch {
        const kept = previous?.last[id];
        if (kept) last[id] = kept;
      }
    }),
  );

  await saveSnapshot({ savedAt: new Date().toISOString(), routines, exercises, last });
}
