import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Workout } from "../../src/shared/types";
import { enqueue, enqueueApply, isQueued, pendingCount } from "../../src/web/session/outbox";
import { loadSnapshot, saveSnapshot } from "../../src/web/session/offlineCache";
import {
  FOREGROUND_REFRESH_MS,
  refreshSnapshotInBackground,
  sendOutboxItem,
  startBackgroundSync,
  syncOutbox,
  takeWorkoutResult,
} from "../../src/web/session/sync";

function workout(id: string): Workout {
  return {
    id,
    routineId: "r-1",
    startedAt: "2026-11-10T08:00:00.000Z",
    endedAt: "2026-11-10T09:00:00.000Z",
    localDate: "2026-11-10",
    notes: "buen día",
    source: "live",
    exercises: [{ exerciseId: "e-press", sets: [{ weightKg: 60, reps: 10, rir: null, durationMin: null, distanceKm: null }] }],
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

type Call = { method: string; path: string; body: unknown };

const server = {
  putStatus: 200,
  applyStatus: 200,
  offline: false,
  records: [{ exerciseId: "e-press", kind: "maxWeight", value: 62.5 }] as unknown[],
  calls: [] as Call[],
};

const fetchMock = vi.fn<typeof fetch>();

async function handle(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (server.offline) throw new TypeError("Failed to fetch");
  const path = String(input);
  const method = init?.method ?? "GET";
  const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
  server.calls.push({ method, path, body });
  if (method === "PUT" && path.startsWith("/api/workouts/")) {
    if (server.putStatus !== 200) return json(server.putStatus, { error: "Fallo simulado" });
    return json(200, { workout: body, newRecords: server.records });
  }
  if (method === "POST" && path.endsWith("/apply-to-routine")) {
    if (server.applyStatus !== 200) return json(server.applyStatus, { error: "Fallo simulado" });
    return json(200, { id: "r-1" });
  }
  if (path === "/api/routines" || path === "/api/exercises?archived=1") return json(200, []);
  return json(404, { error: "No encontrado" });
}

function writes(): Call[] {
  return server.calls.filter((call) => call.method !== "GET");
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  server.putStatus = 200;
  server.applyStatus = 200;
  server.offline = false;
  server.records = [{ exerciseId: "e-press", kind: "maxWeight", value: 62.5 }];
  server.calls = [];
  fetchMock.mockReset();
  fetchMock.mockImplementation(handle);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sendOutboxItem", () => {
  it("envía el entreno con PUT a su id, sin localDate (lo calcula el servidor)", async () => {
    const result = await sendOutboxItem({ kind: "workout", workout: workout("w-1") });

    expect(result.status).toBe(200);
    const { localDate: _ignored, ...expected } = workout("w-1");
    expect(writes()).toEqual([{ method: "PUT", path: "/api/workouts/w-1", body: expected }]);
  });

  it("envía el 'guardar en la rutina' con la estructura en el cuerpo", async () => {
    await sendOutboxItem({ kind: "apply", workoutId: "w-1", exercises: [{ exerciseId: "e-press", sets: 4 }] });

    expect(writes()).toEqual([
      { method: "POST", path: "/api/workouts/w-1/apply-to-routine", body: { exercises: [{ exerciseId: "e-press", sets: 4 }] } },
    ]);
  });

  it("devuelve el estado HTTP de un rechazo en vez de lanzar", async () => {
    server.putStatus = 400;

    expect((await sendOutboxItem({ kind: "workout", workout: workout("w-1") })).status).toBe(400);
  });

  it("sin red lanza", async () => {
    server.offline = true;

    await expect(sendOutboxItem({ kind: "workout", workout: workout("w-1") })).rejects.toThrow();
  });

  it("un id raro se codifica en la URL", async () => {
    await sendOutboxItem({ kind: "workout", workout: workout("a/b") });

    expect(writes()[0]?.path).toBe("/api/workouts/a%2Fb");
  });
});

describe("syncOutbox", () => {
  it("envía la cola y deja los récords del PUT para quien terminó el entreno, una sola vez", async () => {
    await enqueue(workout("w-1"));

    expect(await syncOutbox()).toBe(1);

    expect(takeWorkoutResult("w-1")).toEqual({ newRecords: [{ exerciseId: "e-press", kind: "maxWeight", value: 62.5 }] });
    expect(takeWorkoutResult("w-1")).toBeNull();
  });

  it("ignora de la respuesta lo que no son récords bien formados", async () => {
    server.records = [{ exerciseId: "e-press", kind: "maxWeight", value: 62.5 }, { exerciseId: 3 }, null, { exerciseId: "x", kind: "volume", value: "mucho" }];
    await enqueue(workout("w-1"));

    await syncOutbox();

    expect(takeWorkoutResult("w-1")?.newRecords).toEqual([{ exerciseId: "e-press", kind: "maxWeight", value: 62.5 }]);
  });

  it("sin red no hay resultado y el entreno sigue en la cola", async () => {
    server.offline = true;
    await enqueue(workout("w-1"));

    expect(await syncOutbox()).toBe(0);

    expect(takeWorkoutResult("w-1")).toBeNull();
    expect(await isQueued("w-1")).toBe(true);
  });

  it("el mismo entreno reenviado tras volver la red se envía una sola vez y sale de la cola", async () => {
    server.offline = true;
    await enqueue(workout("w-1"));
    await syncOutbox();
    await syncOutbox();
    expect(writes()).toHaveLength(0);

    server.offline = false;
    await syncOutbox();
    await syncOutbox();

    expect(writes().filter((call) => call.method === "PUT")).toHaveLength(1);
    expect(await pendingCount()).toBe(0);
  });

  it("el PUT sale antes que el 'guardar en la rutina'", async () => {
    await enqueueApply("w-1", [{ exerciseId: "e-press", sets: 4 }]);
    await enqueue(workout("w-1"));
    // Encolados al revés a propósito no se reordenan: el orden es el de llegada. Lo normal es lo contrario.
    await syncOutbox();

    expect(writes().map((call) => call.method)).toEqual(["POST", "PUT"]);
  });
});

describe("startBackgroundSync", () => {
  it("al arrancar envía la cola y refresca la instantánea", async () => {
    await enqueue(workout("w-1"));

    const stop = startBackgroundSync();
    await vi.waitFor(async () => expect(await loadSnapshot()).not.toBeNull());
    stop();

    expect(writes().filter((call) => call.method === "PUT")).toHaveLength(1);
    expect(await pendingCount()).toBe(0);
  });

  it("al arrancar sin red no falla y deja la cola como está", async () => {
    server.offline = true;
    await enqueue(workout("w-1"));

    const stop = startBackgroundSync();
    await new Promise((resolve) => setTimeout(resolve, 30));
    stop();

    expect(await pendingCount()).toBe(1);
  });

  it("al volver la red (evento online) reintenta lo pendiente", async () => {
    server.offline = true;
    await enqueue(workout("w-1"));
    const stop = startBackgroundSync();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(await pendingCount()).toBe(1);

    server.offline = false;
    window.dispatchEvent(new Event("online"));
    await vi.waitFor(async () => expect(await pendingCount()).toBe(0));
    stop();

    expect(writes().filter((call) => call.method === "PUT")).toHaveLength(1);
  });

  it("al volver a la app desde segundo plano reintenta lo pendiente", async () => {
    server.offline = true;
    await enqueue(workout("w-1"));
    const stop = startBackgroundSync();
    await new Promise((resolve) => setTimeout(resolve, 30));

    server.offline = false;
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(async () => expect(await pendingCount()).toBe(0));
    stop();
  });

  describe("la copia sin conexión al volver a la app", () => {
    const routineReads = () => server.calls.filter((call) => call.method === "GET" && call.path === "/api/routines");

    async function ageSnapshot(msAgo: number) {
      const snapshot = await loadSnapshot();
      if (snapshot === null) throw new Error("no hay copia");
      await saveSnapshot({ ...snapshot, savedAt: new Date(Date.now() - msAgo).toISOString() });
    }

    async function started() {
      const stop = startBackgroundSync();
      await vi.waitFor(async () => expect(await loadSnapshot()).not.toBeNull());
      await vi.waitFor(() => expect(routineReads()).toHaveLength(1));
      return stop;
    }

    it("la refresca si la copia tiene más de unos minutos", async () => {
      const stop = await started();
      await ageSnapshot(FOREGROUND_REFRESH_MS + 60_000);

      document.dispatchEvent(new Event("visibilitychange"));

      await vi.waitFor(() => expect(routineReads()).toHaveLength(2));
      await vi.waitFor(async () => {
        const saved = Date.parse((await loadSnapshot())?.savedAt ?? "");
        expect(Date.now() - saved).toBeLessThan(FOREGROUND_REFRESH_MS);
      });
      stop();
    });

    it("no la refresca si es reciente: como mucho una vez cada pocos minutos", async () => {
      const stop = await started();
      await ageSnapshot(FOREGROUND_REFRESH_MS - 60_000);

      for (let i = 0; i < 3; i += 1) document.dispatchEvent(new Event("visibilitychange"));
      await new Promise((resolve) => setTimeout(resolve, 50));
      stop();

      expect(routineReads()).toHaveLength(1);
    });

    it("varios avisos seguidos de que la app vuelve no lanzan varios refrescos a la vez", async () => {
      const stop = await started();
      await ageSnapshot(FOREGROUND_REFRESH_MS + 60_000);

      for (let i = 0; i < 3; i += 1) document.dispatchEvent(new Event("visibilitychange"));
      await vi.waitFor(() => expect(routineReads().length).toBeGreaterThanOrEqual(2));
      await new Promise((resolve) => setTimeout(resolve, 50));
      stop();

      expect(routineReads()).toHaveLength(2);
    });

    it("sin copia guardada la crea al volver", async () => {
      server.offline = true;
      const stop = startBackgroundSync();
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(await loadSnapshot()).toBeNull();

      server.offline = false;
      document.dispatchEvent(new Event("visibilitychange"));

      await vi.waitFor(async () => expect(await loadSnapshot()).not.toBeNull());
      stop();
    });

    it("al parar ya no refresca al volver", async () => {
      const stop = await started();
      await ageSnapshot(FOREGROUND_REFRESH_MS + 60_000);
      stop();

      document.dispatchEvent(new Event("visibilitychange"));
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(routineReads()).toHaveLength(1);
    });
  });

  it("una vez parado ya no reacciona", async () => {
    const stop = startBackgroundSync();
    await vi.waitFor(async () => expect(await loadSnapshot()).not.toBeNull());
    stop();
    await enqueue(workout("w-1"));

    window.dispatchEvent(new Event("online"));
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(await pendingCount()).toBe(1);
  });
});

describe("refreshSnapshotInBackground", () => {
  it("guarda la copia sin esperar y sin lanzar", async () => {
    refreshSnapshotInBackground();

    await vi.waitFor(async () => expect(await loadSnapshot()).not.toBeNull());
  });

  it("si falla (sin red) no lanza ni deja un rechazo sin atender", async () => {
    server.offline = true;

    expect(() => refreshSnapshotInBackground()).not.toThrow();
    // Un rechazo sin atender haría fallar la ejecución de Vitest, así que basta con dejar pasar el fallo.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(await loadSnapshot()).toBeNull();
  });
});
