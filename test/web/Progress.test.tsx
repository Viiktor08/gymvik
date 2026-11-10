import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WeeklySummary } from "../../src/shared/weekly";
import type { Category, Exercise } from "../../src/shared/types";
import { ChartBoundary } from "../../src/web/components/LazyCharts";
import { NBSP } from "../../src/web/format";
import type { ExerciseProgress, WeekProgress, WeightPoint, WeightRange } from "../../src/web/progressData";
import { Progress } from "../../src/web/screens/Progress";

const EMPTY_SUMMARY: WeeklySummary = { workouts: 0, volumeKg: 0, cardioMin: 0, cardioKm: 0, avgSteps: null, creatineDays: 0 };
const EMPTY_WEEK: WeekProgress = { current: EMPTY_SUMMARY, previous: EMPTY_SUMMARY, streak: 0, goal: 3 };

function exercise(id: string, name: string, category: Category = "strength", archived = false): Exercise {
  return { id, name, category, muscle: "", description: "", mediaUrl: null, isCustom: false, archived };
}

const PRESS = exercise("e-press", "Press banca");
const RUN = exercise("e-run", "Correr", "cardio");

const WEIGHTS: WeightPoint[] = [
  { localDate: "2026-11-02", weightKg: 75, bodyFatPct: null, avg7: 75 },
  { localDate: "2026-11-05", weightKg: 74.4, bodyFatPct: 18.5, avg7: 74.7 },
  { localDate: "2026-11-09", weightKg: 74.2, bodyFatPct: 18.2, avg7: 74.53 },
];

const STRENGTH_PROGRESS: ExerciseProgress = {
  sessions: [
    { localDate: "2026-11-02", maxWeight: 55, best1RM: 73.5, volume: 550, maxDistance: null, bestPace: null },
    { localDate: "2026-11-09", maxWeight: 60, best1RM: 80, volume: 1060, maxDistance: null, bestPace: null },
  ],
  records: {
    maxWeight: { value: 60, localDate: "2026-11-09" },
    best1RM: { value: 80, localDate: "2026-11-09" },
    volume: { value: 4362.5, localDate: "2026-11-02" },
  },
};

const CARDIO_PROGRESS: ExerciseProgress = {
  sessions: [
    { localDate: "2026-11-02", maxWeight: null, best1RM: null, volume: 0, maxDistance: 3.2, bestPace: 6 },
    { localDate: "2026-11-09", maxWeight: null, best1RM: null, volume: 0, maxDistance: 5, bestPace: 5.5 },
  ],
  records: { maxDistance: { value: 5, localDate: "2026-11-09" }, bestPace: { value: 5.5, localDate: "2026-11-09" } },
};

type Failure = "offline" | 500 | null;

const server = {
  weight: { "4w": [], "12w": [], all: [] } as Record<WeightRange, WeightPoint[]>,
  week: EMPTY_WEEK,
  exercises: [] as Exercise[],
  progress: {} as Record<string, ExerciseProgress>,
  weightFail: null as Failure,
  weekFail: null as Failure,
  exercisesFail: null as Failure,
  progressFail: false,
  /** Si no es `null`, la respuesta del peso espera a que se llame a esta función. */
  weightGate: null as Promise<void> | null,
  calls: [] as string[],
};

const fetchMock = vi.fn<typeof fetch>();

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function failWith(failure: Exclude<Failure, null>): Response {
  if (failure === "offline") throw new TypeError("Failed to fetch");
  return json(failure, { error: "Error interno" });
}

async function handle(input: RequestInfo | URL): Promise<Response> {
  const path = String(input);
  server.calls.push(path);

  if (path.startsWith("/api/progress/weight?range=")) {
    if (server.weightGate) await server.weightGate;
    if (server.weightFail) return failWith(server.weightFail);
    return json(200, { points: server.weight[path.split("=")[1] as WeightRange] });
  }
  if (path === "/api/progress/week") {
    return server.weekFail ? failWith(server.weekFail) : json(200, server.week);
  }
  if (path === "/api/exercises?archived=1") {
    return server.exercisesFail ? failWith(server.exercisesFail) : json(200, server.exercises);
  }
  if (path.startsWith("/api/progress/exercise/")) {
    if (server.progressFail) return json(500, { error: "Error interno" });
    const id = decodeURIComponent(path.slice("/api/progress/exercise/".length));
    return json(200, server.progress[id] ?? { sessions: [], records: {} });
  }
  return json(404, { error: "No encontrado" });
}

function Where() {
  const location = useLocation();
  return <p data-testid="where">{`${location.pathname}${location.search}`}</p>;
}

function renderProgress(entry = "/progreso") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="/progreso"
          element={
            <>
              <Progress />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

const where = () => screen.getByTestId("where").textContent;
const panel = () => screen.getByRole("tabpanel");
const callsTo = (path: string) => server.calls.filter((call) => call === path);

/** Espera a que ni los datos ni el trozo diferido de las gráficas sigan cargándose. */
async function settled() {
  await waitFor(() => {
    expect(screen.queryByText("Cargando…")).toBeNull();
    expect(screen.queryByText("Cargando gráfica…")).toBeNull();
  });
}

beforeEach(() => {
  server.weight = { "4w": [], "12w": [], all: [] };
  server.week = EMPTY_WEEK;
  server.exercises = [];
  server.progress = {};
  server.weightFail = null;
  server.weekFail = null;
  server.exercisesFail = null;
  server.progressFail = false;
  server.weightGate = null;
  server.calls = [];
  fetchMock.mockReset();
  fetchMock.mockImplementation(handle);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Progreso: sin datos", () => {
  it.each([
    ["peso", "Peso"],
    ["semana", "Semana"],
    ["ejercicios", "Ejercicios"],
  ])("la pestaña %s muestra Sin datos todavía y nunca Infinity ni NaN", async (tab) => {
    renderProgress(`/progreso?tab=${tab}`);
    await settled();
    expect(within(panel()).getAllByText("Sin datos todavía")).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(/Infinity|NaN/);
  });

  it("un ejercicio sin sesiones tampoco enseña récords ni gráfica", async () => {
    server.exercises = [PRESS];
    renderProgress("/progreso?tab=ejercicios");
    await settled();
    fireEvent.change(await screen.findByLabelText("Ejercicio"), { target: { value: "e-press" } });
    await settled();
    expect(within(panel()).getAllByText("Sin datos todavía")).toHaveLength(1);
    expect(screen.queryByText("Mayor peso")).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
    expect(document.body.textContent).not.toMatch(/Infinity|NaN/);
  });
});

describe("Progreso: pestañas", () => {
  it("sin ?tab= abre Peso, la marca y pide el peso de 12 semanas", async () => {
    renderProgress();
    await settled();
    expect(screen.getByRole("tab", { name: "Peso" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Semana" }).getAttribute("aria-selected")).toBe("false");
    expect(callsTo("/api/progress/weight?range=12w")).toHaveLength(1);
    expect(callsTo("/api/progress/week")).toHaveLength(0);
  });

  it.each([
    ["semana", "Semana", "/api/progress/week"],
    ["ejercicios", "Ejercicios", "/api/exercises?archived=1"],
  ])("?tab=%s abre %s", async (tab, name, path) => {
    renderProgress(`/progreso?tab=${tab}`);
    await settled();
    expect(screen.getByRole("tab", { name }).getAttribute("aria-selected")).toBe("true");
    expect(callsTo(path)).toHaveLength(1);
    expect(callsTo("/api/progress/weight?range=12w")).toHaveLength(0);
  });

  it("un ?tab= desconocido cae en Peso", async () => {
    renderProgress("/progreso?tab=otra");
    await settled();
    expect(screen.getByRole("tab", { name: "Peso" }).getAttribute("aria-selected")).toBe("true");
  });

  it("pulsar una pestaña actualiza ?tab= y cambia el panel", async () => {
    renderProgress();
    await settled();
    fireEvent.click(screen.getByRole("tab", { name: "Semana" }));
    expect(where()).toBe("/progreso?tab=semana");
    expect(screen.getByRole("tab", { name: "Semana" }).getAttribute("aria-selected")).toBe("true");
    await settled();
    expect(callsTo("/api/progress/week")).toHaveLength(1);

    fireEvent.click(screen.getByRole("tab", { name: "Ejercicios" }));
    expect(where()).toBe("/progreso?tab=ejercicios");
    fireEvent.click(screen.getByRole("tab", { name: "Peso" }));
    expect(where()).toBe("/progreso?tab=peso");
  });

  it("el panel está asociado a su pestaña", async () => {
    renderProgress("/progreso?tab=semana");
    await settled();
    const tab = screen.getByRole("tab", { name: "Semana" });
    expect(panel().getAttribute("aria-labelledby")).toBe(tab.id);
    expect(tab.getAttribute("aria-controls")).toBe(panel().id);
  });
});

describe("Progreso: peso", () => {
  beforeEach(() => {
    server.weight = { "4w": WEIGHTS.slice(1), "12w": WEIGHTS, all: WEIGHTS };
  });

  it("muestra «Cargando…» mientras llegan los datos", async () => {
    let release: () => void = () => undefined;
    server.weightGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    renderProgress();
    expect(screen.getByText("Cargando…")).toBeTruthy();
    release();
    await settled();
  });

  it("los rangos piden 4 semanas, 12 semanas y todo, y marcan el activo", async () => {
    renderProgress();
    await settled();
    const group = screen.getByRole("group", { name: "Periodo" });
    const pressed = () => within(group).getAllByRole("button").filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.textContent);
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["4 semanas", "12 semanas", "Todo"]);
    expect(pressed()).toEqual(["12 semanas"]);

    fireEvent.click(within(group).getByRole("button", { name: "4 semanas" }));
    await settled();
    expect(callsTo("/api/progress/weight?range=4w")).toHaveLength(1);
    expect(pressed()).toEqual(["4 semanas"]);

    fireEvent.click(within(group).getByRole("button", { name: "Todo" }));
    await settled();
    expect(callsTo("/api/progress/weight?range=all")).toHaveLength(1);
    expect(pressed()).toEqual(["Todo"]);
  });

  it("dibuja el peso y la media de 7 días con un resumen accesible", async () => {
    renderProgress();
    await settled();
    const chart = screen.getByRole("img", { name: /^Peso y media de 7 días/ });
    expect(chart.getAttribute("aria-label")).toBe(
      `Peso y media de 7 días, 3 registros. Último: Peso 74,2${NBSP}kg, Media de 7 días 74,53${NBSP}kg.`,
    );
    expect(chart.querySelector("svg")).not.toBeNull();
    // La leyenda no depende solo del color.
    expect(screen.getByText("Peso diario")).toBeTruthy();
    expect(screen.getByText("Media de 7 días")).toBeTruthy();
  });

  it("la línea gruesa es la media de 7 días", async () => {
    renderProgress();
    await settled();
    const chart = screen.getByRole("img", { name: /^Peso y media de 7 días/ });
    const widths = Array.from(chart.querySelectorAll(".recharts-line-curve")).map((curve) => ({
      name: curve.getAttribute("name"),
      width: Number(curve.getAttribute("stroke-width")),
    }));
    const average = widths.find((line) => line.name === "Media de 7 días");
    const daily = widths.find((line) => line.name === "Peso diario");
    expect(average).toBeDefined();
    expect(daily).toBeDefined();
    expect(average!.width).toBeGreaterThan(daily!.width);
  });

  it("el % de grasa va en su propia gráfica, no en un segundo eje", async () => {
    renderProgress();
    await settled();
    const fat = screen.getByRole("img", { name: /^% de grasa/ });
    expect(fat.getAttribute("aria-label")).toBe(`% de grasa, 2 registros. Último: 18,2${NBSP}%.`);
    expect(screen.getAllByRole("img")).toHaveLength(2);
  });

  it("sin % de grasa apuntado no hay segunda gráfica, y se dice", async () => {
    server.weight["12w"] = WEIGHTS.map((point) => ({ ...point, bodyFatPct: null }));
    renderProgress();
    await settled();
    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(screen.getByText("Sin % de grasa apuntado en este periodo.")).toBeTruthy();
  });

  it("descarta valores que no son números finitos", async () => {
    server.weight["12w"] = [
      { localDate: "2026-11-02", weightKg: 75, bodyFatPct: null, avg7: null },
      // JSON no lleva Infinity ni NaN: llegan como null, y un número fuera de rango no debe dibujarse.
      { localDate: "2026-11-05", weightKg: Number.POSITIVE_INFINITY, bodyFatPct: Number.NaN, avg7: Number.NaN },
      { localDate: "2026-11-09", weightKg: 74.2, bodyFatPct: null, avg7: 74.6 },
    ];
    renderProgress();
    await settled();
    expect(screen.getByRole("img", { name: /^Peso y media de 7 días, 2 registros/ })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Infinity|NaN/);
  });

  it("un fallo se muestra con Reintentar, y reintentar vuelve a pedirlo", async () => {
    server.weightFail = 500;
    renderProgress();
    expect((await screen.findByRole("alert")).textContent).toBe("Error interno");
    server.weightFail = null;
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await settled();
    expect(screen.getByRole("img", { name: /^Peso y media de 7 días/ })).toBeTruthy();
    expect(callsTo("/api/progress/weight?range=12w")).toHaveLength(2);
  });

  it("sin conexión lo dice, y los rangos siguen a mano", async () => {
    server.weightFail = "offline";
    renderProgress();
    expect(await screen.findByText("Sin conexión")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Periodo" })).toBeTruthy();
  });
});

describe("Progreso: semana", () => {
  const CURRENT: WeeklySummary = { workouts: 4, volumeKg: 4362.456, cardioMin: 65, cardioKm: 12.34, avgSteps: 8432.6, creatineDays: 5 };
  const PREVIOUS: WeeklySummary = { workouts: 3, volumeKg: 5000, cardioMin: 65, cardioKm: 9.5, avgSteps: 9100, creatineDays: 7 };

  function row(name: string) {
    const escaped = name.replace(/[()]/g, "\\$&");
    return within(screen.getByRole("table")).getByRole("row", { name: new RegExp(`^${escaped}`) });
  }

  async function renderWeek(data: Partial<WeekProgress>) {
    server.week = { ...EMPTY_WEEK, ...data };
    renderProgress("/progreso?tab=semana");
    await settled();
  }

  it("compara cada métrica con la semana anterior, con coma decimal y miles", async () => {
    await renderWeek({ current: CURRENT, previous: PREVIOUS, streak: 3, goal: 3 });
    const cells = (name: string) => within(row(name)).getAllByRole("cell").map((cell) => cell.textContent);
    expect(cells("Entrenos")).toEqual(["4/3↑", "3/3"]);
    expect(cells("Volumen")).toEqual([`4.362,5${NBSP}kg↓`, `5.000${NBSP}kg`]);
    expect(cells("Cardio (tiempo)")).toEqual(["1 h 05 min=", "1 h 05 min"]);
    expect(cells("Cardio (distancia)")).toEqual([`12,3${NBSP}km↑`, `9,5${NBSP}km`]);
    expect(cells("Pasos medios")).toEqual(["8.433↓", "9.100"]);
    expect(cells("Días con creatina")).toEqual(["5/7↓", "7/7"]);
    expect(document.body.textContent).not.toMatch(/Infinity|NaN/);
  });

  it("las flechas tienen nombre accesible", async () => {
    await renderWeek({ current: CURRENT, previous: PREVIOUS });
    expect(within(row("Entrenos")).getByRole("img", { name: "Más que la semana anterior" }).textContent).toBe("↑");
    expect(within(row("Volumen")).getByRole("img", { name: "Menos que la semana anterior" }).textContent).toBe("↓");
    expect(within(row("Cardio (tiempo)")).getByRole("img", { name: "Igual que la semana anterior" }).textContent).toBe("=");
  });

  it("la tarjeta de la semana dice el objetivo", async () => {
    await renderWeek({ current: CURRENT, previous: PREVIOUS, goal: 4 });
    expect(screen.getByText("Objetivo: 4 entrenos por semana")).toBeTruthy();
    expect(within(row("Entrenos")).getAllByRole("cell")[0]!.textContent).toBe("4/4↑");
  });

  it("sin pasos medios sale «—» y sin flecha; con solo uno de los dos tampoco hay flecha", async () => {
    await renderWeek({ current: { ...CURRENT, avgSteps: null }, previous: PREVIOUS });
    const stepsRow = row("Pasos medios");
    expect(within(stepsRow).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["—", "9.100"]);
    expect(within(stepsRow).queryByRole("img")).toBeNull();
  });

  it("si la semana anterior no tiene pasos no hay con qué comparar", async () => {
    await renderWeek({ current: CURRENT, previous: { ...PREVIOUS, avgSteps: null } });
    const stepsRow = row("Pasos medios");
    expect(within(stepsRow).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["8.433", "—"]);
    expect(within(stepsRow).queryByRole("img")).toBeNull();
  });

  it("la flecha compara lo que se ve, no los decimales que se redondean", async () => {
    await renderWeek({
      current: { ...CURRENT, volumeKg: 1000.04, cardioKm: 5.04, avgSteps: 8000.4 },
      previous: { ...PREVIOUS, volumeKg: 1000.01, cardioKm: 5.01, avgSteps: 8000.1 },
    });
    expect(within(row("Volumen")).getByRole("img", { name: "Igual que la semana anterior" })).toBeTruthy();
    expect(within(row("Cardio (distancia)")).getByRole("img", { name: "Igual que la semana anterior" })).toBeTruthy();
    expect(within(row("Pasos medios")).getByRole("img", { name: "Igual que la semana anterior" })).toBeTruthy();
  });

  it("una semana que empieza de cero sube respecto a otra vacía, sin dividir por cero", async () => {
    await renderWeek({ current: { ...EMPTY_SUMMARY, workouts: 1, volumeKg: 800 }, previous: EMPTY_SUMMARY });
    expect(within(row("Volumen")).getByRole("img", { name: "Más que la semana anterior" })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Infinity|NaN/);
  });

  it.each([
    [0, "Sin racha todavía"],
    [1, "1 semana"],
    [5, "5 semanas"],
  ])("la racha de %i semanas se lee «%s»", async (streak, text) => {
    await renderWeek({ current: CURRENT, previous: PREVIOUS, streak });
    expect(screen.getByRole("region", { name: "Racha" }).textContent).toContain(text);
  });

  it("si las dos semanas están vacías solo sale Sin datos todavía", async () => {
    await renderWeek({});
    expect(screen.queryByRole("table")).toBeNull();
    expect(within(panel()).getAllByText("Sin datos todavía")).toHaveLength(1);
  });

  it("con datos solo en la semana anterior sí se compara", async () => {
    await renderWeek({ previous: PREVIOUS });
    expect(within(row("Entrenos")).getByRole("img", { name: "Menos que la semana anterior" })).toBeTruthy();
  });

  it("un fallo se muestra con Reintentar", async () => {
    server.weekFail = 500;
    renderProgress("/progreso?tab=semana");
    expect((await screen.findByRole("alert")).textContent).toBe("Error interno");
    server.weekFail = null;
    server.week = { current: CURRENT, previous: PREVIOUS, streak: 2, goal: 3 };
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await settled();
    expect(screen.getByRole("table")).toBeTruthy();
  });
});

describe("Progreso: ejercicios", () => {
  beforeEach(() => {
    server.exercises = [PRESS, RUN];
    server.progress = { "e-press": STRENGTH_PROGRESS, "e-run": CARDIO_PROGRESS };
  });

  async function pick(id: string) {
    fireEvent.change(await screen.findByLabelText("Ejercicio"), { target: { value: id } });
    await settled();
  }

  it("sin elegir ejercicio invita a elegir y no pide ninguna progresión", async () => {
    renderProgress("/progreso?tab=ejercicios");
    await settled();
    expect(screen.getByText("Elige un ejercicio para ver su evolución y sus récords.")).toBeTruthy();
    expect(server.calls.filter((call) => call.startsWith("/api/progress/exercise/"))).toHaveLength(0);
  });

  it("ordena el selector con las reglas del español y nombra los archivados", async () => {
    server.exercises = [exercise("e-3", "Ñu"), exercise("e-1", "Nube"), exercise("e-2", "Zancada", "strength", true), exercise("e-0", "Abdominales")];
    renderProgress("/progreso?tab=ejercicios");
    await settled();
    const select = screen.getByLabelText("Ejercicio");
    const labels = within(select).getAllByRole("option").map((option) => option.textContent);
    expect(labels).toEqual(["Elige un ejercicio", "Abdominales", "Nube", "Ñu", "Zancada (archivado)"]);
  });

  it("un ejercicio de fuerza muestra su gráfica y sus tres récords con fecha", async () => {
    renderProgress("/progreso?tab=ejercicios");
    await settled();
    await pick("e-press");
    expect(callsTo("/api/progress/exercise/e-press")).toHaveLength(1);
    expect(screen.getByRole("img", { name: /^Peso máximo y 1RM estimado por sesión, 2 sesiones/ })).toBeTruthy();

    const records = screen.getByRole("region", { name: "Récords" });
    const items = within(records).getAllByRole("listitem").map((item) => item.textContent);
    expect(items).toEqual([
      `Mayor peso60${NBSP}kg9 nov 2026`,
      `Mejor 1RM estimado80${NBSP}kg9 nov 2026`,
      `Mayor volumen en una sesión4.362,5${NBSP}kg2 nov 2026`,
    ]);
  });

  it("un ejercicio de cardio muestra distancia y ritmo, no los récords de fuerza", async () => {
    renderProgress("/progreso?tab=ejercicios");
    await settled();
    await pick("e-run");
    expect(screen.getByRole("img", { name: /^Distancia máxima por sesión/ })).toBeTruthy();
    const items = within(screen.getByRole("region", { name: "Récords" })).getAllByRole("listitem").map((item) => item.textContent);
    expect(items).toEqual([`Mayor distancia5${NBSP}km9 nov 2026`, "Mejor ritmo5:30 min/km9 nov 2026"]);
    expect(screen.queryByText("Mayor peso")).toBeNull();
  });

  it("no se muestran los récords sin valor", async () => {
    server.progress["e-press"] = {
      sessions: STRENGTH_PROGRESS.sessions,
      records: {
        maxWeight: { value: 60, localDate: "2026-11-09" },
        best1RM: { value: Number.NaN, localDate: "2026-11-09" },
      },
    };
    renderProgress("/progreso?tab=ejercicios");
    await settled();
    await pick("e-press");
    const items = within(screen.getByRole("region", { name: "Récords" })).getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(screen.queryByText("Mejor 1RM estimado")).toBeNull();
    expect(screen.queryByText("Mayor volumen en una sesión")).toBeNull();
    expect(document.body.textContent).not.toMatch(/Infinity|NaN/);
  });

  it("cambiar de ejercicio sustituye la gráfica y los récords", async () => {
    renderProgress("/progreso?tab=ejercicios");
    await settled();
    await pick("e-press");
    await pick("e-run");
    expect(screen.queryByText("Mayor peso")).toBeNull();
    expect(screen.getByText("Mayor distancia")).toBeTruthy();
    await pick("");
    expect(screen.getByText("Elige un ejercicio para ver su evolución y sus récords.")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("dos sesiones el mismo día siguen siendo dos puntos", async () => {
    server.progress["e-press"] = {
      sessions: [
        { localDate: "2026-11-02", maxWeight: 55, best1RM: 70, volume: 550, maxDistance: null, bestPace: null },
        { localDate: "2026-11-02", maxWeight: 60, best1RM: 75, volume: 600, maxDistance: null, bestPace: null },
        { localDate: "2026-11-09", maxWeight: 62, best1RM: 80, volume: 620, maxDistance: null, bestPace: null },
      ],
      records: {},
    };
    renderProgress("/progreso?tab=ejercicios");
    await settled();
    await pick("e-press");
    const chart = screen.getByRole("img", { name: /3 sesiones/ });
    const curve = chart.querySelector(".recharts-line-curve");
    // "M x,y L x,y L x,y": tres puntos, cada uno en su sitio.
    const xs = (curve?.getAttribute("d") ?? "").match(/[ML](\d+(?:\.\d+)?),/g)?.map((part) => Number.parseFloat(part.slice(1))) ?? [];
    expect(xs).toHaveLength(3);
    expect(new Set(xs).size).toBe(3);
    expect(chart.querySelectorAll(".recharts-line-dot")).toHaveLength(6);
  });

  it("la elección sigue al volver de otra pestaña", async () => {
    renderProgress("/progreso?tab=ejercicios");
    await settled();
    await pick("e-press");
    fireEvent.click(screen.getByRole("tab", { name: "Semana" }));
    await settled();
    fireEvent.click(screen.getByRole("tab", { name: "Ejercicios" }));
    await settled();
    expect((await screen.findByLabelText("Ejercicio") as HTMLSelectElement).value).toBe("e-press");
    expect(screen.getByRole("region", { name: "Récords" })).toBeTruthy();
  });

  it("si falla la progresión se avisa dentro del ejercicio y se puede reintentar", async () => {
    server.progressFail = true;
    renderProgress("/progreso?tab=ejercicios");
    await settled();
    await pick("e-press");
    expect((await screen.findByRole("alert")).textContent).toBe("Error interno");
    expect(screen.getByLabelText("Ejercicio")).toBeTruthy();
    server.progressFail = false;
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await settled();
    expect(screen.getByRole("region", { name: "Récords" })).toBeTruthy();
  });

  it("si falla la lista de ejercicios se avisa con Reintentar", async () => {
    server.exercisesFail = "offline";
    renderProgress("/progreso?tab=ejercicios");
    expect(await screen.findByText("Sin conexión")).toBeTruthy();
    server.exercisesFail = null;
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await settled();
    expect(await screen.findByLabelText("Ejercicio")).toBeTruthy();
  });
});

describe("ChartBoundary", () => {
  function Boom(): never {
    throw new Error("Failed to fetch dynamically imported module");
  }

  it("si el trozo de la gráfica no carga, avisa en lugar de dejar la pantalla en blanco", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <ChartBoundary>
        <Boom />
      </ChartBoundary>,
    );
    expect(screen.getByRole("alert").textContent).toContain("No se pudo cargar la gráfica");
    expect(screen.getByRole("button", { name: "Recargar" })).toBeTruthy();
    error.mockRestore();
  });

  it("sin fallo deja pasar a sus hijos", () => {
    render(
      <ChartBoundary>
        <p>Dentro</p>
      </ChartBoundary>,
    );
    expect(screen.getByText("Dentro")).toBeTruthy();
  });
});
