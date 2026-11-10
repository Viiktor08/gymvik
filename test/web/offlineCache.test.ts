import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Exercise, Routine, SetEntry } from "../../src/shared/types";
import { lastFromHistory } from "../../src/web/session/lastTime";
import { loadSnapshot, refreshSnapshot, saveSnapshot, type Snapshot } from "../../src/web/session/offlineCache";

function exercise(id: string, extra: Partial<Exercise> = {}): Exercise {
  return { id, name: id, category: "strength", muscle: "", description: "", mediaUrl: null, isCustom: false, archived: false, ...extra };
}

function set(weightKg: number, reps: number): SetEntry {
  return { weightKg, reps, rir: null, durationMin: null, distanceKm: null };
}

const ROUTINES: Routine[] = [
  {
    id: "r-1",
    name: "Pecho",
    inRotation: true,
    rotationOrder: 0,
    archived: false,
    items: [
      { exerciseId: "e-press", position: 0, sets: 3, repsTarget: "8", restSeconds: 90 },
      { exerciseId: "e-fondos", position: 1, sets: 3, repsTarget: "10", restSeconds: 60 },
    ],
  },
  {
    id: "r-2",
    name: "Espalda",
    inRotation: false,
    rotationOrder: 0,
    archived: false,
    items: [{ exerciseId: "e-press", position: 0, sets: 2, repsTarget: "8", restSeconds: 90 }],
  },
];

const EXERCISES: Exercise[] = [
  exercise("e-press"),
  exercise("e-fondos"),
  exercise("e-libre"),
  exercise("e-viejo", { archived: true }),
];

const SNAPSHOT: Snapshot = {
  savedAt: "2026-11-09T10:00:00.000Z",
  routines: ROUTINES,
  exercises: EXERCISES,
  last: { "e-press": [set(60, 10)] },
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const server = {
  history: {
    "e-press": [
      { workoutId: "w-2", localDate: "2026-11-05", sets: [set(62.5, 8)] },
      { workoutId: "w-1", localDate: "2026-11-01", sets: [set(60, 10)] },
    ],
    "e-fondos": [],
  } as Record<string, unknown[]>,
  historyFails: new Set<string>(),
  routinesFail: false,
  calls: [] as string[],
};

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  server.historyFails = new Set();
  server.routinesFail = false;
  server.calls = [];
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input) => {
    const path = String(input);
    server.calls.push(path);
    if (path === "/api/routines") {
      if (server.routinesFail) throw new TypeError("Failed to fetch");
      return json(200, ROUTINES);
    }
    if (path === "/api/exercises?archived=1") return json(200, EXERCISES);
    const history = /^\/api\/exercises\/([^/]+)\/history$/.exec(path);
    if (history) {
      const id = decodeURIComponent(history[1] ?? "");
      if (server.historyFails.has(id)) return json(500, { error: "Error interno" });
      return json(200, server.history[id] ?? []);
    }
    return json(404, { error: "No encontrado" });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("lastFromHistory", () => {
  it("toma la sesión más reciente (la primera, el servidor las manda de más nueva a más antigua)", () => {
    const entries = [
      { workoutId: "w-2", localDate: "2026-11-05", sets: [set(62.5, 8)] },
      { workoutId: "w-1", localDate: "2026-11-01", sets: [set(60, 10)] },
    ];

    expect(lastFromHistory("e-press", entries)).toEqual([set(62.5, 8)]);
  });

  it("salta una sesión en la que el ejercicio no guardó ninguna serie", () => {
    const entries = [
      { workoutId: "w-2", localDate: "2026-11-05", sets: [] },
      { workoutId: "w-1", localDate: "2026-11-01", sets: [set(60, 10)] },
    ];

    expect(lastFromHistory("e-press", entries)).toEqual([set(60, 10)]);
  });

  it("dos entrenos el mismo día: gana el primero de la lista (el más reciente)", () => {
    const entries = [
      { workoutId: "w-b", localDate: "2026-11-05", sets: [set(70, 5)] },
      { workoutId: "w-a", localDate: "2026-11-05", sets: [set(60, 10)] },
    ];

    expect(lastFromHistory("e-press", entries)).toEqual([set(70, 5)]);
  });

  it("sin historial, null", () => {
    expect(lastFromHistory("e-press", [])).toBeNull();
  });
});

describe("saveSnapshot y loadSnapshot", () => {
  it("sin instantánea, loadSnapshot devuelve null", async () => {
    expect(await loadSnapshot()).toBeNull();
  });

  it("lo guardado se lee igual", async () => {
    await saveSnapshot(SNAPSHOT);

    expect(await loadSnapshot()).toEqual(SNAPSHOT);
  });

  it("guardar otra sustituye la anterior", async () => {
    await saveSnapshot(SNAPSHOT);
    await saveSnapshot({ ...SNAPSHOT, routines: [] });

    expect((await loadSnapshot())?.routines).toEqual([]);
  });

  it("si IndexedDB no está disponible, devuelve null en vez de fallar", async () => {
    vi.stubGlobal("indexedDB", undefined);

    expect(await loadSnapshot()).toBeNull();
  });
});

describe("refreshSnapshot", () => {
  it("guarda rutinas, ejercicios (con archivados) y la última vez de cada ejercicio de las rutinas", async () => {
    await refreshSnapshot();

    const snapshot = await loadSnapshot();
    expect(snapshot?.routines).toEqual(ROUTINES);
    expect(snapshot?.exercises).toEqual(EXERCISES);
    // Solo hay última vez donde hubo series: e-fondos no tiene historial.
    expect(snapshot?.last).toEqual({ "e-press": [set(62.5, 8)] });
    expect(Number.isNaN(Date.parse(snapshot?.savedAt ?? ""))).toBe(false);
  });

  it("pide el historial solo de los ejercicios de las rutinas, y una sola vez cada uno", async () => {
    await refreshSnapshot();

    const histories = server.calls.filter((path) => path.endsWith("/history")).sort();
    expect(histories).toEqual(["/api/exercises/e-fondos/history", "/api/exercises/e-press/history"]);
  });

  it("si falla el historial de un ejercicio conserva su última vez anterior", async () => {
    await saveSnapshot(SNAPSHOT);
    server.historyFails.add("e-press");

    await refreshSnapshot();

    expect((await loadSnapshot())?.last["e-press"]).toEqual([set(60, 10)]);
  });

  it("sin red no toca la instantánea anterior y avisa con un error", async () => {
    await saveSnapshot(SNAPSHOT);
    server.routinesFail = true;

    await expect(refreshSnapshot()).rejects.toMatchObject({ status: 0 });

    expect(await loadSnapshot()).toEqual(SNAPSHOT);
  });

  it("una rutina que ya no existe deja de estar en la instantánea", async () => {
    await saveSnapshot(SNAPSHOT);
    fetchMock.mockImplementation(async (input) => {
      const path = String(input);
      if (path === "/api/routines") return json(200, [ROUTINES[0]]);
      if (path === "/api/exercises?archived=1") return json(200, EXERCISES);
      return json(200, []);
    });

    await refreshSnapshot();

    expect((await loadSnapshot())?.routines.map((routine) => routine.id)).toEqual(["r-1"]);
  });
});
