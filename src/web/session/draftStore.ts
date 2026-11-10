import { openDB, type DBSchema } from "idb";
import type { DraftSet } from "../../shared/types";

/** Sesión en curso guardada en el móvil. Solo hay una a la vez. */
export interface Draft {
  id: string;
  routineId: string | null;
  startedAt: string;
  exercises: { exerciseId: string; restSeconds: number; sets: DraftSet[] }[];
}

interface SessionDb extends DBSchema {
  session: { key: string; value: Draft };
}

const DB_NAME = "gymvik-session";
const STORE = "session";
// La sesión en curso es siempre la misma fila: guardar otra sustituye la anterior.
const CURRENT = "current";

function open() {
  return openDB<SessionDb>(DB_NAME, 1, {
    upgrade(db) {
      db.createObjectStore(STORE);
    },
  });
}

/** Abre la base, ejecuta la operación y la cierra, para no dejar conexiones abiertas. */
async function withDb<T>(operation: (db: Awaited<ReturnType<typeof open>>) => Promise<T>): Promise<T> {
  const db = await open();
  try {
    return await operation(db);
  } finally {
    db.close();
  }
}

export function saveDraft(draft: Draft): Promise<void> {
  return withDb(async (db) => {
    await db.put(STORE, draft, CURRENT);
  });
}

export function loadDraft(): Promise<Draft | null> {
  return withDb(async (db) => (await db.get(STORE, CURRENT)) ?? null);
}

export function clearDraft(): Promise<void> {
  return withDb((db) => db.delete(STORE, CURRENT));
}

/** ¿Hay una sesión en curso guardada en este móvil? */
export function hasDraft(): Promise<boolean> {
  return withDb(async (db) => (await db.count(STORE, CURRENT)) > 0);
}
