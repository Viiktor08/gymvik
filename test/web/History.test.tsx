import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Exercise, Routine } from "../../src/shared/types";
import type { WorkoutSummary } from "../../src/web/historyData";
import { History } from "../../src/web/screens/History";
import { refreshSnapshot } from "../../src/web/session/offlineCache";

// La copia sin conexión usa IndexedDB, que aquí no importa: solo se comprueba que se pide refrescarla.
vi.mock("../../src/web/session/offlineCache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/web/session/offlineCache")>()),
  refreshSnapshot: vi.fn().mockResolvedValue(undefined),
}));

const PRESS: Exercise = {
  id: "e-press",
  name: "Press banca",
  category: "strength",
  muscle: "Pecho",
  description: "",
  mediaUrl: null,
  isCustom: false,
  archived: false,
};
const CINTA: Exercise = { ...PRESS, id: "e-cinta", name: "Cinta", category: "cardio", muscle: "" };

const PECHO: Routine = {
  id: "r-pecho",
  name: "Pecho",
  inRotation: true,
  rotationOrder: 0,
  archived: false,
  items: [],
};

function summary(id: string, localDate: string, extra: Partial<WorkoutSummary> = {}): WorkoutSummary {
  return { id, routineName: "Pecho", localDate, durationMin: 45, volumeKg: 4210, ...extra };
}

type Call = { method: string; path: string; body: unknown };

const server = {
  workouts: [] as WorkoutSummary[],
  listFail: null as "offline" | 500 | null,
  putStatuses: [] as number[],
  calls: [] as Call[],
};

const fetchMock = vi.fn<typeof fetch>();

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function handle(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const path = String(input);
  const method = init?.method ?? "GET";
  const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
  server.calls.push({ method, path, body });

  if (path === "/api/workouts" && method === "GET") {
    if (server.listFail === "offline") throw new TypeError("Failed to fetch");
    if (server.listFail === 500) return json(500, { error: "Error interno" });
    return json(200, server.workouts);
  }
  if (path === "/api/routines") return json(200, [PECHO]);
  if (path === "/api/exercises") return json(200, [PRESS, CINTA]);
  if (path.startsWith("/api/workouts/") && method === "PUT") {
    const status = server.putStatuses.shift() ?? 200;
    if (status !== 200) return json(status, { error: "Fallo simulado" });
    const workout = body as { id: string; routineId: string | null; startedAt: string; endedAt: string };
    // Como el servidor: la fecha local sale del instante y el listado se actualiza.
    const localDate = workout.startedAt.slice(0, 10);
    server.workouts = [
      summary(workout.id, localDate, {
        routineName: workout.routineId === null ? null : "Pecho",
        durationMin: Math.round((Date.parse(workout.endedAt) - Date.parse(workout.startedAt)) / 60000),
      }),
      ...server.workouts,
    ];
    return json(200, { workout: { ...workout, localDate }, newRecords: [] });
  }
  return json(404, { error: "No encontrado" });
}

/** Los enlaces de los entrenos (sin el de volver a Entreno). */
function workoutLinks(): HTMLElement[] {
  return screen.queryAllByRole("link").filter((link) => link.getAttribute("href")?.startsWith("/entreno/historial/"));
}

function puts(): Call[] {
  return server.calls.filter((call) => call.method === "PUT");
}

async function renderHistory() {
  const view = render(
    <MemoryRouter initialEntries={["/entreno/historial"]}>
      <Routes>
        <Route path="/entreno" element={<p>Pantalla Entreno</p>} />
        <Route path="/entreno/historial" element={<History />} />
        <Route path="/entreno/historial/:id" element={<p>Detalle abierto</p>} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { name: "Historial" });
  await waitFor(() => expect(screen.queryByText("Cargando…")).toBeNull());
  return view;
}

beforeEach(() => {
  // Hoy es martes 10 de noviembre de 2026, a media mañana. Solo se finge la fecha: los temporizadores siguen reales.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 10, 10, 0, 0));
  server.workouts = [];
  server.listFail = null;
  server.putStatuses = [];
  server.calls = [];
  vi.mocked(refreshSnapshot).mockClear();
  fetchMock.mockReset();
  fetchMock.mockImplementation(handle);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("History: lista", () => {
  it("agrupa por semanas, la más reciente primero, con el número de entrenos de cada una", async () => {
    server.workouts = [
      summary("w-3", "2026-11-10"),
      summary("w-2", "2026-11-09", { routineName: null, volumeKg: 0, durationMin: 30 }),
      summary("w-1", "2026-11-03", { routineName: "Espalda" }),
      summary("w-0", "2026-10-27", { routineName: "Pierna" }),
    ];
    await renderHistory();

    const headings = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(headings).toEqual(["Semana del 9 nov al 15 nov", "Semana del 2 nov al 8 nov", "Semana del 26 oct al 1 nov"]);

    const current = screen.getByRole("region", { name: "Semana del 9 nov al 15 nov" });
    expect(within(current).getByText("2 entrenos")).toBeTruthy();
    expect(within(current).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/entreno/historial/w-3",
      "/entreno/historial/w-2",
    ]);
    const previous = screen.getByRole("region", { name: "Semana del 2 nov al 8 nov" });
    expect(within(previous).getByText("1 entreno")).toBeTruthy();
  });

  it("cada entreno enseña nombre, fecha, duración y volumen; uno libre y sin volumen, solo lo que hay", async () => {
    server.workouts = [
      summary("w-3", "2026-11-10"),
      summary("w-2", "2026-11-09", { routineName: null, volumeKg: 0, durationMin: 30 }),
    ];
    await renderHistory();

    const rows = workoutLinks();
    expect(rows[0]?.textContent).toContain("Pecho");
    expect(rows[0]?.textContent).toContain("Martes, 10 de noviembre · 45 min · 4.210 kg");
    expect(rows[1]?.textContent).toContain("Entreno libre");
    expect(rows[1]?.textContent).toContain("Lunes, 9 de noviembre · 30 min");
    expect(rows[1]?.textContent).not.toContain("kg");
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/);
  });

  it("sin entrenos explica que todavía no hay ninguno", async () => {
    await renderHistory();
    expect(screen.getByText("Todavía no hay entrenos")).toBeTruthy();
    expect(workoutLinks()).toHaveLength(0);
  });

  it("si la carga falla enseña el error y Reintentar la repite", async () => {
    server.listFail = 500;
    render(
      <MemoryRouter initialEntries={["/entreno/historial"]}>
        <Routes>
          <Route path="/entreno/historial" element={<History />} />
        </Routes>
      </MemoryRouter>,
    );
    expect((await screen.findByRole("alert")).textContent).toBe("Error interno");

    server.listFail = null;
    server.workouts = [summary("w-1", "2026-11-10")];
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("1 entreno")).toBeTruthy();
  });

  it("sin conexión lo dice y deja reintentar", async () => {
    server.listFail = "offline";
    render(
      <MemoryRouter initialEntries={["/entreno/historial"]}>
        <Routes>
          <Route path="/entreno/historial" element={<History />} />
        </Routes>
      </MemoryRouter>,
    );
    expect((await screen.findByRole("status")).textContent).toBe("Sin conexión");
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeTruthy();
  });
});

describe("History: entreno manual", () => {
  async function openForm() {
    await renderHistory();
    fireEvent.click(screen.getByRole("button", { name: "Apuntar entreno pasado" }));
    await screen.findByRole("button", { name: "Guardar entreno" });
  }

  function fill(date: string, minutes: string) {
    fireEvent.change(screen.getByLabelText("Fecha"), { target: { value: date } });
    fireEvent.change(screen.getByLabelText("Duración (min)"), { target: { value: minutes } });
  }

  it("el martes pasado, con rutina y series: manda un entreno manual a las 12:00 locales y lo lista", async () => {
    await openForm();
    fill("2026-11-03", "50");
    fireEvent.change(screen.getByLabelText("Rutina"), { target: { value: "r-pecho" } });

    fireEvent.click(screen.getByRole("button", { name: "Añadir ejercicio" }));
    fireEvent.click(await screen.findByRole("button", { name: /Press banca/ }));
    fireEvent.change(screen.getByLabelText("Peso, serie 1 de Press banca"), { target: { value: "57,5" } });
    fireEvent.change(screen.getByLabelText("Repeticiones, serie 1 de Press banca"), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Añadir serie" }));
    fireEvent.change(screen.getByLabelText("Repeticiones, serie 2 de Press banca"), { target: { value: "7" } });

    fireEvent.click(screen.getByRole("button", { name: "Guardar entreno" }));
    expect(await screen.findByText("Entreno guardado.")).toBeTruthy();

    const startedAt = new Date(2026, 10, 3, 12, 0, 0).toISOString();
    expect(puts()).toHaveLength(1);
    const put = puts()[0];
    expect(put?.path).toMatch(/^\/api\/workouts\/[0-9a-f-]{36}$/);
    expect(put?.body).toEqual({
      id: put?.path.split("/").pop(),
      routineId: "r-pecho",
      startedAt,
      endedAt: new Date(Date.parse(startedAt) + 50 * 60_000).toISOString(),
      notes: "",
      source: "manual",
      exercises: [
        {
          exerciseId: "e-press",
          sets: [
            { weightKg: 57.5, reps: 8, rir: null, durationMin: null, distanceKm: null },
            { weightKg: 57.5, reps: 7, rir: null, durationMin: null, distanceKm: null },
          ],
        },
      ],
    });
    expect(startedAt.endsWith("Z")).toBe(true);
    expect(refreshSnapshot).toHaveBeenCalledTimes(1);

    // Vuelve al historial con el entreno nuevo en su semana (la del 2 al 8 de noviembre).
    const week = await screen.findByRole("region", { name: "Semana del 2 nov al 8 nov" });
    expect(within(week).getByRole("link").textContent).toContain("Martes, 3 de noviembre · 50 min");
  });

  it("sin series y libre se guarda con exercises vacío", async () => {
    await openForm();
    fill("2026-11-03", "40");
    fireEvent.click(screen.getByRole("button", { name: "Guardar entreno" }));
    await screen.findByText("Entreno guardado.");

    expect(puts()[0]?.body).toMatchObject({ routineId: null, source: "manual", exercises: [] });
  });

  it("una serie en blanco no se manda, y un ejercicio sin ninguna rellena tampoco", async () => {
    await openForm();
    fill("2026-11-03", "40");
    fireEvent.click(screen.getByRole("button", { name: "Añadir ejercicio" }));
    fireEvent.click(await screen.findByRole("button", { name: /Press banca/ }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar entreno" }));
    await screen.findByText("Entreno guardado.");

    expect(puts()[0]?.body).toMatchObject({ exercises: [] });
  });

  it("un ejercicio de cardio pide minutos y kilómetros", async () => {
    await openForm();
    fill("2026-11-03", "40");
    fireEvent.click(screen.getByRole("button", { name: "Añadir ejercicio" }));
    fireEvent.click(await screen.findByRole("button", { name: /Cinta/ }));
    fireEvent.change(screen.getByLabelText("Minutos, serie 1 de Cinta"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Distancia (km), serie 1 de Cinta"), { target: { value: "5,2" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar entreno" }));
    await screen.findByText("Entreno guardado.");

    expect(puts()[0]?.body).toMatchObject({
      exercises: [{ exerciseId: "e-cinta", sets: [{ weightKg: null, reps: null, rir: null, durationMin: 30, distanceKm: 5.2 }] }],
    });
  });

  it("no deja elegir una fecha futura: lo dice y no manda nada", async () => {
    await openForm();
    expect(screen.getByLabelText("Fecha").getAttribute("max")).toBe("2026-11-10");
    fill("2026-11-11", "40");
    fireEvent.click(screen.getByRole("button", { name: "Guardar entreno" }));

    expect((await screen.findByRole("alert")).textContent).toBe("La fecha no puede ser futura.");
    expect(puts()).toHaveLength(0);
  });

  it("hoy sí vale", async () => {
    await openForm();
    expect((screen.getByLabelText("Fecha") as HTMLInputElement).value).toBe("2026-11-10");
    fireEvent.change(screen.getByLabelText("Duración (min)"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar entreno" }));
    await screen.findByText("Entreno guardado.");
    expect(puts()).toHaveLength(1);
  });

  it("sin duración no guarda", async () => {
    await openForm();
    fireEvent.change(screen.getByLabelText("Fecha"), { target: { value: "2026-11-03" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar entreno" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Indica la duración en minutos.");
    expect(puts()).toHaveLength(0);
  });

  it("si el servidor falla enseña el error, conserva lo escrito y reintenta con el mismo id", async () => {
    server.putStatuses = [500];
    await openForm();
    fill("2026-11-03", "40");
    fireEvent.click(screen.getByRole("button", { name: "Guardar entreno" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Fallo simulado");
    expect((screen.getByLabelText("Duración (min)") as HTMLInputElement).value).toBe("40");

    fireEvent.click(screen.getByRole("button", { name: "Guardar entreno" }));
    await screen.findByText("Entreno guardado.");
    expect(puts()).toHaveLength(2);
    expect(puts()[1]?.path).toBe(puts()[0]?.path);
    expect(server.workouts).toHaveLength(1);
  });

  it("Cancelar vuelve a la lista sin guardar nada", async () => {
    await openForm();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(await screen.findByRole("button", { name: "Apuntar entreno pasado" })).toBeTruthy();
    expect(puts()).toHaveLength(0);
    expect(screen.queryByText("Entreno guardado.")).toBeNull();
  });
});
