import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Exercise, Routine, SetEntry } from "../../src/shared/types";
import { ApiError } from "../../src/web/api";
import { loadExercises, loadLast, loadRoutines } from "../../src/web/session/offlineData";
import { saveSnapshot, type Snapshot } from "../../src/web/session/offlineCache";

function exercise(id: string, extra: Partial<Exercise> = {}): Exercise {
  return { id, name: id, category: "strength", muscle: "", description: "", mediaUrl: null, isCustom: false, archived: false, ...extra };
}

function set(weightKg: number, reps: number): SetEntry {
  return { weightKg, reps, rir: null, durationMin: null, distanceKm: null };
}

const ROUTINE: Routine = {
  id: "r-1",
  name: "Pecho",
  inRotation: true,
  rotationOrder: 0,
  archived: false,
  items: [{ exerciseId: "e-press", position: 0, sets: 3, repsTarget: "8", restSeconds: 90 }],
};

const SNAPSHOT: Snapshot = {
  savedAt: "2026-11-09T10:00:00.000Z",
  routines: [ROUTINE],
  exercises: [exercise("e-press"), exercise("e-viejo", { archived: true })],
  last: { "e-press": [set(60, 10)] },
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function offline() {
  fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
}

describe("con red", () => {
  it("loadRoutines devuelve lo del servidor, no de la instantánea", async () => {
    await saveSnapshot(SNAPSHOT);
    fetchMock.mockResolvedValue(json(200, [{ ...ROUTINE, name: "Nuevo" }]));

    const loaded = await loadRoutines();

    expect(loaded.fromCache).toBe(false);
    expect(loaded.data[0]?.name).toBe("Nuevo");
  });

  it("loadExercises pide los archivados solo si se le pide", async () => {
    fetchMock.mockImplementation(async () => json(200, []));

    await loadExercises({ archived: true });
    await loadExercises({ archived: false });

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(["/api/exercises?archived=1", "/api/exercises"]);
  });

  it("loadLast adapta el historial con lastPerformance", async () => {
    fetchMock.mockResolvedValue(
      json(200, [
        { workoutId: "w-2", localDate: "2026-11-05", sets: [set(62.5, 8)] },
        { workoutId: "w-1", localDate: "2026-11-01", sets: [set(60, 10)] },
      ]),
    );

    expect(await loadLast("e-press")).toEqual({ sets: [set(62.5, 8)], fromCache: false });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/exercises/e-press/history");
  });

  it("loadLast de un ejercicio que nunca se hizo es null", async () => {
    fetchMock.mockResolvedValue(json(200, []));

    expect(await loadLast("e-press")).toEqual({ sets: null, fromCache: false });
  });

  it("un error del servidor no cae a la instantánea: se muestra", async () => {
    await saveSnapshot(SNAPSHOT);
    fetchMock.mockResolvedValue(json(500, { error: "Error interno" }));

    await expect(loadRoutines()).rejects.toMatchObject({ status: 500 });
  });
});

describe("sin red", () => {
  it("loadRoutines cae a la instantánea y lo dice", async () => {
    await saveSnapshot(SNAPSHOT);
    offline();

    expect(await loadRoutines()).toEqual({ data: [ROUTINE], fromCache: true });
  });

  it("loadExercises sin archivados quita los archivados de la instantánea; con ellos los deja", async () => {
    await saveSnapshot(SNAPSHOT);
    offline();

    const visible = await loadExercises({ archived: false });
    const all = await loadExercises({ archived: true });

    expect(visible.data.map((e) => e.id)).toEqual(["e-press"]);
    expect(visible.fromCache).toBe(true);
    expect(all.data.map((e) => e.id)).toEqual(["e-press", "e-viejo"]);
  });

  it("loadLast usa la última vez guardada, y null si el ejercicio no la tiene", async () => {
    await saveSnapshot(SNAPSHOT);
    offline();

    expect(await loadLast("e-press")).toEqual({ sets: [set(60, 10)], fromCache: true });
    expect(await loadLast("e-libre")).toEqual({ sets: null, fromCache: true });
  });

  it("sin instantánea, el fallo sin red sigue siendo un ApiError con estado 0", async () => {
    offline();

    const failure = await loadRoutines().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 0 });
  });

  it("sin IndexedDB tampoco falla de otra manera", async () => {
    vi.stubGlobal("indexedDB", undefined);
    offline();

    await expect(loadExercises({ archived: false })).rejects.toMatchObject({ status: 0 });
  });
});

describe("con una señal que no responde", () => {
  it("pasado el tiempo máximo, cae a la instantánea", async () => {
    await saveSnapshot(SNAPSHOT);
    // Como un fetch real: no responde nunca y se corta cuando se aborta.
    fetchMock.mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Abortado", "AbortError")));
        }),
    );

    const loaded = await loadRoutines({ timeoutMs: 20 });

    expect(loaded).toEqual({ data: [ROUTINE], fromCache: true });
  });

  it("si responde a tiempo no corta nada", async () => {
    fetchMock.mockResolvedValue(json(200, [ROUTINE]));

    expect(await loadRoutines({ timeoutMs: 1000 })).toEqual({ data: [ROUTINE], fromCache: false });
  });
});
