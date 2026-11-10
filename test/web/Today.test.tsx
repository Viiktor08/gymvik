import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Exercise, Routine, Settings } from "../../src/shared/types";
import { Today } from "../../src/web/screens/Today";
import type { TodayData } from "../../src/web/todayData";

const draftStore = vi.hoisted(() => ({ hasDraft: vi.fn<() => Promise<boolean>>() }));

vi.mock("../../src/web/session/draftStore", () => draftStore);

function exercise(id: string, name: string): Exercise {
  return { id, name, category: "strength", muscle: "", description: "", mediaUrl: null, isCustom: false, archived: false };
}

const ROUTINE: Routine = {
  id: "r-pecho",
  name: "Pecho y tríceps",
  inRotation: true,
  rotationOrder: 0,
  archived: false,
  items: [
    { exerciseId: "e-fondos", position: 1, sets: 3, repsTarget: "12", restSeconds: 60 },
    { exerciseId: "e-press", position: 0, sets: 4, repsTarget: "8-10", restSeconds: 90 },
  ],
};

function todayData(overrides: Partial<TodayData> = {}): TodayData {
  return {
    date: "2026-11-10",
    displayName: "Victor",
    streak: 3,
    next: { routine: ROUTINE, estimatedMin: 45 },
    steps: 4210,
    stepsGoal: 8000,
    lastWeight: { localDate: "2026-11-09", weightKg: 74.3, bodyFatPct: 18.5 },
    weekWeightDelta: -0.4,
    creatineToday: false,
    week: { count: 1, goal: 3, days: [true, false, false, false, false, false, false] },
    ...overrides,
  };
}

type Call = { method: string; path: string; body: unknown };

// Estado del servidor simulado: cada test lo ajusta antes de pintar la pantalla.
const server = {
  today: todayData(),
  // `archived=1` también trae los archivados: una rutina puede conservar un ejercicio archivado.
  exercises: [exercise("e-press", "Press banca"), exercise("e-fondos", "Fondos")],
  settings: { shortcutName: "Gymvik Pasos" } as Partial<Settings>,
  todayFails: null as "offline" | 500 | null,
  // Si se activa, la siguiente petición a /api/today se queda esperando hasta que se llame a `releaseToday`.
  holdNextToday: false,
  releaseToday: null as (() => void) | null,
  exercisesFail: false,
  settingsFail: false,
  creatineDelete: 200 as number,
  creatinePut: 200 as number,
  bodyMetricsPut: 200 as number,
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

  if (path === "/api/today") {
    if (server.holdNextToday) {
      server.holdNextToday = false;
      return new Promise<Response>((resolve) => {
        server.releaseToday = () => resolve(json(200, server.today));
      });
    }
    if (server.todayFails === "offline") throw new TypeError("Failed to fetch");
    if (server.todayFails === 500) return json(500, { error: "Error interno" });
    return json(200, server.today);
  }
  if (path.startsWith("/api/exercises")) {
    return server.exercisesFail ? json(500, { error: "Error interno" }) : json(200, server.exercises);
  }
  if (path === "/api/settings") {
    return server.settingsFail ? json(500, { error: "Error interno" }) : json(200, server.settings);
  }
  if (path.startsWith("/api/creatine/")) {
    const status = method === "PUT" ? server.creatinePut : server.creatineDelete;
    // Como el servidor de verdad: tras un PUT correcto está tomada, y tras un DELETE (o un 404) no lo está.
    if (status === 200 || status === 404) server.today = { ...server.today, creatineToday: method === "PUT" };
    return status === 200 ? json(200, method === "PUT" ? { grams: 5 } : { deleted: true }) : json(status, { error: "Fallo simulado" });
  }
  if (path.startsWith("/api/body-metrics/") && method === "PUT") {
    if (server.bodyMetricsPut !== 200) return json(server.bodyMetricsPut, { error: "Fallo simulado" });
    const saved = body as { weightKg: number; bodyFatPct?: number | null };
    server.today = {
      ...server.today,
      lastWeight: { localDate: server.today.date, weightKg: saved.weightKg, bodyFatPct: saved.bodyFatPct ?? null },
    };
    return json(200, server.today.lastWeight);
  }
  return json(404, { error: "No encontrado" });
}

function callsTo(method: string, pathPrefix: string): Call[] {
  return server.calls.filter((call) => call.method === method && call.path.startsWith(pathPrefix));
}

function renderToday(entry = "/") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/" element={<Today />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Pinta la pantalla y espera a que termine de cargar. */
async function renderLoaded(entry = "/") {
  const view = renderToday(entry);
  await screen.findByRole("heading", { level: 1, name: /Hola|Hoy/ });
  await waitFor(() => expect(screen.queryByText("Cargando…")).toBeNull());
  return view;
}

beforeEach(() => {
  server.today = todayData();
  server.exercises = [exercise("e-press", "Press banca"), exercise("e-fondos", "Fondos")];
  server.settings = { shortcutName: "Gymvik Pasos" };
  server.todayFails = null;
  server.holdNextToday = false;
  server.releaseToday = null;
  server.exercisesFail = false;
  server.settingsFail = false;
  server.creatineDelete = 200;
  server.creatinePut = 200;
  server.bodyMetricsPut = 200;
  server.calls = [];
  fetchMock.mockReset();
  fetchMock.mockImplementation(handle);
  vi.stubGlobal("fetch", fetchMock);
  draftStore.hasDraft.mockReset();
  draftStore.hasDraft.mockResolvedValue(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Hoy: casos del plan", () => {
  it("sin rutina que toque invita a crear la primera y no muestra Infinity ni NaN", async () => {
    server.today = todayData({
      next: null,
      steps: null,
      lastWeight: null,
      weekWeightDelta: null,
      streak: 0,
      week: { count: 0, goal: 3, days: Array(7).fill(false) as boolean[] },
    });
    await renderLoaded();
    expect(screen.getByText("Crea tu primera rutina")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Infinity|NaN/);
  });

  it("con 4 entrenos y objetivo 3 muestra 4/3 tal cual", async () => {
    server.today = todayData({
      week: { count: 4, goal: 3, days: [true, true, false, true, true, false, false] },
    });
    await renderLoaded();
    expect(screen.getByText("4/3")).toBeTruthy();
  });
});

describe("Hoy: cabecera", () => {
  it("saluda por el nombre, pone la fecha en español y la racha en semanas", async () => {
    await renderLoaded();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Hola, Victor");
    expect(screen.getByText("Martes, 10 de noviembre")).toBeTruthy();
    expect(screen.getByText("3 semanas")).toBeTruthy();
  });

  it("la racha de una semana va en singular y la de cero semanas no desaparece", async () => {
    server.today = todayData({ streak: 1 });
    const { unmount } = await renderLoaded();
    expect(screen.getByText("1 semana")).toBeTruthy();
    unmount();

    server.today = todayData({ streak: 0 });
    await renderLoaded();
    expect(screen.getByText("0 semanas")).toBeTruthy();
  });

  it("sin nombre saluda sin dejar una coma suelta", async () => {
    server.today = todayData({ displayName: "" });
    await renderLoaded();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Hola");
  });

  it("la fecha sale del texto YYYY-MM-DD en UTC, sin desfase de día en zonas al oeste", async () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    server.today = todayData({ date: "2026-11-01" });
    await renderLoaded();
    expect(screen.getByText("Domingo, 1 de noviembre")).toBeTruthy();
  });
});

describe("Hoy: Te toca hoy", () => {
  it("muestra la rutina, la duración estimada y sus ejercicios por orden con series y repeticiones", async () => {
    await renderLoaded();
    const card = screen.getByRole("region", { name: "Te toca hoy" });
    expect(within(card).getByText("Pecho y tríceps")).toBeTruthy();
    expect(within(card).getByText(/45 min/)).toBeTruthy();
    expect(within(card).getByText(/2 ejercicios/)).toBeTruthy();
    const items = within(card)
      .getAllByRole("listitem")
      .map((item) => item.textContent);
    expect(items).toEqual(["Press banca4 × 8-10", "Fondos3 × 12"]);
  });

  it("Empezar lleva a la sesión de esa rutina y Hacer otra a Entreno", async () => {
    await renderLoaded();
    expect(screen.getByRole("link", { name: "Empezar" }).getAttribute("href")).toBe("/entreno/sesion?rutina=r-pecho");
    expect(screen.getByRole("link", { name: "Hacer otra" }).getAttribute("href")).toBe("/entreno");
  });

  it("pide los ejercicios con los archivados para poder nombrar los de la rutina", async () => {
    await renderLoaded();
    expect(callsTo("GET", "/api/exercises").map((call) => call.path)).toEqual(["/api/exercises?archived=1"]);
  });

  it("si no se pueden cargar los ejercicios muestra la rutina sin nombres, no rompe", async () => {
    server.exercisesFail = true;
    await renderLoaded();
    const card = screen.getByRole("region", { name: "Te toca hoy" });
    expect(within(card).getByText("Pecho y tríceps")).toBeTruthy();
    expect(within(card).getByText(/2 ejercicios/)).toBeTruthy();
    expect(within(card).queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByRole("link", { name: "Empezar" })).toBeTruthy();
  });

  it("no enseña una duración que no sea un número válido", async () => {
    server.today = todayData({ next: { routine: ROUTINE, estimatedMin: Number.NaN } });
    await renderLoaded();
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/);
  });

  it("sin rutina en rotación ofrece crear una y no muestra Empezar", async () => {
    server.today = todayData({ next: null });
    await renderLoaded();
    expect(screen.getByRole("link", { name: "Crear rutina" }).getAttribute("href")).toBe("/entreno/rutina/nueva");
    expect(screen.queryByRole("link", { name: "Empezar" })).toBeNull();
  });
});

describe("Hoy: pasos", () => {
  it("muestra los pasos de hoy frente al objetivo con punto de millares", async () => {
    await renderLoaded();
    const card = screen.getByRole("region", { name: "Pasos" });
    expect(within(card).getByText("4.210")).toBeTruthy();
    expect(within(card).getByText(/8\.000/)).toBeTruthy();
    const bar = within(card).getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("4210");
    expect(bar.getAttribute("aria-valuemax")).toBe("8000");
  });

  it("sin datos de pasos muestra — y Sin datos todavía", async () => {
    server.today = todayData({ steps: null });
    await renderLoaded();
    const card = screen.getByRole("region", { name: "Pasos" });
    expect(within(card).getByText("—")).toBeTruthy();
    expect(within(card).getByText("Sin datos todavía")).toBeTruthy();
    expect(within(card).queryByRole("progressbar")).toBeNull();
  });

  it("0 pasos es un dato real, no la ausencia de datos", async () => {
    server.today = todayData({ steps: 0 });
    await renderLoaded();
    const card = screen.getByRole("region", { name: "Pasos" });
    expect(within(card).getByText("0")).toBeTruthy();
    expect(within(card).queryByText("Sin datos todavía")).toBeNull();
  });

  it("superar el objetivo no desborda la barra ni da un porcentaje raro", async () => {
    server.today = todayData({ steps: 12000, stepsGoal: 8000 });
    await renderLoaded();
    const bar = within(screen.getByRole("region", { name: "Pasos" })).getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("8000");
  });

  it("un objetivo de 0 pasos no divide por cero", async () => {
    server.today = todayData({ steps: 500, stepsGoal: 0 });
    await renderLoaded();
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/);
  });

  it("Sincronizar abre el Atajo con el nombre y el origen codificados", async () => {
    server.settings = { shortcutName: "Pasos & Salud ñ" };
    await renderLoaded();
    const link = screen.getByRole("link", { name: "Sincronizar" });
    expect(link.getAttribute("href")).toBe(
      `shortcuts://run-shortcut?name=${encodeURIComponent("Pasos & Salud ñ")}&x-success=${encodeURIComponent(location.origin)}`,
    );
  });

  it("sin el nombre del Atajo (ajustes no disponibles) no ofrece Sincronizar", async () => {
    server.settingsFail = true;
    await renderLoaded();
    expect(screen.queryByRole("link", { name: "Sincronizar" })).toBeNull();
    expect(screen.getByRole("region", { name: "Pasos" })).toBeTruthy();
  });
});

describe("Hoy: peso", () => {
  it("muestra el último peso con coma decimal, la grasa y la tendencia de la semana", async () => {
    await renderLoaded();
    const card = screen.getByRole("region", { name: "Peso" });
    expect(within(card).getByText("74,3 kg")).toBeTruthy();
    expect(within(card).getByText(/18,5 % de grasa/)).toBeTruthy();
    expect(within(card).getByText(/−0,4 kg esta semana/)).toBeTruthy();
  });

  it("una subida lleva signo más y sin cambios se dice que se mantiene", async () => {
    server.today = todayData({ weekWeightDelta: 0.6 });
    const { unmount } = await renderLoaded();
    expect(screen.getByText(/\+0,6 kg esta semana/)).toBeTruthy();
    unmount();

    server.today = todayData({ weekWeightDelta: 0 });
    await renderLoaded();
    expect(screen.getByText("Sin cambios esta semana")).toBeTruthy();
  });

  it("sin tendencia no inventa una", async () => {
    server.today = todayData({ weekWeightDelta: null });
    await renderLoaded();
    expect(screen.getByText("Sin tendencia esta semana")).toBeTruthy();
  });

  it("sin ningún peso muestra — y Sin datos todavía", async () => {
    server.today = todayData({ lastWeight: null, weekWeightDelta: null });
    await renderLoaded();
    const card = screen.getByRole("region", { name: "Peso" });
    expect(within(card).getByText("—")).toBeTruthy();
    expect(within(card).getByText("Sin datos todavía")).toBeTruthy();
  });

  it("sin grasa guardada no escribe la línea de grasa", async () => {
    server.today = todayData({ lastWeight: { localDate: "2026-11-09", weightKg: 74.3, bodyFatPct: null } });
    await renderLoaded();
    expect(screen.queryByText(/de grasa/)).toBeNull();
  });
});

describe("Hoy: hoja Apuntar peso", () => {
  async function openSheet() {
    fireEvent.click(screen.getByRole("button", { name: "Apuntar peso" }));
    return screen.findByRole("dialog", { name: "Apuntar peso" });
  }

  it("guarda el peso con coma y la grasa, cierra la hoja y recarga Hoy", async () => {
    await renderLoaded();
    const dialog = await openSheet();
    fireEvent.change(within(dialog).getByLabelText("Peso (kg)"), { target: { value: "57,5" } });
    fireEvent.change(within(dialog).getByLabelText("% de grasa (opcional)"), { target: { value: "18,2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(callsTo("PUT", "/api/body-metrics/")).toEqual([
      { method: "PUT", path: "/api/body-metrics/2026-11-10", body: { weightKg: 57.5, bodyFatPct: 18.2 } },
    ]);
    // La pantalla se vuelve a pedir y enseña el peso nuevo.
    expect(await screen.findByText("57,5 kg")).toBeTruthy();
    expect(callsTo("GET", "/api/today").length).toBeGreaterThanOrEqual(2);
  });

  it("la grasa es opcional: vacía se envía como null", async () => {
    await renderLoaded();
    const dialog = await openSheet();
    fireEvent.change(within(dialog).getByLabelText("Peso (kg)"), { target: { value: "80" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(callsTo("PUT", "/api/body-metrics/")[0]?.body).toEqual({ weightKg: 80, bodyFatPct: null });
  });

  it("sin peso, con peso 0 o con grasa fuera de 0–100 avisa y no llama a la API", async () => {
    await renderLoaded();
    const dialog = await openSheet();
    const save = () => fireEvent.click(within(dialog).getByRole("button", { name: "Guardar" }));

    save();
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(/peso/i);

    fireEvent.change(within(dialog).getByLabelText("Peso (kg)"), { target: { value: "0" } });
    save();
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(/peso/i);

    fireEvent.change(within(dialog).getByLabelText("Peso (kg)"), { target: { value: "70" } });
    fireEvent.change(within(dialog).getByLabelText("% de grasa (opcional)"), { target: { value: "120" } });
    save();
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(/grasa/i);

    expect(callsTo("PUT", "/api/body-metrics/")).toHaveLength(0);
  });

  it("si el servidor falla deja la hoja abierta con el mensaje y lo escrito", async () => {
    server.bodyMetricsPut = 500;
    await renderLoaded();
    const dialog = await openSheet();
    fireEvent.change(within(dialog).getByLabelText("Peso (kg)"), { target: { value: "70" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar" }));

    expect((await within(dialog).findByRole("alert")).textContent).toBe("Fallo simulado");
    expect(screen.getByRole("dialog", { name: "Apuntar peso" })).toBeTruthy();
    expect((within(dialog).getByLabelText("Peso (kg)") as HTMLInputElement).value).toBe("70");
  });

  it("?peso=1 abre la hoja nada más entrar", async () => {
    await renderLoaded("/?peso=1");
    expect(await screen.findByRole("dialog", { name: "Apuntar peso" })).toBeTruthy();
  });

  it("sin ?peso=1 la hoja empieza cerrada y al cerrarla se queda cerrada", async () => {
    await renderLoaded();
    expect(screen.queryByRole("dialog")).toBeNull();
    const dialog = await openSheet();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cerrar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("cerrar una hoja abierta con ?peso=1 no la reabre", async () => {
    await renderLoaded("/?peso=1");
    const dialog = await screen.findByRole("dialog", { name: "Apuntar peso" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cerrar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("Hoy: creatina", () => {
  it("empieza sin tomar y al tocar la marca con PUT en la fecha de hoy", async () => {
    await renderLoaded();
    const button = screen.getByRole("button", { name: /Creatina/ });
    expect(button.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(button);
    await waitFor(() => expect(button.getAttribute("aria-pressed")).toBe("true"));
    expect(callsTo("PUT", "/api/creatine/").map((call) => call.path)).toEqual(["/api/creatine/2026-11-10"]);
    expect(within(button).getByText(/Tomada/)).toBeTruthy();
  });

  it("si ya estaba tomada, tocar la desmarca con DELETE", async () => {
    server.today = todayData({ creatineToday: true });
    await renderLoaded();
    const button = screen.getByRole("button", { name: /Creatina/ });
    expect(button.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(button);
    await waitFor(() => expect(button.getAttribute("aria-pressed")).toBe("false"));
    expect(callsTo("DELETE", "/api/creatine/").map((call) => call.path)).toEqual(["/api/creatine/2026-11-10"]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("un 404 al desmarcar significa que ya estaba desmarcada: no es un error", async () => {
    server.today = todayData({ creatineToday: true });
    server.creatineDelete = 404;
    await renderLoaded();
    const button = screen.getByRole("button", { name: /Creatina/ });

    fireEvent.click(button);
    await waitFor(() => expect(callsTo("DELETE", "/api/creatine/")).toHaveLength(1));
    await waitFor(() => expect(button.getAttribute("aria-pressed")).toBe("false"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("si falla al marcar vuelve al estado anterior y avisa", async () => {
    server.creatinePut = 500;
    await renderLoaded();
    const button = screen.getByRole("button", { name: /Creatina/ });

    fireEvent.click(button);
    expect((await screen.findByRole("alert")).textContent).toBe("Fallo simulado");
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });

  it("si falla al desmarcar (que no sea 404) sigue marcada y avisa", async () => {
    server.today = todayData({ creatineToday: true });
    server.creatineDelete = 500;
    await renderLoaded();
    const button = screen.getByRole("button", { name: /Creatina/ });

    fireEvent.click(button);
    expect((await screen.findByRole("alert")).textContent).toBe("Fallo simulado");
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });

  it("sin conexión al marcar avisa de que no hay conexión y no deja la marca puesta", async () => {
    await renderLoaded();
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input).startsWith("/api/creatine/")) throw new TypeError("Failed to fetch");
      return handle(input, init);
    });
    const button = screen.getByRole("button", { name: /Creatina/ });

    fireEvent.click(button);
    expect((await screen.findByRole("alert")).textContent).toBe("Sin conexión");
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });

  it("mientras se guarda ignora otros toques, para no mandar dos peticiones", async () => {
    await renderLoaded();
    const button = screen.getByRole("button", { name: /Creatina/ });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(button.getAttribute("aria-pressed")).toBe("true"));
    expect(server.calls.filter((call) => call.path.startsWith("/api/creatine/"))).toHaveLength(1);
  });
});

describe("Hoy: creatina al cambiar los datos del servidor", () => {
  it("de un día para otro la tarjeta no se queda en Tomada hoy", async () => {
    await renderLoaded();
    const button = screen.getByRole("button", { name: /Creatina/ });
    fireEvent.click(button);
    await waitFor(() => expect(button.getAttribute("aria-pressed")).toBe("true"));

    // La app pasa la noche en segundo plano: al volver, Hoy es otro día y la creatina no está tomada.
    server.today = todayData({ date: "2026-11-11", creatineToday: false });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(await screen.findByText("Miércoles, 11 de noviembre")).toBeTruthy();
    const fresh = screen.getByRole("button", { name: /Creatina/ });
    expect(fresh.getAttribute("aria-pressed")).toBe("false");
    expect(within(fresh).getByText("Sin tomar hoy")).toBeTruthy();

    // Y el siguiente toque marca el día nuevo (PUT), no intenta desmarcarlo (DELETE).
    server.calls = [];
    fireEvent.click(fresh);
    await waitFor(() => expect(callsTo("PUT", "/api/creatine/")).toHaveLength(1));
    expect(callsTo("PUT", "/api/creatine/")[0]?.path).toBe("/api/creatine/2026-11-11");
    expect(callsTo("DELETE", "/api/creatine/")).toHaveLength(0);
  });

  it("el mismo día, si el servidor dice que ya no está tomada (otro dispositivo), se actualiza", async () => {
    await renderLoaded();
    const button = screen.getByRole("button", { name: /Creatina/ });
    fireEvent.click(button);
    await waitFor(() => expect(button.getAttribute("aria-pressed")).toBe("true"));

    server.today = todayData({ creatineToday: false });
    document.dispatchEvent(new Event("visibilitychange"));

    await waitFor(() => expect(screen.getByRole("button", { name: /Creatina/ }).getAttribute("aria-pressed")).toBe("false"));
  });

  it("tras marcarla se mantiene marcada aunque Hoy se refresque con ella marcada", async () => {
    await renderLoaded();
    const button = screen.getByRole("button", { name: /Creatina/ });
    fireEvent.click(button);
    await waitFor(() => expect(button.getAttribute("aria-pressed")).toBe("true"));

    // Los pasos nuevos prueban que el refresco ya se ha pintado.
    server.today = todayData({ creatineToday: true, steps: 6000 });
    document.dispatchEvent(new Event("visibilitychange"));
    await screen.findByText("6.000");
    expect(screen.getByRole("button", { name: /Creatina/ }).getAttribute("aria-pressed")).toBe("true");
  });
});

describe("Hoy: semana", () => {
  it("pinta los siete días de lunes a domingo con los entrenos marcados y el contador", async () => {
    server.today = todayData({ week: { count: 2, goal: 3, days: [true, false, true, false, false, false, false] } });
    await renderLoaded();
    const card = screen.getByRole("region", { name: "Esta semana" });
    expect(within(card).getByText("2/3")).toBeTruthy();
    const days = within(card)
      .getAllByRole("listitem")
      .map((item) => item.getAttribute("aria-label"));
    expect(days).toEqual([
      "Lunes: con entreno",
      "Martes: sin entreno",
      "Miércoles: con entreno",
      "Jueves: sin entreno",
      "Viernes: sin entreno",
      "Sábado: sin entreno",
      "Domingo: sin entreno",
    ]);
  });

  it("marca el día de hoy", async () => {
    await renderLoaded();
    const card = screen.getByRole("region", { name: "Esta semana" });
    const current = within(card)
      .getAllByRole("listitem")
      .filter((item) => item.getAttribute("aria-current") === "date");
    expect(current.map((item) => item.getAttribute("aria-label"))).toEqual(["Martes: sin entreno"]);
  });

  it("si se cumple el objetivo lo dice, también al pasarse", async () => {
    server.today = todayData({ week: { count: 4, goal: 3, days: [true, true, false, true, true, false, false] } });
    await renderLoaded();
    expect(screen.getByText("Objetivo cumplido")).toBeTruthy();
  });

  it("si aún no se cumple no lo dice", async () => {
    await renderLoaded();
    expect(screen.queryByText("Objetivo cumplido")).toBeNull();
  });
});

describe("Hoy: entreno en curso", () => {
  it("con una sesión guardada en el móvil muestra el aviso y Continuar", async () => {
    draftStore.hasDraft.mockResolvedValue(true);
    await renderLoaded();
    expect(await screen.findByText("Tienes un entreno en curso")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Continuar" }).getAttribute("href")).toBe("/entreno/sesion");
  });

  it("sin sesión guardada no hay aviso", async () => {
    await renderLoaded();
    await waitFor(() => expect(draftStore.hasDraft).toHaveBeenCalled());
    expect(screen.queryByText("Tienes un entreno en curso")).toBeNull();
  });

  it("si IndexedDB falla se queda sin aviso, sin romper la pantalla", async () => {
    draftStore.hasDraft.mockRejectedValue(new Error("IndexedDB no disponible"));
    await renderLoaded();
    await waitFor(() => expect(draftStore.hasDraft).toHaveBeenCalled());
    expect(screen.queryByText("Tienes un entreno en curso")).toBeNull();
    expect(screen.getByRole("link", { name: "Empezar" })).toBeTruthy();
  });

  it("el aviso sale aunque Hoy no cargue (sin conexión se puede seguir entrenando)", async () => {
    draftStore.hasDraft.mockResolvedValue(true);
    server.todayFails = "offline";
    renderToday();
    expect(await screen.findByText("Tienes un entreno en curso")).toBeTruthy();
    expect(await screen.findByText("Sin conexión")).toBeTruthy();
  });
});

describe("Hoy: carga y errores", () => {
  it("mientras carga dice Cargando…", async () => {
    renderToday();
    expect(screen.getByText("Cargando…")).toBeTruthy();
    await screen.findByRole("heading", { level: 1, name: "Hola, Victor" });
  });

  it("sin conexión muestra Sin conexión y Reintentar, sin romperse", async () => {
    server.todayFails = "offline";
    renderToday();
    expect(await screen.findByText("Sin conexión")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Infinity|NaN|undefined/);
  });

  it("Reintentar vuelve a pedir Hoy y pinta la pantalla cuando ya hay red", async () => {
    server.todayFails = "offline";
    renderToday();
    await screen.findByText("Sin conexión");

    server.todayFails = null;
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Hola, Victor" })).toBeTruthy();
    expect(screen.queryByText("Sin conexión")).toBeNull();
  });

  it("un error del servidor enseña su mensaje", async () => {
    server.todayFails = 500;
    renderToday();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Error interno");
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeTruthy();
  });

  it("al volver a la app (Atajo, otra pestaña) se refrescan los datos sin parpadeo", async () => {
    await renderLoaded();
    expect(screen.getByText("4.210")).toBeTruthy();

    server.today = todayData({ steps: 6000 });
    document.dispatchEvent(new Event("visibilitychange"));

    expect(await screen.findByText("6.000")).toBeTruthy();
    expect(screen.queryByText("Cargando…")).toBeNull();
  });

  it("si vuelves a la app mientras carga y ese segundo intento falla, sale Sin conexión y Reintentar, no Cargando… para siempre", async () => {
    server.holdNextToday = true;
    renderToday();
    expect(screen.getByText("Cargando…")).toBeTruthy();
    await waitFor(() => expect(callsTo("GET", "/api/today")).toHaveLength(1));

    // La primera petición sigue pendiente; al volver a la app se pide otra y esa falla.
    server.todayFails = "offline";
    document.dispatchEvent(new Event("visibilitychange"));

    expect(await screen.findByText("Sin conexión")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeTruthy();
    expect(screen.queryByText("Cargando…")).toBeNull();

    // La primera respuesta llega tarde: ya no vale y no pisa el estado actual.
    server.releaseToday?.();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByText("Sin conexión")).toBeTruthy();
  });

  it("si vuelves a la app mientras carga y la segunda petición sale bien, se pinta la pantalla", async () => {
    server.holdNextToday = true;
    renderToday();
    await waitFor(() => expect(callsTo("GET", "/api/today")).toHaveLength(1));

    document.dispatchEvent(new Event("visibilitychange"));

    expect(await screen.findByRole("heading", { level: 1, name: "Hola, Victor" })).toBeTruthy();
    expect(screen.queryByText("Cargando…")).toBeNull();
  });

  it("estando en error, volver a la app lo reintenta", async () => {
    server.todayFails = "offline";
    renderToday();
    await screen.findByText("Sin conexión");

    server.todayFails = null;
    document.dispatchEvent(new Event("visibilitychange"));

    expect(await screen.findByRole("heading", { level: 1, name: "Hola, Victor" })).toBeTruthy();
  });

  it("un refresco que falla deja en pantalla los datos que ya había", async () => {
    await renderLoaded();
    server.todayFails = "offline";
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(callsTo("GET", "/api/today").length).toBeGreaterThanOrEqual(2));
    expect(screen.getByText("4.210")).toBeTruthy();
    expect(screen.queryByText("Sin conexión")).toBeNull();
  });
});
