import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Exercise } from "../../src/shared/types";
import { NBSP } from "../../src/web/format";
import type { ExerciseHistoryEntry, ExerciseProgress } from "../../src/web/progressData";
import { ExerciseDetail } from "../../src/web/screens/ExerciseDetail";

const PRESS: Exercise = {
  id: "e-press",
  name: "Press banca",
  category: "strength",
  muscle: "Pecho",
  description: "Empuja la barra hasta estirar los codos.",
  mediaUrl: null,
  isCustom: false,
  archived: false,
};

const HISTORY: ExerciseHistoryEntry[] = [
  {
    workoutId: "w-2",
    localDate: "2026-11-09",
    sets: [
      { weightKg: 60, reps: 10, rir: null, durationMin: null, distanceKm: null },
      { weightKg: 57.5, reps: 8, rir: null, durationMin: null, distanceKm: null },
    ],
  },
  {
    workoutId: "w-1",
    localDate: "2026-11-02",
    sets: [{ weightKg: 55, reps: 10, rir: null, durationMin: null, distanceKm: null }],
  },
];

const PROGRESS: ExerciseProgress = {
  sessions: [
    { localDate: "2026-11-02", maxWeight: 55, best1RM: 73.5, volume: 550, maxDistance: null, bestPace: null },
    { localDate: "2026-11-09", maxWeight: 60, best1RM: 80, volume: 1060, maxDistance: null, bestPace: null },
  ],
  records: { maxWeight: { value: 60, localDate: "2026-11-09" } },
};

type Call = { method: string; path: string; body: unknown };

const server = {
  exercises: [PRESS] as Exercise[],
  history: HISTORY as ExerciseHistoryEntry[],
  progress: PROGRESS as ExerciseProgress,
  listFail: null as "offline" | 500 | null,
  historyFail: false,
  progressFail: false,
  patchStatus: 200,
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

  if (path === "/api/exercises?archived=1") {
    if (server.listFail === "offline") throw new TypeError("Failed to fetch");
    if (server.listFail === 500) return json(500, { error: "Error interno" });
    return json(200, server.exercises);
  }
  if (path.endsWith("/history")) {
    return server.historyFail ? json(500, { error: "Error interno" }) : json(200, server.history);
  }
  if (path.startsWith("/api/progress/exercise/")) {
    return server.progressFail ? json(500, { error: "Error interno" }) : json(200, server.progress);
  }
  if (path.startsWith("/api/exercises/") && method === "PATCH") {
    if (server.patchStatus !== 200) return json(server.patchStatus, { error: "Fallo simulado" });
    const current = server.exercises.find((e) => path.endsWith(e.id));
    return json(200, { ...current, ...(body as object) });
  }
  if (path.startsWith("/api/exercises/") && method === "DELETE") {
    return server.deleteStatus === 200 ? json(200, { archived: true }) : json(server.deleteStatus, { error: "Fallo simulado" });
  }
  return json(404, { error: "No encontrado" });
}

function callsTo(method: string, path: string): Call[] {
  return server.calls.filter((call) => call.method === method && call.path === path);
}

function renderDetail(id = "e-press") {
  return render(
    <MemoryRouter initialEntries={[`/ejercicio/${id}`]}>
      <Routes>
        <Route path="/ejercicio/:id" element={<ExerciseDetail />} />
        <Route path="/entreno/biblioteca" element={<p>Pantalla Biblioteca</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function renderLoaded(id = "e-press") {
  const view = renderDetail(id);
  await screen.findByRole("heading", { level: 1 });
  await waitFor(() => expect(screen.queryByText("Cargando…")).toBeNull());
  return view;
}

beforeEach(() => {
  server.exercises = [PRESS];
  server.history = HISTORY;
  server.progress = PROGRESS;
  server.listFail = null;
  server.historyFail = false;
  server.progressFail = false;
  server.patchStatus = 200;
  server.deleteStatus = 200;
  server.calls = [];
  fetchMock.mockReset();
  fetchMock.mockImplementation(handle);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Ficha: contenido", () => {
  it("muestra nombre, categoría, músculo y descripción", async () => {
    await renderLoaded();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Press banca");
    expect(screen.getByText("Fuerza · Pecho")).toBeTruthy();
    expect(screen.getByText("Empuja la barra hasta estirar los codos.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Biblioteca" }).getAttribute("href")).toBe("/entreno/biblioteca");
  });

  it("sin descripción lo dice", async () => {
    server.exercises = [{ ...PRESS, description: "", muscle: "" }];
    await renderLoaded();
    expect(screen.getByText("Sin descripción.")).toBeTruthy();
    expect(screen.getByText("Fuerza")).toBeTruthy();
  });

  it("un mediaUrl de imagen se muestra como imagen, también con parámetros en la dirección", async () => {
    server.exercises = [{ ...PRESS, mediaUrl: "https://example.com/fotos/press.JPG?width=300#x" }];
    await renderLoaded();
    const image = screen.getByRole("img", { name: "Imagen de Press banca" });
    expect(image.getAttribute("src")).toBe("https://example.com/fotos/press.JPG?width=300#x");
    expect(screen.queryByRole("link", { name: /vídeo/i })).toBeNull();
  });

  it.each(["jpg", "jpeg", "png", "webp", "gif", "avif"])("la extensión %s cuenta como imagen", async (extension) => {
    server.exercises = [{ ...PRESS, mediaUrl: `https://example.com/a.${extension}` }];
    await renderLoaded();
    expect(screen.getByRole("img", { name: "Imagen de Press banca" })).toBeTruthy();
  });

  it("cualquier otro enlace sale como enlace seguro, nunca como imagen", async () => {
    server.exercises = [{ ...PRESS, mediaUrl: "https://www.youtube.com/watch?v=abc" }];
    await renderLoaded();
    const link = screen.getByRole("link", { name: "Ver vídeo" });
    expect(link.getAttribute("href")).toBe("https://www.youtube.com/watch?v=abc");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(screen.queryByRole("img", { name: "Imagen de Press banca" })).toBeNull();
  });

  it("si la imagen no carga, ofrece el enlace", async () => {
    server.exercises = [{ ...PRESS, mediaUrl: "https://example.com/rota.png" }];
    await renderLoaded();
    fireEvent.error(screen.getByRole("img", { name: "Imagen de Press banca" }));
    expect(screen.queryByRole("img", { name: "Imagen de Press banca" })).toBeNull();
    expect(screen.getByRole("link", { name: "Ver vídeo" }).getAttribute("href")).toBe("https://example.com/rota.png");
  });

  it("sin mediaUrl no hay imagen ni enlace", async () => {
    await renderLoaded();
    expect(screen.queryByRole("img", { name: "Imagen de Press banca" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Ver vídeo" })).toBeNull();
  });

  it("un ejercicio archivado se encuentra y se marca como archivado, sin botón de archivar", async () => {
    server.exercises = [{ ...PRESS, archived: true }];
    await renderLoaded();
    expect(screen.getByText("Archivado")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Archivar" })).toBeNull();
    // El historial sigue mostrándolo.
    expect(screen.getAllByRole("link", { name: /nov 2026/ })).toHaveLength(2);
  });

  it("un ejercicio que no existe lo dice", async () => {
    server.exercises = [];
    renderDetail("e-fantasma");
    expect(await screen.findByText("Ejercicio no encontrado")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Volver a la biblioteca" }).getAttribute("href")).toBe("/entreno/biblioteca");
  });

  it("pide la lista con archivados, el historial y el progreso de ese ejercicio", async () => {
    await renderLoaded();
    expect(server.calls.map((call) => call.path).sort()).toEqual(
      ["/api/exercises?archived=1", "/api/exercises/e-press/history", "/api/progress/exercise/e-press"].sort(),
    );
  });
});

describe("Ficha: historial y gráfica", () => {
  it("lista el historial con lo más reciente primero, con las series y un enlace a cada entreno", async () => {
    await renderLoaded();
    const section = screen.getByRole("region", { name: "Tu historial" });
    const rows = within(section).getAllByRole("link");
    expect(rows.map((row) => row.textContent)).toEqual(["9 nov 202660×10 · 57,5×8", "2 nov 202655×10"]);
    expect(rows.map((row) => row.getAttribute("href"))).toEqual(["/entreno/historial/w-2", "/entreno/historial/w-1"]);
  });

  it("dibuja la gráfica con un resumen accesible de la última sesión", async () => {
    await renderLoaded();
    const chart = screen.getByRole("img", { name: /Peso máximo y 1RM estimado por sesión, 2 sesiones/ });
    expect(chart.getAttribute("aria-label")).toBe(
      `Peso máximo y 1RM estimado por sesión, 2 sesiones. Última: Peso máximo 60${NBSP}kg, 1RM estimado 80${NBSP}kg.`,
    );
    expect(chart.querySelector("svg")).not.toBeNull();
    // La leyenda no depende solo del color.
    expect(screen.getAllByText("Peso máximo").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1RM estimado").length).toBeGreaterThan(0);
  });

  it("sin historial ni sesiones: Sin datos todavía, y no se dibuja nada", async () => {
    server.history = [];
    server.progress = { sessions: [], records: {} };
    await renderLoaded();
    expect(screen.getByText("Todavía no has hecho este ejercicio.")).toBeTruthy();
    expect(screen.getByText("Sin datos todavía")).toBeTruthy();
    expect(screen.queryByRole("img", { name: /por sesión/ })).toBeNull();
  });

  it("una sesión sin datos que dibujar no cuenta, y nunca sale Infinity ni NaN", async () => {
    server.progress = {
      sessions: [
        { localDate: "2026-11-02", maxWeight: null, best1RM: null, volume: 0, maxDistance: null, bestPace: null },
        { localDate: "2026-11-09", maxWeight: Number.POSITIVE_INFINITY, best1RM: Number.NaN, volume: 0, maxDistance: null, bestPace: null },
      ],
      records: {},
    };
    await renderLoaded();
    expect(screen.getByText("Sin datos todavía")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Infinity|NaN/);
  });

  it("en cardio el historial son minutos y kilómetros, y la gráfica es la distancia", async () => {
    server.exercises = [{ ...PRESS, id: "e-press", name: "Correr", category: "cardio", muscle: "" }];
    server.history = [
      {
        workoutId: "w-3",
        localDate: "2026-11-09",
        sets: [{ weightKg: null, reps: null, rir: null, durationMin: 20, distanceKm: 3.2 }],
      },
    ];
    server.progress = {
      sessions: [{ localDate: "2026-11-09", maxWeight: null, best1RM: null, volume: 0, maxDistance: 3.2, bestPace: 6.25 }],
      records: { maxDistance: { value: 3.2, localDate: "2026-11-09" } },
    };
    await renderLoaded();
    expect(screen.getByRole("link", { name: /20 min · 3,2 km/ })).toBeTruthy();
    expect(screen.getByRole("img", { name: `Distancia máxima por sesión, 1 sesión. Última: Distancia máxima 3,2${NBSP}km.` })).toBeTruthy();
  });

  it("un entreno del historial sin series se enseña como Sin series", async () => {
    server.history = [{ workoutId: "w-9", localDate: "2026-11-09", sets: [] }];
    await renderLoaded();
    expect(screen.getByRole("link", { name: /Sin series/ })).toBeTruthy();
  });

  it("si falla el historial avisa y el resto de la ficha sigue ahí", async () => {
    server.historyFail = true;
    await renderLoaded();
    expect(screen.getByText("No se pudo cargar tu historial.")).toBeTruthy();
    expect(screen.getByRole("img", { name: /por sesión/ })).toBeTruthy();
    expect(screen.getByText("Empuja la barra hasta estirar los codos.")).toBeTruthy();
  });

  it("si falla la gráfica avisa y el historial sigue ahí", async () => {
    server.progressFail = true;
    await renderLoaded();
    expect(screen.getByText("No se pudo cargar la gráfica.")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /nov 2026/ })).toHaveLength(2);
  });
});

describe("Ficha: carga", () => {
  it("un error de carga sale con Reintentar, y reintentar recupera la ficha", async () => {
    server.listFail = 500;
    renderDetail();
    expect((await screen.findByRole("alert")).textContent).toBe("Error interno");
    server.listFail = null;
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Press banca" })).toBeTruthy();
  });

  it("sin conexión sale Sin conexión con Reintentar", async () => {
    server.listFail = "offline";
    renderDetail();
    expect(await screen.findByText("Sin conexión")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeTruthy();
  });
});

describe("Ficha: editar", () => {
  async function openEdit() {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    return screen.findByRole("dialog", { name: "Editar ejercicio" });
  }

  it("precarga el formulario y guarda con PATCH solo con los campos editables", async () => {
    server.exercises = [{ ...PRESS, mediaUrl: "https://example.com/press.png" }];
    const dialog = await openEdit();
    expect((within(dialog).getByLabelText("Nombre") as HTMLInputElement).value).toBe("Press banca");
    expect((within(dialog).getByLabelText("Categoría") as HTMLSelectElement).value).toBe("strength");
    expect((within(dialog).getByLabelText("Músculo (opcional)") as HTMLInputElement).value).toBe("Pecho");
    expect((within(dialog).getByLabelText("Enlace de imagen o vídeo (opcional)") as HTMLInputElement).value).toBe(
      "https://example.com/press.png",
    );

    fireEvent.change(within(dialog).getByLabelText("Nombre"), { target: { value: "Press de banca plano" } });
    fireEvent.change(within(dialog).getByLabelText("Descripción (opcional)"), { target: { value: "Nueva descripción." } });
    fireEvent.change(within(dialog).getByLabelText("Enlace de imagen o vídeo (opcional)"), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(callsTo("PATCH", "/api/exercises/e-press").map((call) => call.body)).toEqual([
      {
        name: "Press de banca plano",
        category: "strength",
        muscle: "Pecho",
        description: "Nueva descripción.",
        mediaUrl: null,
      },
    ]);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Press de banca plano");
    expect(screen.getByText("Nueva descripción.")).toBeTruthy();
    expect(screen.queryByRole("img", { name: /Imagen de/ })).toBeNull();
  });

  it("sin nombre no envía nada", async () => {
    const dialog = await openEdit();
    fireEvent.change(within(dialog).getByLabelText("Nombre"), { target: { value: " " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar" }));
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(/nombre/i);
    expect(callsTo("PATCH", "/api/exercises/e-press")).toHaveLength(0);
  });

  it("si el servidor falla, enseña su mensaje y la ficha no cambia", async () => {
    const dialog = await openEdit();
    fireEvent.change(within(dialog).getByLabelText("Nombre"), { target: { value: "Otro nombre" } });
    server.patchStatus = 500;
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("Fallo simulado");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Press banca");
  });

  it("cerrar sin guardar descarta lo escrito", async () => {
    const dialog = await openEdit();
    fireEvent.change(within(dialog).getByLabelText("Nombre"), { target: { value: "A medias" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cerrar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    const again = await screen.findByRole("dialog", { name: "Editar ejercicio" });
    expect((within(again).getByLabelText("Nombre") as HTMLInputElement).value).toBe("Press banca");
  });
});

describe("Ficha: archivar", () => {
  async function openConfirm() {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Archivar" }));
    return screen.findByRole("dialog", { name: "¿Archivar este ejercicio?" });
  }

  it("pide confirmación y no llama al servidor hasta que se confirma", async () => {
    const dialog = await openConfirm();
    expect(within(dialog).getByText(/dejará de salir en la biblioteca/i)).toBeTruthy();
    expect(callsTo("DELETE", "/api/exercises/e-press")).toHaveLength(0);
  });

  it("Cancelar cierra la confirmación y no archiva", async () => {
    const dialog = await openConfirm();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(callsTo("DELETE", "/api/exercises/e-press")).toHaveLength(0);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Press banca");
  });

  it("al confirmar envía DELETE y vuelve a la biblioteca", async () => {
    const dialog = await openConfirm();
    fireEvent.click(within(dialog).getByRole("button", { name: "Sí, archivar" }));
    expect(await screen.findByText("Pantalla Biblioteca")).toBeTruthy();
    expect(callsTo("DELETE", "/api/exercises/e-press")).toHaveLength(1);
  });

  it("si el servidor falla, avisa, no sale de la ficha y se puede reintentar", async () => {
    const dialog = await openConfirm();
    server.deleteStatus = 500;
    fireEvent.click(within(dialog).getByRole("button", { name: "Sí, archivar" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("Fallo simulado");
    expect(screen.queryByText("Pantalla Biblioteca")).toBeNull();
    server.deleteStatus = 200;
    fireEvent.click(within(dialog).getByRole("button", { name: "Sí, archivar" }));
    expect(await screen.findByText("Pantalla Biblioteca")).toBeTruthy();
  });
});
