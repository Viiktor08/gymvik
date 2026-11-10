import type { RecordKind } from "../../shared/records";
import { flushOutbox, type OutboxItem, type SendResult } from "./outbox";
import { loadSnapshot, refreshSnapshot } from "./offlineCache";

export type NewRecord = { exerciseId: string; kind: RecordKind; value: number };

const RECORD_KINDS: ReadonlySet<string> = new Set(["maxWeight", "best1RM", "volume", "maxDistance", "bestPace"]);

function isNewRecord(value: unknown): value is NewRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.exerciseId === "string" &&
    typeof record.kind === "string" &&
    RECORD_KINDS.has(record.kind) &&
    typeof record.value === "number" &&
    Number.isFinite(record.value)
  );
}

// Con poca señal una petición puede quedarse colgada sin fallar; pasado este tiempo se da por perdida y el
// elemento se reintenta. Reenviar es seguro: el PUT y el "guardar en la rutina" son idempotentes.
const REQUEST_TIMEOUT_MS = 10_000;

async function request(method: string, path: string, body: unknown): Promise<SendResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      // Sin red: la cola lo interpreta como "reintentar más tarde".
      throw new Error("Sin conexión");
    }
    if (!response.ok) return { status: response.status };
    try {
      return { status: response.status, body: JSON.parse(await response.text()) };
    } catch {
      // El servidor aceptó el envío; si no se pudo leer la respuesta, solo faltan los récords.
      return { status: response.status };
    }
  } finally {
    clearTimeout(timer);
  }
}

// Los récords que el PUT devolvió, hasta que la pantalla que terminó el entreno los recoge. Pocos y de vida
// corta: si nadie los recoge (se envió al abrir la app) no se acumulan.
const results = new Map<string, { newRecords: NewRecord[] }>();
const MAX_RESULTS = 20;

/**
 * Envía un elemento de la cola. No usa `api()` a propósito: un 401 de la cola no debe sacar al usuario a la
 * pantalla de acceso en mitad de un entreno; el elemento se conserva y se reenvía cuando haya sesión.
 */
export async function sendOutboxItem(item: OutboxItem): Promise<SendResult> {
  if (item.kind === "apply") {
    return request("POST", `/api/workouts/${encodeURIComponent(item.workoutId)}/apply-to-routine`, {
      exercises: item.exercises,
    });
  }

  const { workout } = item;
  // El servidor calcula `localDate` con su zona horaria; lo que mande el móvil se descartaría.
  const body = {
    id: workout.id,
    routineId: workout.routineId,
    startedAt: workout.startedAt,
    endedAt: workout.endedAt,
    notes: workout.notes,
    source: workout.source,
    exercises: workout.exercises,
  };
  const result = await request("PUT", `/api/workouts/${encodeURIComponent(workout.id)}`, body);
  const sent = result.body as { newRecords?: unknown } | undefined;
  if (result.status >= 200 && result.status < 300 && Array.isArray(sent?.newRecords)) {
    results.set(workout.id, { newRecords: sent.newRecords.filter(isNewRecord) });
    if (results.size > MAX_RESULTS) {
      const oldest = results.keys().next().value;
      if (oldest !== undefined) results.delete(oldest);
    }
  }
  return result;
}

/** Los récords que devolvió el servidor al guardar este entreno, una sola vez; `null` si no se enviaron aquí. */
export function takeWorkoutResult(workoutId: string): { newRecords: NewRecord[] } | null {
  const found = results.get(workoutId) ?? null;
  results.delete(workoutId);
  return found;
}

/** Envía la cola con el sender real. Devuelve cuántos elementos ha quitado. */
export function syncOutbox(): Promise<number> {
  return flushOutbox(sendOutboxItem);
}

/**
 * Vuelve a guardar la copia sin conexión (rutinas, ejercicios y última vez) sin esperarla y sin molestar: se
 * llama tras cambiar rutinas o ejercicios para que lo nuevo ya esté en el móvil si luego no hay cobertura. Un
 * fallo (sin red, sin IndexedDB) se deja para la próxima ocasión: el cambio ya está guardado en el servidor.
 */
export function refreshSnapshotInBackground(): void {
  void refreshSnapshot().catch(() => undefined);
}

/** Al volver a la app desde segundo plano, la copia sin conexión se refresca si tiene más de esto. */
export const FOREGROUND_REFRESH_MS = 5 * 60_000;

async function snapshotIsStale(): Promise<boolean> {
  const snapshot = await loadSnapshot();
  return snapshot === null || !(Date.now() - Date.parse(snapshot.savedAt) < FOREGROUND_REFRESH_MS);
}

/**
 * Mantiene la app al día sin que nadie lo pida: al abrirla envía lo pendiente y refresca la instantánea sin
 * conexión; al volver la red hace lo mismo, y al volver a la app desde segundo plano (donde `online` no
 * siempre llega) reintenta el envío y refresca la copia si tiene más de `FOREGROUND_REFRESH_MS` (así lo que se
 * cambió desde otro dispositivo llega al móvil sin depender de abrir la app de cero). Devuelve la función que
 * lo para.
 */
export function startBackgroundSync(): () => void {
  let active = true;
  // Varios avisos de "vuelvo a la app" seguidos no deben lanzar varios refrescos a la vez.
  let refreshing = false;

  async function refreshOnce() {
    if (refreshing) return;
    refreshing = true;
    try {
      await refreshSnapshot();
    } finally {
      refreshing = false;
    }
  }

  async function run(refresh: boolean) {
    try {
      const sent = await syncOutbox();
      // Lo que se acaba de enviar cambia "la última vez" de los ejercicios.
      if (active && (refresh || sent > 0 || (await snapshotIsStale()))) await refreshOnce();
    } catch {
      // Sin red o sin IndexedDB: se vuelve a intentar en la próxima ocasión.
    }
  }

  const onOnline = () => void run(true);
  const onVisible = () => {
    if (!document.hidden) void run(false);
  };
  void run(true);
  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    active = false;
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
