import "fake-indexeddb/auto";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Workout } from "../../src/shared/types";
import { Today } from "../../src/web/screens/Today";
import { enqueue, flushOutbox, pendingCount, rejectedCount } from "../../src/web/session/outbox";
import type { TodayData } from "../../src/web/todayData";

function workout(id: string): Workout {
  return {
    id,
    routineId: null,
    startedAt: "2026-11-10T08:00:00.000Z",
    endedAt: "2026-11-10T09:00:00.000Z",
    localDate: "2026-11-10",
    notes: "",
    source: "live",
    exercises: [{ exerciseId: "e-press", sets: [{ weightKg: 60, reps: 10, rir: null, durationMin: null, distanceKm: null }] }],
  };
}

const TODAY: TodayData = {
  date: "2026-11-10",
  displayName: "Victor",
  streak: 1,
  next: null,
  steps: null,
  stepsGoal: 8000,
  lastWeight: null,
  weekWeightDelta: null,
  creatineToday: false,
  week: { count: 0, goal: 3, days: [false, false, false, false, false, false, false] },
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const server = { putStatus: 400, puts: [] as string[] };
const fetchMock = vi.fn<typeof fetch>();

async function handle(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const path = String(input);
  if (path === "/api/today") return json(200, TODAY);
  if (path === "/api/exercises?archived=1") return json(200, []);
  if (path === "/api/settings") return json(200, { shortcutName: "Atajo" });
  if (init?.method === "PUT" && path.startsWith("/api/workouts/")) {
    server.puts.push(path);
    return server.putStatus === 200 ? json(200, { workout: {}, newRecords: [] }) : json(server.putStatus, { error: "Fallo simulado" });
  }
  return json(404, { error: "No encontrado" });
}

/** Deja un entreno rechazado por el servidor (400), como si la cola lo hubiera intentado. */
async function rejectOne(id: string) {
  await enqueue(workout(id));
  await flushOutbox(async () => ({ status: 400 }));
}

function renderToday() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="/" element={<Today />} />
      </Routes>
    </MemoryRouter>,
  );
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  server.putStatus = 400;
  server.puts = [];
  fetchMock.mockReset();
  fetchMock.mockImplementation(handle);
  vi.stubGlobal("fetch", fetchMock);
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
  vi.unstubAllGlobals();
});

describe("Hoy: entrenos que el servidor rechazó", () => {
  it("sin rechazados no hay aviso", async () => {
    renderToday();
    await screen.findByRole("heading", { level: 1, name: "Hola, Victor" });

    expect(screen.queryByText(/no se ha podido guardar|no se han podido guardar/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();
  });

  it("con uno, avisa con la cuenta y dice que sigue en el móvil", async () => {
    await rejectOne("w-1");

    renderToday();

    const notice = await screen.findByRole("status");
    expect(notice.textContent).toMatch(/1 entreno no se ha podido guardar en el servidor y sigue en este móvil/);
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeTruthy();
  });

  it("con varios, lo dice en plural", async () => {
    await rejectOne("w-1");
    await rejectOne("w-2");

    renderToday();

    expect((await screen.findByRole("status")).textContent).toMatch(/2 entrenos no se han podido guardar en el servidor y siguen en este móvil/);
  });

  it("Reintentar los devuelve a la cola y, si el servidor ya los acepta, el aviso desaparece", async () => {
    await rejectOne("w-1");
    renderToday();
    await screen.findByRole("status");
    server.putStatus = 200;

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(server.puts).toEqual(["/api/workouts/w-1"]);
    expect(await rejectedCount()).toBe(0);
    expect(await pendingCount()).toBe(0);
  });

  it("si el servidor lo vuelve a rechazar, el aviso sigue y no se pierde nada", async () => {
    await rejectOne("w-1");
    renderToday();
    await screen.findByRole("status");

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    await waitFor(() => expect(server.puts).toHaveLength(1));
    await waitFor(() => expect((screen.getByRole("button", { name: "Reintentar" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByRole("status").textContent).toMatch(/1 entreno/);
    expect(await rejectedCount()).toBe(1);
  });

  it("si al reintentar no hay red, el entreno queda en la cola y el aviso se quita (la cola lo reenviará)", async () => {
    await rejectOne("w-1");
    renderToday();
    await screen.findByRole("status");
    fetchMock.mockImplementation(async (input, init) => {
      if (init?.method === "PUT") throw new TypeError("Failed to fetch");
      return handle(input, init);
    });

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(await pendingCount()).toBe(1);
    expect(await rejectedCount()).toBe(0);
  });

  it("si el rechazo llega con la pantalla ya abierta (al abrir la app se envía la cola), el aviso aparece", async () => {
    renderToday();
    await screen.findByRole("heading", { level: 1, name: "Hola, Victor" });
    expect(screen.queryByRole("status")).toBeNull();

    await rejectOne("w-1");

    expect((await screen.findByRole("status")).textContent).toMatch(/1 entreno/);
  });
});
