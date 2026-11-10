import "fake-indexeddb/auto";
import { render, screen } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Exercise } from "../../src/shared/types";
import { ExercisePicker } from "../../src/web/components/ExercisePicker";
import { saveSnapshot, type Snapshot } from "../../src/web/session/offlineCache";

// El tiempo máximo real es de 5 s; aquí se acorta para no esperar tanto. El selector tiene que usar la constante.
vi.mock("../../src/web/session/offlineData", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/web/session/offlineData")>()),
  LOAD_TIMEOUT_MS: 30,
}));

function exercise(id: string, name: string, extra: Partial<Exercise> = {}): Exercise {
  return { id, name, category: "strength", muscle: "", description: "", mediaUrl: null, isCustom: false, archived: false, ...extra };
}

const SNAPSHOT: Snapshot = {
  savedAt: "2026-11-09T10:00:00.000Z",
  routines: [],
  exercises: [exercise("e-press", "Press banca"), exercise("e-remo", "Remo"), exercise("e-viejo", "Press antiguo", { archived: true })],
  last: {},
};

const fetchMock = vi.fn<typeof fetch>();

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Como un fetch real con poca señal: no responde nunca y se corta cuando se aborta. */
function hangingFetch() {
  fetchMock.mockImplementation(
    (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Abortado", "AbortError")));
      }),
  );
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("location", { pathname: "/entreno/sesion", assign: vi.fn() });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ExercisePicker con poca señal", () => {
  it("si la red no responde a tiempo, ofrece los ejercicios de la copia guardada (sin los archivados)", async () => {
    await saveSnapshot(SNAPSHOT);
    hangingFetch();

    render(<ExercisePicker onPick={() => undefined} />);

    expect(await screen.findByRole("button", { name: /Press banca/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Remo/ })).toBeTruthy();
    expect(screen.queryByText("Press antiguo")).toBeNull();
  });

  it("sin copia y sin respuesta, dice que no hay conexión en vez de quedarse cargando", async () => {
    hangingFetch();

    render(<ExercisePicker onPick={() => undefined} />);

    expect((await screen.findByRole("status")).textContent).toBe("Sin conexión");
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeTruthy();
    expect(screen.queryByText("Cargando ejercicios…")).toBeNull();
  });

  it("con buena señal enseña los de la red, no los de la copia", async () => {
    await saveSnapshot(SNAPSHOT);
    fetchMock.mockResolvedValue(json(200, [exercise("e-nuevo", "Dominadas")]));

    render(<ExercisePicker onPick={() => undefined} />);

    expect(await screen.findByRole("button", { name: /Dominadas/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Press banca/ })).toBeNull();
  });

  it("un error del servidor se enseña tal cual, sin esconderlo con la copia", async () => {
    await saveSnapshot(SNAPSHOT);
    fetchMock.mockResolvedValue(json(500, { error: "Error interno" }));

    render(<ExercisePicker onPick={() => undefined} />);

    expect((await screen.findByRole("alert")).textContent).toBe("Error interno");
    expect(screen.queryByRole("button", { name: /Press banca/ })).toBeNull();
  });
});
