import { openDB, type DBSchema } from "idb";
import type { Workout } from "../../shared/types";

/** Lo que espera ser enviado al servidor. Se procesa en el orden en que se encoló. */
export type OutboxItem =
  | { kind: "workout"; workout: Workout }
  /** "Guardar en la rutina": la estructura de la sesión (ejercicios en orden y número de series). */
  | { kind: "apply"; workoutId: string; exercises: { exerciseId: string; sets: number }[] };

/** Lo que devuelve quien envía: el estado HTTP de la respuesta y, si la hubo, su cuerpo. */
export type SendResult = { status: number; body?: unknown };

/** Envía un elemento. Rechaza (lanza) si no hay red; si el servidor responde, devuelve el estado. */
export type Send = (item: OutboxItem) => Promise<SendResult>;

/** Un elemento que el servidor rechazó para siempre (un 4xx que no mejora con el tiempo). No se borra. */
export type RejectedEntry = { item: OutboxItem; status: number; rejectedAt: string };

interface OutboxDb extends DBSchema {
  outbox: { key: number; value: OutboxItem };
  rejected: { key: number; value: RejectedEntry };
}

const DB_NAME = "gymvik-outbox";
const STORE = "outbox";
const REJECTED = "rejected";

function open() {
  // Versión 2: añade "rechazados". Una base de la versión 1 conserva su cola.
  return openDB<OutboxDb>(DB_NAME, 2, {
    upgrade(db) {
      // La clave autoincremental es el orden de llegada.
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { autoIncrement: true });
      if (!db.objectStoreNames.contains(REJECTED)) db.createObjectStore(REJECTED, { autoIncrement: true });
    },
  });
}

async function withDb<T>(operation: (db: Awaited<ReturnType<typeof open>>) => Promise<T>): Promise<T> {
  const db = await open();
  try {
    return await operation(db);
  } finally {
    db.close();
  }
}

// Un 4xx significa "esto no va a mejorar si se repite", salvo cuando el fallo es de la sesión o del momento:
// 401 y 403 (sesión caducada o aún sin validar), 408 y 429 (tiempo agotado, demasiadas peticiones).
const RETRY_CLIENT_ERRORS: ReadonlySet<number> = new Set([401, 403, 408, 429]);

function isAccepted(status: number): boolean {
  return status >= 200 && status < 300;
}

/** ¿Sale el elemento de la cola con esta respuesta? Un 2xx y los 4xx definitivos sí; lo demás se conserva. */
function isFinal(status: number): boolean {
  if (isAccepted(status)) return true;
  return status >= 400 && status < 500 && !RETRY_CLIENT_ERRORS.has(status);
}

function sameTarget(a: OutboxItem, b: OutboxItem): boolean {
  if (a.kind === "workout" && b.kind === "workout") return a.workout.id === b.workout.id;
  if (a.kind === "apply" && b.kind === "apply") return a.workoutId === b.workoutId;
  return false;
}

/** Encola; si ya había un elemento igual (mismo entreno, mismo "guardar en la rutina") lo sustituye en su sitio. */
async function put(item: OutboxItem): Promise<void> {
  await withDb(async (db) => {
    const tx = db.transaction(STORE, "readwrite");
    let cursor = await tx.store.openCursor();
    while (cursor) {
      if (sameTarget(cursor.value, item)) {
        await cursor.update(item);
        await tx.done;
        return;
      }
      cursor = await cursor.continue();
    }
    await tx.store.add(item);
    await tx.done;
  });
}

/** Guarda un entreno terminado para enviarlo. Reencolar el mismo entreno no lo duplica. */
export function enqueue(workout: Workout): Promise<void> {
  return put({ kind: "workout", workout });
}

/** Guarda el "guardar estos cambios en la rutina" de un entreno, para enviarlo después de él. */
export function enqueueApply(workoutId: string, exercises: { exerciseId: string; sets: number }[]): Promise<void> {
  return put({ kind: "apply", workoutId, exercises });
}

async function pending(): Promise<{ key: number; item: OutboxItem }[]> {
  return withDb(async (db) => {
    const [keys, items] = await Promise.all([db.getAllKeys(STORE), db.getAll(STORE)]);
    return keys.map((key, index) => ({ key, item: items[index] as OutboxItem }));
  });
}

/** Cuántos elementos esperan ser enviados. */
export async function pendingCount(): Promise<number> {
  return withDb((db) => db.count(STORE));
}

/** ¿Sigue el entreno esperando a ser enviado? */
export async function isQueued(workoutId: string): Promise<boolean> {
  return (await pending()).some(({ item }) => item.kind === "workout" && item.workout.id === workoutId);
}

async function remove(key: number): Promise<void> {
  await withDb((db) => db.delete(STORE, key));
}

/** Saca el elemento de la cola y lo guarda aparte, en una sola transacción: no hay instante en que no esté en ningún sitio. */
async function reject(key: number, item: OutboxItem, status: number): Promise<void> {
  await withDb(async (db) => {
    const tx = db.transaction([STORE, REJECTED], "readwrite");
    await Promise.all([
      tx.objectStore(STORE).delete(key),
      tx.objectStore(REJECTED).add({ item, status, rejectedAt: new Date().toISOString() }),
      tx.done,
    ]);
  });
}

/** Los elementos que el servidor rechazó, en el orden en que se rechazaron. */
export async function listRejected(): Promise<RejectedEntry[]> {
  return withDb((db) => db.getAll(REJECTED));
}

/** Cuántos entrenos (no elementos: su "guardar en la rutina" va con él) rechazó el servidor y siguen guardados en el móvil. */
export async function rejectedCount(): Promise<number> {
  return (await listRejected()).filter(({ item }) => item.kind === "workout").length;
}

/** ¿Rechazó el servidor este entreno? */
export async function isRejected(workoutId: string): Promise<boolean> {
  return (await listRejected()).some(({ item }) => item.kind === "workout" && item.workout.id === workoutId);
}

const listeners = new Set<() => void>();

/** Avisa cuando la cola cambia por un envío o por reintentar rechazados (para que Hoy actualice su aviso). Devuelve cómo dejar de escuchar. */
export function onOutboxChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify() {
  for (const listener of [...listeners]) listener();
}

/**
 * Devuelve a la cola todo lo rechazado, en su orden (primero el entreno y luego su "guardar en la rutina"), y
 * devuelve cuántos elementos ha movido. No envía nada: lo hace la próxima pasada de la cola.
 */
export async function retryRejected(): Promise<number> {
  const moved = await withDb(async (db) => {
    const tx = db.transaction([STORE, REJECTED], "readwrite");
    const queue = tx.objectStore(STORE);
    const rejected = await tx.objectStore(REJECTED).getAll();
    const keys = await queue.getAllKeys();
    const queued = (await queue.getAll()).map((item, index) => ({ key: keys[index] as number, item }));
    for (const { item } of rejected) {
      const same = queued.find((entry) => sameTarget(entry.item, item));
      if (same) await queue.put(item, same.key);
      else await queue.add(item);
    }
    await tx.objectStore(REJECTED).clear();
    await tx.done;
    return rejected.length;
  });
  if (moved > 0) notify();
  return moved;
}

async function run(send: Send): Promise<number> {
  let removed = 0;
  for (const { key, item } of await pending()) {
    let result: SendResult;
    try {
      result = await send(item);
    } catch {
      // Sin red: se queda todo como está y se reintenta en la próxima pasada.
      break;
    }
    if (!isFinal(result.status)) break;
    if (isAccepted(result.status)) {
      await remove(key);
    } else {
      // Lo que el servidor no acepta no se borra: puede ser el único rastro de un entreno.
      await reject(key, item, result.status);
      console.warn(`Gymvik: el servidor rechazó un elemento de la cola con un ${result.status}; se guarda aparte`, item);
    }
    removed += 1;
  }
  return removed;
}

// Las pasadas se encadenan: dos a la vez (el evento `online` y el final de un entreno, por ejemplo) no
// enviarían dos veces lo mismo, y un elemento encolado mientras una está en marcha entra en la siguiente.
let queue: Promise<unknown> = Promise.resolve();

/**
 * Envía la cola en orden y devuelve cuántos elementos han salido de ella. Se detiene en el primer elemento que
 * debe conservarse (sin red, 5xx, 401, 403, 408 o 429). Los demás 4xx lo apartan en "rechazados" (no se borra:
 * ver `retryRejected`) y se dejan dicho en la consola.
 */
export function flushOutbox(send: Send): Promise<number> {
  const result = queue.then(() => run(send));
  queue = result.catch(() => undefined);
  void result.then(
    (removed) => {
      if (removed > 0) notify();
    },
    () => undefined,
  );
  return result;
}
