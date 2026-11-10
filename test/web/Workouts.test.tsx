import "fake-indexeddb/auto";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Routine } from "../../src/shared/types";
import { Workouts } from "../../src/web/screens/Workouts";
import { saveSnapshot } from "../../src/web/session/offlineCache";

function routine(id: string, name: string, extra: Partial<Routine> = {}): Routine {
  return {
    id,
    name,
    inRotation: true,
    rotationOrder: 0,
    archived: false,
    items: [{ exerciseId: "e-1", position: 0, sets: 3, repsTarget: "10", restSeconds: 90 }],
    ...extra,
  };
}

const PECHO = routine("r-pecho", "Pecho", { rotationOrder: 0 });
const ESPALDA = routine("r-espalda", "Espalda", {
  rotationOrder: 1,
  items: [
    { exerciseId: "e-1", position: 0, sets: 3, repsTarget: "10", restSeconds: 90 },
    { exerciseId: "e-2", position: 1, sets: 3, repsTarget: "10", restSeconds: 90 },
  ],
});
const PIERNA = routine("r-pierna", "Pierna", { rotationOrder: 2 });
const BRAZOS = routine("r-brazos", "Brazos", { inRotation: false, rotationOrder: 0, items: [] });

type Call = { method: string; path: string; body: unknown };

const server = {
  routines: [PECHO, ESPALDA, PIERNA, BRAZOS],
  // La última rutina de la rotación que se completó: "te toca" es la siguiente en el orden actual (circular).
  lastDoneId: "r-pecho" as string | null,
  routinesFail: null as "offline" | 500 | null,
  todayFails: false,
  reorderStatus: 200,
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

  if (path === "/api/routines" && method === "GET") {
    if (server.routinesFail === "offline") throw new TypeError("Failed to fetch");
    if (server.routinesFail === 500) return json(500, { error: "Error interno" });
    return json(200, server.routines);
  }
  if (path === "/api/today") {
    if (server.todayFails) return json(500, { error: "Error interno" });
    // Como el servidor: se recalcula con el orden que haya en ese momento.
    const rotation = server.routines.filter((r) => r.inRotation).sort((a, b) => a.rotationOrder - b.rotationOrder);
    const lastIndex = rotation.findIndex((r) => r.id === server.lastDoneId);
    const next = rotation[(lastIndex + 1) % rotation.length];
    return json(200, { next: next ? { routine: next, estimatedMin: 40 } : null });
  }
  if (path === "/api/routines/reorder" && method === "POST") {
    if (server.reorderStatus !== 200) return json(server.reorderStatus, { error: "Fallo simulado" });
    const { ids } = body as { ids: string[] };
    // Como el servidor: rotationOrder = posición en `ids`, y la lista sale ordenada por rotationOrder.
    server.routines = server.routines.map((r) => (ids.includes(r.id) ? { ...r, rotationOrder: ids.indexOf(r.id) } : r));
    return json(200, [...server.routines].sort((a, b) => a.rotationOrder - b.rotationOrder));
  }
  return json(404, { error: "No encontrado" });
}

function reorderCalls(): Call[] {
  return server.calls.filter((call) => call.path === "/api/routines/reorder");
}

async function renderLoaded() {
  const view = render(
    <MemoryRouter initialEntries={["/entreno"]}>
      <Routes>
        <Route path="/entreno" element={<Workouts />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByRole("link", { name: "Entreno libre" });
  await waitFor(() => expect(screen.queryByText("Cargando…")).toBeNull());
  return view;
}

/** Los nombres de las rutinas de una sección, en el orden en que salen. */
function routinesIn(section: string): string[] {
  const region = screen.getByRole("region", { name: section });
  return within(region)
    .getAllByRole("heading", { level: 3 })
    .map((heading) => heading.textContent ?? "");
}

/** El nombre de la rutina que lleva la etiqueta SIGUIENTE (null si no hay etiqueta). */
function nextLabelOn(): string | null {
  const label = screen.queryByText("SIGUIENTE");
  return label?.closest("li")?.querySelector("h3")?.textContent ?? null;
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  server.routines = [PECHO, ESPALDA, PIERNA, BRAZOS];
  server.lastDoneId = "r-pecho";
  server.routinesFail = null;
  server.todayFails = false;
  server.reorderStatus = 200;
  server.calls = [];
  fetchMock.mockReset();
  fetchMock.mockImplementation(handle);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Entreno: estructura", () => {
  it("separa En rotación (por orden) y Otras rutinas", async () => {
    await renderLoaded();
    expect(routinesIn("En rotación")).toEqual(["Pecho", "Espalda", "Pierna"]);
    expect(routinesIn("Otras rutinas")).toEqual(["Brazos"]);
  });

  it("marca con SIGUIENTE solo la rutina que toca", async () => {
    await renderLoaded();
    expect(screen.getAllByText("SIGUIENTE")).toHaveLength(1);
    const next = screen.getByRole("heading", { level: 3, name: "Espalda" }).closest("li");
    expect(within(next as HTMLElement).getByText("SIGUIENTE")).toBeTruthy();
  });

  it("cada rutina tiene Empezar (con su rutina) y Editar", async () => {
    await renderLoaded();
    expect(screen.getByRole("link", { name: "Empezar Pecho" }).getAttribute("href")).toBe("/entreno/sesion?rutina=r-pecho");
    expect(screen.getByRole("link", { name: "Editar Pecho" }).getAttribute("href")).toBe("/entreno/rutina/r-pecho");
    // Las que no rotan se pueden empezar cualquier día.
    expect(screen.getByRole("link", { name: "Empezar Brazos" }).getAttribute("href")).toBe("/entreno/sesion?rutina=r-brazos");
    expect(screen.getByRole("link", { name: "Editar Brazos" }).getAttribute("href")).toBe("/entreno/rutina/r-brazos");
  });

  it("ofrece Entreno libre, Nueva rutina, Historial y Biblioteca", async () => {
    await renderLoaded();
    expect(screen.getByRole("link", { name: "Entreno libre" }).getAttribute("href")).toBe("/entreno/sesion");
    expect(screen.getByRole("link", { name: "Nueva rutina" }).getAttribute("href")).toBe("/entreno/rutina/nueva");
    expect(screen.getByRole("link", { name: /Historial/ }).getAttribute("href")).toBe("/entreno/historial");
    expect(screen.getByRole("link", { name: /Biblioteca/ }).getAttribute("href")).toBe("/entreno/biblioteca");
  });

  it("cuenta los ejercicios en singular y plural", async () => {
    await renderLoaded();
    const pecho = screen.getByRole("heading", { level: 3, name: "Pecho" }).closest("li") as HTMLElement;
    const espalda = screen.getByRole("heading", { level: 3, name: "Espalda" }).closest("li") as HTMLElement;
    const brazos = screen.getByRole("heading", { level: 3, name: "Brazos" }).closest("li") as HTMLElement;
    expect(within(pecho).getByText("1 ejercicio")).toBeTruthy();
    expect(within(espalda).getByText("2 ejercicios")).toBeTruthy();
    expect(within(brazos).getByText("0 ejercicios")).toBeTruthy();
  });

  it("si Hoy no responde, la lista sale igual y sin SIGUIENTE", async () => {
    server.todayFails = true;
    await renderLoaded();
    expect(routinesIn("En rotación")).toEqual(["Pecho", "Espalda", "Pierna"]);
    expect(screen.queryByText("SIGUIENTE")).toBeNull();
  });

  it("no muestra Infinity ni NaN", async () => {
    await renderLoaded();
    expect(document.body.textContent).not.toMatch(/Infinity|NaN/);
  });
});

describe("Entreno: estados vacíos y errores", () => {
  it("sin rutinas invita a crear la primera, y Entreno libre sigue disponible", async () => {
    server.routines = [];
    await renderLoaded();
    expect(screen.getByText("Todavía no tienes rutinas")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Entreno libre" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "En rotación" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Otras rutinas" })).toBeNull();
  });

  it("con rutinas pero ninguna en rotación lo dice en esa sección", async () => {
    server.routines = [BRAZOS];
    await renderLoaded();
    expect(within(screen.getByRole("region", { name: "En rotación" })).getByText("Ninguna rutina en la rotación.")).toBeTruthy();
    expect(routinesIn("Otras rutinas")).toEqual(["Brazos"]);
  });

  it("sin otras rutinas no enseña la sección Otras rutinas", async () => {
    server.routines = [PECHO];
    await renderLoaded();
    expect(screen.queryByRole("region", { name: "Otras rutinas" })).toBeNull();
  });

  it("un error de carga sale con Reintentar, y reintentar muestra las rutinas", async () => {
    server.routinesFail = 500;
    render(
      <MemoryRouter>
        <Workouts />
      </MemoryRouter>,
    );
    expect((await screen.findByRole("alert")).textContent).toBe("Error interno");
    server.routinesFail = null;
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("heading", { level: 3, name: "Pecho" })).toBeTruthy();
  });

  it("sin conexión sale Sin conexión con Reintentar", async () => {
    server.routinesFail = "offline";
    render(
      <MemoryRouter>
        <Workouts />
      </MemoryRouter>,
    );
    expect(await screen.findByText("Sin conexión")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeTruthy();
  });
});

describe("Entreno: reordenar la rotación", () => {
  it("bajar una rutina envía la lista completa de la rotación en el orden nuevo y repinta", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Bajar Pecho" }));
    await waitFor(() => expect(routinesIn("En rotación")).toEqual(["Espalda", "Pecho", "Pierna"]));
    // Las rutinas fuera de la rotación no van en la lista.
    expect(reorderCalls().map((call) => call.body)).toEqual([{ ids: ["r-espalda", "r-pecho", "r-pierna"] }]);
  });

  it("subir una rutina también envía la lista completa", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Subir Pierna" }));
    await waitFor(() => expect(routinesIn("En rotación")).toEqual(["Pecho", "Pierna", "Espalda"]));
    expect(reorderCalls().map((call) => call.body)).toEqual([{ ids: ["r-pecho", "r-pierna", "r-espalda"] }]);
  });

  it("la primera no sube, la última no baja y las de fuera de la rotación no se mueven", async () => {
    await renderLoaded();
    expect((screen.getByRole("button", { name: "Subir Pecho" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Bajar Pierna" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Subir Brazos" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Bajar Brazos" })).toBeNull();
  });

  it("tras reordenar, la etiqueta SIGUIENTE sigue a la rutina que ahora toca", async () => {
    await renderLoaded();
    // Con el orden Pecho, Espalda, Pierna y Pecho hecha la última, toca Espalda.
    expect(nextLabelOn()).toBe("Espalda");
    // Pierna sube encima de Espalda: ahora, tras Pecho, toca Pierna.
    fireEvent.click(screen.getByRole("button", { name: "Subir Pierna" }));
    await waitFor(() => expect(routinesIn("En rotación")).toEqual(["Pecho", "Pierna", "Espalda"]));
    await waitFor(() => expect(nextLabelOn()).toBe("Pierna"));
    expect(screen.getAllByText("SIGUIENTE")).toHaveLength(1);
  });

  it("al reordenar pide Hoy sin volver a la pantalla de carga", async () => {
    await renderLoaded();
    const todayCalls = () => server.calls.filter((call) => call.path === "/api/today").length;
    expect(todayCalls()).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Subir Pierna" }));
    expect(screen.queryByText("Cargando…")).toBeNull();
    await waitFor(() => expect(todayCalls()).toBe(2));
    expect(screen.queryByText("Cargando…")).toBeNull();
    await waitFor(() => expect(nextLabelOn()).toBe("Pierna"));
  });

  it("si Hoy falla tras reordenar, el orden se repinta y no queda una etiqueta desfasada", async () => {
    await renderLoaded();
    expect(nextLabelOn()).toBe("Espalda");
    server.todayFails = true;
    fireEvent.click(screen.getByRole("button", { name: "Subir Pierna" }));
    await waitFor(() => expect(routinesIn("En rotación")).toEqual(["Pecho", "Pierna", "Espalda"]));
    await waitFor(() => expect(screen.queryByText("SIGUIENTE")).toBeNull());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("si el servidor falla, avisa y deja el orden como estaba", async () => {
    await renderLoaded();
    server.reorderStatus = 500;
    fireEvent.click(screen.getByRole("button", { name: "Bajar Pecho" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Fallo simulado");
    expect(routinesIn("En rotación")).toEqual(["Pecho", "Espalda", "Pierna"]);
  });

  it("mientras se guarda el orden no deja mover otra vez", async () => {
    await renderLoaded();
    const gate: { release: (() => void) | null } = { release: null };
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          gate.release = () =>
            resolve(json(200, [{ ...ESPALDA, rotationOrder: 0 }, { ...PECHO, rotationOrder: 1 }, PIERNA, BRAZOS]));
        }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Bajar Pecho" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Bajar Espalda" }) as HTMLButtonElement).disabled).toBe(true));
    gate.release?.();
    await waitFor(() => expect(routinesIn("En rotación")).toEqual(["Espalda", "Pecho", "Pierna"]));
  });
});

describe("Entreno: sin conexión", () => {
  async function saveOfflineCopy() {
    await saveSnapshot({
      savedAt: "2026-11-09T10:00:00.000Z",
      routines: [PECHO, ESPALDA, BRAZOS],
      exercises: [],
      last: {},
    });
  }

  it("enseña las rutinas guardadas en el móvil, con un aviso y para empezarlas", async () => {
    await saveOfflineCopy();
    server.routinesFail = "offline";
    server.todayFails = true;

    await renderLoaded();

    expect(screen.getByRole("status").textContent).toMatch(/Sin conexión: estas son las rutinas guardadas en el móvil/);
    expect(routinesIn("En rotación")).toEqual(["Pecho", "Espalda"]);
    expect(routinesIn("Otras rutinas")).toEqual(["Brazos"]);
    expect(screen.getByRole("link", { name: "Empezar Pecho" }).getAttribute("href")).toBe("/entreno/sesion?rutina=r-pecho");
    expect(screen.getByRole("link", { name: "Entreno libre" })).toBeTruthy();
  });

  it("sin conexión no ofrece reordenar, que necesita al servidor, ni marca cuál toca (Hoy tampoco responde)", async () => {
    await saveOfflineCopy();
    server.routinesFail = "offline";
    server.todayFails = true;

    await renderLoaded();

    expect(screen.queryByRole("button", { name: /^(Subir|Bajar) / })).toBeNull();
    expect(screen.queryByText("SIGUIENTE")).toBeNull();
  });

  it("con conexión no sale el aviso", async () => {
    await saveOfflineCopy();

    await renderLoaded();

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Bajar / }).length).toBeGreaterThan(0);
  });

  it("un error del servidor no se esconde con la copia guardada", async () => {
    await saveOfflineCopy();
    server.routinesFail = 500;
    render(
      <MemoryRouter>
        <Workouts />
      </MemoryRouter>,
    );

    expect((await screen.findByRole("alert")).textContent).toBe("Error interno");
    expect(screen.queryByRole("heading", { level: 3, name: "Pecho" })).toBeNull();
  });
});
