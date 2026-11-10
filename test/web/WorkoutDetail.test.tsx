import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Exercise, Workout } from "../../src/shared/types";
import type { WorkoutSummary } from "../../src/web/historyData";
import { WorkoutDetail } from "../../src/web/screens/WorkoutDetail";
import { refreshSnapshot } from "../../src/web/session/offlineCache";

// La copia sin conexión usa IndexedDB, que aquí no importa: solo se comprueba que se pide refrescarla.
vi.mock("../../src/web/session/offlineCache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/web/session/offlineCache")>()),
  refreshSnapshot: vi.fn().mockResolvedValue(undefined),
}));

function exercise(id: string, name: string, category: Exercise["category"] = "strength", archived = false): Exercise {
  return { id, name, category, muscle: "", description: "", mediaUrl: null, isCustom: false, archived };
}

const PRESS = exercise("e-press", "Press banca");
const FONDOS = exercise("e-fondos", "Fondos");
const CINTA = exercise("e-cinta", "Cinta", "cardio");
const VIEJO = exercise("e-viejo", "Remo antiguo", "strength", true);

function set(weightKg: number | null, reps: number | null, extra: Partial<Workout["exercises"][number]["sets"][number]> = {}) {
  return { weightKg, reps, rir: null, durationMin: null, distanceKm: null, ...extra };
}

const WORKOUT: Workout = {
  id: "w-1",
  routineId: "r-pecho",
  startedAt: "2026-11-03T11:00:00.000Z",
  endedAt: "2026-11-03T11:50:00.000Z",
  localDate: "2026-11-03",
  notes: "Buen día",
  source: "manual",
  exercises: [
    { exerciseId: "e-press", sets: [set(60, 10), set(57.5, 8)] },
    { exerciseId: "e-cinta", sets: [set(null, null, { durationMin: 20, distanceKm: 3.5 })] },
    { exerciseId: "e-viejo", sets: [set(40, 12)] },
  ],
};

type Call = { method: string; path: string; body: unknown };

const server = {
  workout: WORKOUT as Workout | null,
  exercises: [PRESS, FONDOS, CINTA, VIEJO],
  workoutFail: null as "offline" | 500 | null,
  summaryFails: false,
  putStatus: 200,
  deleteStatus: 200,
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

  if (path === "/api/workouts/w-1" && method === "GET") {
    if (server.workoutFail === "offline") throw new TypeError("Failed to fetch");
    if (server.workoutFail === 500) return json(500, { error: "Error interno" });
    return server.workout ? json(200, server.workout) : json(404, { error: "Entreno no encontrado" });
  }
  if (path === "/api/exercises?archived=1") return json(200, server.exercises);
  if (path === "/api/exercises") return json(200, server.exercises.filter((e) => !e.archived));
  if (path.startsWith("/api/workouts?")) {
    if (server.summaryFails) return json(500, { error: "Error interno" });
    const summary: WorkoutSummary = { id: "w-1", routineName: "Pecho", localDate: "2026-11-03", durationMin: 50, volumeKg: 1 };
    return json(200, [summary]);
  }
  if (path === "/api/workouts/w-1" && method === "PUT") {
    if (server.putStatus !== 200) return json(server.putStatus, { error: "Fallo simulado" });
    // Como el servidor: lo que se manda es lo que queda guardado, con la fecha local que él calcula.
    const saved = { ...(body as object), localDate: "2026-11-03" } as Workout;
    server.workout = saved;
    return json(200, { workout: saved, newRecords: [] });
  }
  if (path === "/api/workouts/w-1" && method === "DELETE") {
    if (server.deleteStatus !== 200) return json(server.deleteStatus, { error: "Fallo simulado" });
    server.workout = null;
    return json(200, { deleted: true });
  }
  return json(404, { error: "No encontrado" });
}

function calls(method: string): Call[] {
  return server.calls.filter((call) => call.method === method && call.path === "/api/workouts/w-1");
}

async function renderDetail() {
  const view = render(
    <MemoryRouter initialEntries={["/entreno/historial/w-1"]}>
      <Routes>
        <Route path="/entreno/historial" element={<p>Pantalla Historial</p>} />
        <Route path="/entreno/historial/:id" element={<WorkoutDetail />} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.queryByText("Cargando…")).toBeNull());
  return view;
}

function input(label: string): HTMLInputElement {
  return screen.getByLabelText(label);
}

beforeEach(() => {
  server.workout = WORKOUT;
  server.exercises = [PRESS, FONDOS, CINTA, VIEJO];
  server.workoutFail = null;
  server.summaryFails = false;
  server.putStatus = 200;
  server.deleteStatus = 200;
  server.calls = [];
  vi.mocked(refreshSnapshot).mockClear();
  fetchMock.mockReset();
  fetchMock.mockImplementation(handle);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WorkoutDetail: lectura", () => {
  it("enseña la rutina, la fecha, los totales, las series y las notas", async () => {
    await renderDetail();

    expect(screen.getByRole("heading", { level: 1, name: "Pecho" })).toBeTruthy();
    expect(screen.getByText("Martes, 3 de noviembre")).toBeTruthy();
    // 60×10 + 57,5×8 + 40×12 = 600 + 460 + 480 = 1.540 kg; 50 min; 4 series.
    const summary = screen.getByRole("region", { name: "Resumen" });
    expect(summary.textContent).toContain("50 min");
    expect(summary.textContent).toContain("1.540 kg");
    expect(summary.textContent).toContain("Series4");

    expect(input("Peso, serie 1 de Press banca").value).toBe("60");
    expect(input("Peso, serie 2 de Press banca").value).toBe("57,5");
    expect(input("Repeticiones, serie 2 de Press banca").value).toBe("8");
    expect(input("Minutos, serie 1 de Cinta").value).toBe("20");
    expect(input("Distancia (km), serie 1 de Cinta").value).toBe("3,5");
    // Un ejercicio archivado conserva su nombre.
    expect(input("Peso, serie 1 de Remo antiguo").value).toBe("40");
    expect(screen.getByLabelText("Notas")).toHaveProperty("value", "Buen día");
  });

  it("un entreno libre se titula Entreno libre y no pide el nombre de ninguna rutina", async () => {
    server.workout = { ...WORKOUT, routineId: null };
    await renderDetail();

    expect(screen.getByRole("heading", { level: 1, name: "Entreno libre" })).toBeTruthy();
    expect(server.calls.some((call) => call.path.startsWith("/api/workouts?"))).toBe(false);
  });

  it("si no se puede saber el nombre de la rutina, el título es Entreno y el resto funciona", async () => {
    server.summaryFails = true;
    await renderDetail();

    expect(screen.getByRole("heading", { level: 1, name: "Entreno" })).toBeTruthy();
    expect(input("Peso, serie 1 de Press banca").value).toBe("60");
  });

  it("un entreno que no existe lo dice y vuelve al historial", async () => {
    server.workout = null;
    await renderDetail();

    expect(screen.getByText("Entreno no encontrado")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Volver al historial" }).getAttribute("href")).toBe("/entreno/historial");
  });

  it("si la carga falla enseña el error y Reintentar la repite", async () => {
    server.workoutFail = 500;
    await renderDetail();
    expect((await screen.findByRole("alert")).textContent).toBe("Error interno");

    server.workoutFail = null;
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Pecho" })).toBeTruthy();
  });

  it("sin conexión lo dice", async () => {
    server.workoutFail = "offline";
    await renderDetail();
    expect((await screen.findByRole("status")).textContent).toBe("Sin conexión");
  });
});

describe("WorkoutDetail: edición", () => {
  it("Guardar cambios está desactivado hasta que algo cambia", async () => {
    await renderDetail();
    const save = screen.getByRole("button", { name: "Guardar cambios" });
    expect(save).toHaveProperty("disabled", true);

    fireEvent.change(input("Peso, serie 1 de Press banca"), { target: { value: "62,5" } });
    expect(save).toHaveProperty("disabled", false);

    // Volver al valor de antes lo deja como estaba.
    fireEvent.change(input("Peso, serie 1 de Press banca"), { target: { value: "60" } });
    expect(save).toHaveProperty("disabled", true);
  });

  it("cambia una serie, añade otra y edita las notas: manda el entreno entero sin localDate", async () => {
    await renderDetail();

    fireEvent.change(input("Peso, serie 1 de Press banca"), { target: { value: "62,5" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Añadir serie" })[0]!);
    fireEvent.change(input("Repeticiones, serie 3 de Press banca"), { target: { value: "6" } });
    fireEvent.change(screen.getByLabelText("Notas"), { target: { value: "Subí peso" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(await screen.findByText("Cambios guardados.")).toBeTruthy();
    expect(calls("PUT")).toHaveLength(1);
    expect(calls("PUT")[0]?.body).toEqual({
      id: "w-1",
      routineId: "r-pecho",
      startedAt: WORKOUT.startedAt,
      endedAt: WORKOUT.endedAt,
      notes: "Subí peso",
      source: "manual",
      exercises: [
        { exerciseId: "e-press", sets: [set(62.5, 10), set(57.5, 8), set(57.5, 6)] },
        { exerciseId: "e-cinta", sets: [set(null, null, { durationMin: 20, distanceKm: 3.5 })] },
        { exerciseId: "e-viejo", sets: [set(40, 12)] },
      ],
    });
    expect(refreshSnapshot).toHaveBeenCalledTimes(1);
    // Ya está guardado: no hay nada más que guardar y los totales reflejan el cambio.
    expect(screen.getByRole("button", { name: "Guardar cambios" })).toHaveProperty("disabled", true);
    // 62,5×10 + 57,5×8 + 57,5×6 + 40×12 = 625 + 460 + 345 + 480, en 5 series.
    expect(screen.getByRole("region", { name: "Resumen" }).textContent).toContain("1.910 kg");
    expect(screen.getByRole("region", { name: "Resumen" }).textContent).toContain("Series5");
  });

  it("quitar una serie y un ejercicio entero se guarda", async () => {
    await renderDetail();

    fireEvent.click(screen.getByRole("button", { name: "Quitar serie 2 de Press banca" }));
    fireEvent.click(screen.getByRole("button", { name: "Quitar Remo antiguo" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await screen.findByText("Cambios guardados.");

    expect(calls("PUT")[0]?.body).toMatchObject({
      exercises: [
        { exerciseId: "e-press", sets: [set(60, 10)] },
        { exerciseId: "e-cinta", sets: [set(null, null, { durationMin: 20, distanceKm: 3.5 })] },
      ],
    });
  });

  it("una serie añadida y sin rellenar no se manda", async () => {
    await renderDetail();

    fireEvent.click(screen.getAllByRole("button", { name: "Añadir serie" })[1]!);
    // Copia la última serie de la cinta; se vacía.
    fireEvent.change(input("Minutos, serie 2 de Cinta"), { target: { value: "" } });
    fireEvent.change(input("Distancia (km), serie 2 de Cinta"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Notas"), { target: { value: "Otra nota" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await screen.findByText("Cambios guardados.");

    expect(calls("PUT")[0]?.body).toMatchObject({
      exercises: expect.arrayContaining([{ exerciseId: "e-cinta", sets: [set(null, null, { durationMin: 20, distanceKm: 3.5 })] }]),
    });
  });

  it("añade un ejercicio nuevo desde el selector", async () => {
    await renderDetail();

    fireEvent.click(screen.getByRole("button", { name: "Añadir ejercicio" }));
    fireEvent.click(await screen.findByRole("button", { name: /Fondos/ }));
    fireEvent.change(input("Repeticiones, serie 1 de Fondos"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await screen.findByText("Cambios guardados.");

    const sent = calls("PUT")[0]?.body as { exercises: { exerciseId: string }[] };
    expect(sent.exercises.map((e) => e.exerciseId)).toEqual(["e-press", "e-cinta", "e-viejo", "e-fondos"]);
  });

  it("si el servidor rechaza el guardado enseña el error y conserva lo editado", async () => {
    server.putStatus = 400;
    await renderDetail();

    fireEvent.change(input("Peso, serie 1 de Press banca"), { target: { value: "70" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Fallo simulado");
    expect(input("Peso, serie 1 de Press banca").value).toBe("70");
    expect(screen.getByRole("button", { name: "Guardar cambios" })).toHaveProperty("disabled", false);
    expect(refreshSnapshot).not.toHaveBeenCalled();
  });
});

describe("WorkoutDetail: borrar", () => {
  it("pide confirmación y no borra nada hasta que se confirma", async () => {
    await renderDetail();

    fireEvent.click(screen.getByRole("button", { name: "Borrar entreno" }));
    const dialog = await screen.findByRole("dialog", { name: "¿Borrar este entreno?" });
    expect(dialog.textContent).toContain("no se podrá recuperar");
    expect(calls("DELETE")).toHaveLength(0);

    // Cancelar cierra y deja el entreno donde estaba.
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(calls("DELETE")).toHaveLength(0);
    expect(screen.getByRole("heading", { level: 1, name: "Pecho" })).toBeTruthy();
  });

  it("al confirmar borra el entreno y vuelve al historial", async () => {
    await renderDetail();

    fireEvent.click(screen.getByRole("button", { name: "Borrar entreno" }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Sí, borrar" }));

    expect(await screen.findByText("Pantalla Historial")).toBeTruthy();
    expect(calls("DELETE")).toHaveLength(1);
    expect(refreshSnapshot).toHaveBeenCalledTimes(1);
  });

  it("si el borrado falla enseña el error en la confirmación y se queda en el entreno", async () => {
    server.deleteStatus = 500;
    await renderDetail();

    fireEvent.click(screen.getByRole("button", { name: "Borrar entreno" }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Sí, borrar" }));

    const dialog = await screen.findByRole("dialog");
    expect((await screen.findByRole("alert")).textContent).toBe("Fallo simulado");
    expect(dialog).toBeTruthy();
    expect(screen.queryByText("Pantalla Historial")).toBeNull();
    expect(refreshSnapshot).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Sí, borrar" })).toHaveProperty("disabled", false);
  });

  it("si el entreno ya no existía (404), también vuelve al historial", async () => {
    server.deleteStatus = 404;
    await renderDetail();

    fireEvent.click(screen.getByRole("button", { name: "Borrar entreno" }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Sí, borrar" }));

    expect(await screen.findByText("Pantalla Historial")).toBeTruthy();
  });
});
