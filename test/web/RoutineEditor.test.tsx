import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { Category, Exercise, Routine } from "../../src/shared/types";
import { RoutineEditor } from "../../src/web/screens/RoutineEditor";


const snapshot = vi.hoisted(() => ({ refresh: vi.fn<() => Promise<void>>() }));

// La copia sin conexión se refresca en segundo plano tras cambiar rutinas o ejercicios.
vi.mock("../../src/web/session/offlineCache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/web/session/offlineCache")>()),
  refreshSnapshot: snapshot.refresh,
}));

function exercise(id: string, name: string, extra: Partial<Exercise> = {}): Exercise {
  const category: Category = "strength";
  return { id, name, category, muscle: "", description: "", mediaUrl: null, isCustom: false, archived: false, ...extra };
}

const EXERCISES: Exercise[] = [
  exercise("e-press", "Press banca", { muscle: "Pecho" }),
  exercise("e-fondos", "Fondos"),
  exercise("e-dom", "Dominadas"),
  exercise("e-correr", "Correr", { category: "cardio" }),
  exercise("e-remo", "Remo antiguo", { archived: true }),
];

const PECHO: Routine = {
  id: "r-pecho",
  name: "Pecho y tríceps",
  inRotation: true,
  rotationOrder: 0,
  archived: false,
  items: [
    { exerciseId: "e-press", position: 0, sets: 4, repsTarget: "8-10", restSeconds: 90 },
    { exerciseId: "e-fondos", position: 1, sets: 3, repsTarget: "12", restSeconds: 60 },
  ],
};

const ESPALDA: Routine = {
  id: "r-espalda",
  name: "Espalda",
  inRotation: true,
  rotationOrder: 1,
  archived: false,
  items: [{ exerciseId: "e-remo", position: 0, sets: 3, repsTarget: "10", restSeconds: 90 }],
};

const OPCIONAL: Routine = {
  id: "r-extra",
  name: "Extra de brazos",
  inRotation: false,
  rotationOrder: 0,
  archived: false,
  items: [],
};

type Call = { method: string; path: string; body: unknown };

const server = {
  routines: [PECHO, ESPALDA, OPCIONAL],
  exercises: EXERCISES,
  routinesFail: null as "offline" | 500 | null,
  exercisesFail: false,
  saveStatus: 200,
  archiveStatus: 200,
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
  if (path === "/api/exercises?archived=1") {
    return server.exercisesFail ? json(500, { error: "Error interno" }) : json(200, server.exercises);
  }
  if (path === "/api/exercises") {
    return json(
      200,
      server.exercises.filter((e) => !e.archived),
    );
  }
  if (path === "/api/routines" && method === "POST") {
    return server.saveStatus === 201 ? json(201, { id: "nueva-id", ...(body as object) }) : json(server.saveStatus, { error: "Fallo simulado" });
  }
  if (path.startsWith("/api/routines/") && method === "PUT") {
    return server.saveStatus === 200 ? json(200, body) : json(server.saveStatus, { error: "Fallo simulado" });
  }
  if (path.startsWith("/api/routines/") && method === "DELETE") {
    return server.archiveStatus === 200 ? json(200, { archived: true }) : json(server.archiveStatus, { error: "Fallo simulado" });
  }
  return json(404, { error: "No encontrado" });
}

function callsTo(method: string, path: string): Call[] {
  return server.calls.filter((call) => call.method === method && call.path === path);
}

function renderEditor(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/entreno/rutina/:id" element={<RoutineEditor />} />
        <Route path="/entreno" element={<p>Pantalla Entreno</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Pinta el editor y espera a que cargue el formulario. */
async function renderLoaded(entry: string) {
  const view = renderEditor(entry);
  await screen.findByLabelText("Nombre");
  return view;
}

/** Los nombres de los ejercicios de la rutina, en el orden en que salen en pantalla. */
function names(): string[] {
  return screen.queryAllByRole("heading", { level: 3 }).map((heading) => heading.textContent ?? "");
}

async function addFromPicker(name: RegExp) {
  fireEvent.click(screen.getByRole("button", { name: "Añadir ejercicio" }));
  const dialog = await screen.findByRole("dialog", { name: "Añadir ejercicio" });
  fireEvent.click(await within(dialog).findByRole("button", { name }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
}

beforeEach(() => {
  server.routines = [PECHO, ESPALDA, OPCIONAL];
  server.exercises = EXERCISES;
  server.routinesFail = null;
  server.exercisesFail = false;
  server.saveStatus = 200;
  server.archiveStatus = 200;
  server.calls = [];
  snapshot.refresh.mockReset();
  snapshot.refresh.mockResolvedValue(undefined);
  fetchMock.mockReset();
  fetchMock.mockImplementation(handle);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Editor de rutina: guardar", () => {
  it("añade un ejercicio desde el selector, lo sube y guarda con las position correctas", async () => {
    await renderLoaded("/entreno/rutina/r-pecho");
    expect(names()).toEqual(["Press banca", "Fondos"]);

    await addFromPicker(/^Dominadas/);
    expect(names()).toEqual(["Press banca", "Fondos", "Dominadas"]);

    fireEvent.click(screen.getByRole("button", { name: "Subir Dominadas" }));
    expect(names()).toEqual(["Press banca", "Dominadas", "Fondos"]);

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await screen.findByText("Pantalla Entreno");

    expect(callsTo("PUT", "/api/routines/r-pecho")).toEqual([
      {
        method: "PUT",
        path: "/api/routines/r-pecho",
        body: {
          id: "r-pecho",
          name: "Pecho y tríceps",
          inRotation: true,
          rotationOrder: 0,
          archived: false,
          items: [
            { exerciseId: "e-press", position: 0, sets: 4, repsTarget: "8-10", restSeconds: 90 },
            { exerciseId: "e-dom", position: 1, sets: 3, repsTarget: "10", restSeconds: 90 },
            { exerciseId: "e-fondos", position: 2, sets: 3, repsTarget: "12", restSeconds: 60 },
          ],
        },
      },
    ]);
  });

  it("quitar un ejercicio deja las position seguidas desde 0", async () => {
    await renderLoaded("/entreno/rutina/r-pecho");
    fireEvent.click(screen.getByRole("button", { name: "Quitar Press banca" }));
    expect(names()).toEqual(["Fondos"]);
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await screen.findByText("Pantalla Entreno");
    const body = callsTo("PUT", "/api/routines/r-pecho")[0]?.body as Routine;
    expect(body.items).toEqual([{ exerciseId: "e-fondos", position: 0, sets: 3, repsTarget: "12", restSeconds: 60 }]);
  });

  it("bajar y subir cambian el orden, y los extremos no se pueden mover", async () => {
    await renderLoaded("/entreno/rutina/r-pecho");
    expect((screen.getByRole("button", { name: "Subir Press banca" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Bajar Fondos" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Bajar Press banca" }));
    expect(names()).toEqual(["Fondos", "Press banca"]);
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await screen.findByText("Pantalla Entreno");
    const body = callsTo("PUT", "/api/routines/r-pecho")[0]?.body as Routine;
    expect(body.items.map((item) => [item.exerciseId, item.position])).toEqual([
      ["e-fondos", 0],
      ["e-press", 1],
    ]);
  });

  it("ordena los ejercicios por position aunque lleguen desordenados", async () => {
    server.routines = [{ ...PECHO, items: [...PECHO.items].reverse() }];
    await renderLoaded("/entreno/rutina/r-pecho");
    expect(names()).toEqual(["Press banca", "Fondos"]);
  });

  it("guarda el nombre, las series, el objetivo y el descanso editados (el descanso admite 0)", async () => {
    await renderLoaded("/entreno/rutina/r-pecho");
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "  Pecho pesado  " } });
    fireEvent.change(screen.getByLabelText("Series de Press banca"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Repeticiones de Press banca"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Descanso de Press banca (s)"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await screen.findByText("Pantalla Entreno");
    const body = callsTo("PUT", "/api/routines/r-pecho")[0]?.body as Routine;
    expect(body.name).toBe("Pecho pesado");
    expect(body.items[0]).toEqual({ exerciseId: "e-press", position: 0, sets: 5, repsTarget: "5", restSeconds: 0 });
  });

  it("el interruptor En rotación se envía; al apagarlo se conserva rotationOrder", async () => {
    await renderLoaded("/entreno/rutina/r-espalda");
    const toggle = screen.getByRole("switch", { name: "En rotación" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await screen.findByText("Pantalla Entreno");
    const body = callsTo("PUT", "/api/routines/r-espalda")[0]?.body as Routine;
    expect(body.inRotation).toBe(false);
    expect(body.rotationOrder).toBe(1);
  });

  it("al meter en la rotación una rutina que no estaba, va al final de la rotación", async () => {
    await renderLoaded("/entreno/rutina/r-extra");
    const toggle = screen.getByRole("switch", { name: "En rotación" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await screen.findByText("Pantalla Entreno");
    const body = callsTo("PUT", "/api/routines/r-extra")[0]?.body as Routine;
    expect(body.inRotation).toBe(true);
    // Hay dos rutinas en rotación (orden 0 y 1): la nueva va detrás.
    expect(body.rotationOrder).toBe(2);
  });

  it("una rutina nueva se crea con POST, en rotación y al final de la rotación", async () => {
    await renderLoaded("/entreno/rutina/nueva");
    expect(screen.getByRole("heading", { level: 1, name: "Nueva rutina" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Piernas" } });
    await addFromPicker(/^Correr/);
    server.saveStatus = 201;
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await screen.findByText("Pantalla Entreno");

    expect(callsTo("PUT", "/api/routines/nueva")).toHaveLength(0);
    expect(callsTo("POST", "/api/routines")).toEqual([
      {
        method: "POST",
        path: "/api/routines",
        body: {
          name: "Piernas",
          inRotation: true,
          rotationOrder: 2,
          archived: false,
          items: [{ exerciseId: "e-correr", position: 0, sets: 3, repsTarget: "10", restSeconds: 90 }],
        },
      },
    ]);
  });

  it("la primera rutina de todas empieza en la posición 0 de la rotación", async () => {
    server.routines = [];
    await renderLoaded("/entreno/rutina/nueva");
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Primera" } });
    server.saveStatus = 201;
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await screen.findByText("Pantalla Entreno");
    expect((callsTo("POST", "/api/routines")[0]?.body as Routine).rotationOrder).toBe(0);
  });
});

describe("Editor de rutina: validación y errores", () => {
  async function saveAndExpectNoRequest(message: RegExp) {
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(message);
    expect(callsTo("PUT", "/api/routines/r-pecho")).toHaveLength(0);
  }

  it("sin nombre no envía nada", async () => {
    await renderLoaded("/entreno/rutina/r-pecho");
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "   " } });
    await saveAndExpectNoRequest(/nombre/i);
  });

  it("series fuera de 1 a 20 o vacías no se envían", async () => {
    await renderLoaded("/entreno/rutina/r-pecho");
    fireEvent.change(screen.getByLabelText("Series de Press banca"), { target: { value: "0" } });
    await saveAndExpectNoRequest(/series/i);
    fireEvent.change(screen.getByLabelText("Series de Press banca"), { target: { value: "21" } });
    await saveAndExpectNoRequest(/series/i);
    fireEvent.change(screen.getByLabelText("Series de Press banca"), { target: { value: "" } });
    await saveAndExpectNoRequest(/series/i);
  });

  it("repeticiones vacías o de más de 30 caracteres no se envían", async () => {
    await renderLoaded("/entreno/rutina/r-pecho");
    fireEvent.change(screen.getByLabelText("Repeticiones de Press banca"), { target: { value: "  " } });
    await saveAndExpectNoRequest(/repeticiones/i);
    fireEvent.change(screen.getByLabelText("Repeticiones de Press banca"), { target: { value: "x".repeat(31) } });
    await saveAndExpectNoRequest(/repeticiones/i);
  });

  it("un descanso de más de 3600 s o vacío no se envía", async () => {
    await renderLoaded("/entreno/rutina/r-pecho");
    fireEvent.change(screen.getByLabelText("Descanso de Press banca (s)"), { target: { value: "3601" } });
    await saveAndExpectNoRequest(/descanso/i);
    fireEvent.change(screen.getByLabelText("Descanso de Press banca (s)"), { target: { value: "" } });
    await saveAndExpectNoRequest(/descanso/i);
  });

  it("si el servidor rechaza el guardado, enseña su mensaje y deja el formulario como estaba", async () => {
    await renderLoaded("/entreno/rutina/r-pecho");
    server.saveStatus = 400;
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Fallo simulado");
    expect(screen.queryByText("Pantalla Entreno")).toBeNull();
    expect(names()).toEqual(["Press banca", "Fondos"]);
    expect((screen.getByRole("button", { name: "Guardar" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("un doble toque en Guardar envía una sola petición", async () => {
    await renderLoaded("/entreno/rutina/r-pecho");
    const save = screen.getByRole("button", { name: "Guardar" });
    fireEvent.click(save);
    fireEvent.click(save);
    await screen.findByText("Pantalla Entreno");
    expect(callsTo("PUT", "/api/routines/r-pecho")).toHaveLength(1);
  });

  it("sin conexión al guardar lo dice y se puede reintentar", async () => {
    await renderLoaded("/entreno/rutina/r-pecho");
    fetchMock.mockImplementationOnce(() => Promise.reject(new TypeError("Failed to fetch")));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Sin conexión");
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await screen.findByText("Pantalla Entreno");
  });
});

describe("Editor de rutina: archivar", () => {
  const TITLE = "¿Archivar esta rutina?";

  async function openConfirmation() {
    fireEvent.click(screen.getByRole("button", { name: "Archivar rutina" }));
    return screen.findByRole("dialog", { name: TITLE });
  }

  it("pide confirmación, explica lo que pasa y cancelar no llama a la API", async () => {
    await renderLoaded("/entreno/rutina/r-pecho");

    const dialog = await openConfirmation();
    expect(dialog.textContent).toContain("desaparecerá de las listas");
    expect(dialog.textContent).toContain("el historial se conserva");
    expect(callsTo("DELETE", "/api/routines/r-pecho")).toHaveLength(0);

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(callsTo("DELETE", "/api/routines/r-pecho")).toHaveLength(0);
    expect(screen.queryByText("Pantalla Entreno")).toBeNull();
    expect(names()).toEqual(["Press banca", "Fondos"]);
  });

  it("al confirmar envía el DELETE de esa rutina y vuelve a Entreno", async () => {
    await renderLoaded("/entreno/rutina/r-espalda");

    const dialog = await openConfirmation();
    fireEvent.click(within(dialog).getByRole("button", { name: "Sí, archivar" }));

    expect(await screen.findByText("Pantalla Entreno")).toBeTruthy();
    expect(callsTo("DELETE", "/api/routines/r-espalda")).toEqual([
      { method: "DELETE", path: "/api/routines/r-espalda", body: undefined },
    ]);
    expect(server.calls.filter((call) => call.method === "DELETE")).toHaveLength(1);
    expect(server.calls.filter((call) => call.method === "PUT" || call.method === "POST")).toHaveLength(0);
  });

  it("no aparece al crear una rutina nueva", async () => {
    await renderLoaded("/entreno/rutina/nueva");

    expect(screen.queryByRole("button", { name: "Archivar rutina" })).toBeNull();
  });

  it("si el servidor falla, enseña su mensaje en la confirmación y se puede reintentar", async () => {
    server.archiveStatus = 500;
    await renderLoaded("/entreno/rutina/r-pecho");

    const dialog = await openConfirmation();
    fireEvent.click(within(dialog).getByRole("button", { name: "Sí, archivar" }));

    expect((await within(dialog).findByRole("alert")).textContent).toBe("Fallo simulado");
    expect(screen.queryByText("Pantalla Entreno")).toBeNull();
    const retry = within(dialog).getByRole("button", { name: "Sí, archivar" }) as HTMLButtonElement;
    expect(retry.disabled).toBe(false);

    server.archiveStatus = 200;
    fireEvent.click(retry);
    expect(await screen.findByText("Pantalla Entreno")).toBeTruthy();
    expect(callsTo("DELETE", "/api/routines/r-pecho")).toHaveLength(2);
  });

  it("sin conexión lo dice y se puede reintentar", async () => {
    await renderLoaded("/entreno/rutina/r-pecho");

    const dialog = await openConfirmation();
    fetchMock.mockImplementationOnce(() => Promise.reject(new TypeError("Failed to fetch")));
    fireEvent.click(within(dialog).getByRole("button", { name: "Sí, archivar" }));

    expect((await within(dialog).findByRole("alert")).textContent).toBe("Sin conexión");
    fireEvent.click(within(dialog).getByRole("button", { name: "Sí, archivar" }));
    expect(await screen.findByText("Pantalla Entreno")).toBeTruthy();
  });

  it("un 404 cuenta como ya archivada y vuelve a Entreno", async () => {
    server.archiveStatus = 404;
    await renderLoaded("/entreno/rutina/r-pecho");

    const dialog = await openConfirmation();
    fireEvent.click(within(dialog).getByRole("button", { name: "Sí, archivar" }));

    expect(await screen.findByText("Pantalla Entreno")).toBeTruthy();
  });

  it("un doble toque en Sí, archivar envía una sola petición", async () => {
    await renderLoaded("/entreno/rutina/r-pecho");

    const dialog = await openConfirmation();
    const confirm = within(dialog).getByRole("button", { name: "Sí, archivar" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await screen.findByText("Pantalla Entreno");
    expect(callsTo("DELETE", "/api/routines/r-pecho")).toHaveLength(1);
  });

  it("mientras archiva no se puede cancelar ni guardar", async () => {
    await renderLoaded("/entreno/rutina/r-pecho");
    const dialog = await openConfirmation();
    let release: (response: Response) => void = () => undefined;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve)));

    fireEvent.click(within(dialog).getByRole("button", { name: "Sí, archivar" }));

    await waitFor(() => expect((within(dialog).getByRole("button", { name: "Cancelar" }) as HTMLButtonElement).disabled).toBe(true));
    expect((screen.getByRole("button", { name: "Guardar" }) as HTMLButtonElement).disabled).toBe(true);
    release(json(200, { archived: true }));
    expect(await screen.findByText("Pantalla Entreno")).toBeTruthy();
  });
});

describe("Editor de rutina: carga y selector", () => {
  it("una rutina que no existe lo dice y vuelve a Entreno", async () => {
    renderEditor("/entreno/rutina/no-existe");
    expect(await screen.findByText("Rutina no encontrada")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Volver a Entreno" }).getAttribute("href")).toBe("/entreno");
    expect(screen.queryByLabelText("Nombre")).toBeNull();
  });

  it("si falla la carga sale el error con Reintentar, y reintentar recupera el formulario", async () => {
    server.routinesFail = 500;
    renderEditor("/entreno/rutina/r-pecho");
    expect((await screen.findByRole("alert")).textContent).toBe("Error interno");
    server.routinesFail = null;
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByLabelText("Nombre")).toBeTruthy();
  });

  it("sin conexión sale Sin conexión con Reintentar", async () => {
    server.routinesFail = "offline";
    renderEditor("/entreno/rutina/r-pecho");
    expect(await screen.findByText("Sin conexión")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeTruthy();
  });

  it("un ejercicio archivado de la rutina se nombra, aunque el selector no lo ofrezca", async () => {
    await renderLoaded("/entreno/rutina/r-espalda");
    expect(names()).toEqual(["Remo antiguo"]);
    fireEvent.click(screen.getByRole("button", { name: "Añadir ejercicio" }));
    const dialog = await screen.findByRole("dialog", { name: "Añadir ejercicio" });
    await within(dialog).findByRole("button", { name: /Press banca/ });
    expect(within(dialog).queryByRole("button", { name: /Remo antiguo/ })).toBeNull();
  });

  it("si no se pueden cargar los nombres, los ejercicios salen como Ejercicio y se puede guardar", async () => {
    server.exercisesFail = true;
    await renderLoaded("/entreno/rutina/r-pecho");
    expect(names()).toEqual(["Ejercicio", "Ejercicio"]);
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await screen.findByText("Pantalla Entreno");
    expect(callsTo("PUT", "/api/routines/r-pecho")).toHaveLength(1);
  });

  it("el selector busca sin importar mayúsculas ni tildes y filtra por categoría", async () => {
    await renderLoaded("/entreno/rutina/nueva");
    fireEvent.click(screen.getByRole("button", { name: "Añadir ejercicio" }));
    const dialog = await screen.findByRole("dialog", { name: "Añadir ejercicio" });
    await within(dialog).findByRole("button", { name: /Fondos/ });

    fireEvent.change(within(dialog).getByRole("searchbox", { name: "Buscar ejercicio" }), { target: { value: "PRÉSS" } });
    expect(within(dialog).getAllByRole("button", { name: /Press banca|Fondos|Dominadas|Correr/ }).map((b) => b.textContent)).toEqual([
      expect.stringContaining("Press banca"),
    ]);

    fireEvent.change(within(dialog).getByRole("searchbox", { name: "Buscar ejercicio" }), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cardio" }));
    const rows = within(dialog)
      .getAllByRole("listitem")
      .map((row) => row.textContent);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("Correr");
  });

  it("no muestra Infinity ni NaN", async () => {
    await renderLoaded("/entreno/rutina/r-pecho");
    expect(document.body.textContent).not.toMatch(/Infinity|NaN/);
  });
});

describe("Editor de rutina: copia sin conexión", () => {
  /** Qué peticiones de escritura había ya hechas cada vez que se refrescó la copia. */
  function writesSeenOnRefresh(): number[] {
    const seen: number[] = [];
    snapshot.refresh.mockImplementation(async () => {
      seen.push(server.calls.filter((call) => call.method !== "GET").length);
    });
    return seen;
  }

  it("guardar cambios de una rutina refresca la copia, después de guardar", async () => {
    const seen = writesSeenOnRefresh();
    await renderLoaded("/entreno/rutina/r-pecho");

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await screen.findByText("Pantalla Entreno");

    expect(snapshot.refresh).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([1]);
  });

  it("crear una rutina nueva refresca la copia", async () => {
    server.saveStatus = 201;
    await renderLoaded("/entreno/rutina/nueva");
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Hombros" } });
    await addFromPicker(/^Dominadas/);

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await screen.findByText("Pantalla Entreno");

    expect(callsTo("POST", "/api/routines")).toHaveLength(1);
    expect(snapshot.refresh).toHaveBeenCalledTimes(1);
  });

  it("archivar una rutina refresca la copia, también si ya estaba archivada (404)", async () => {
    for (const status of [200, 404]) {
      snapshot.refresh.mockClear();
      server.archiveStatus = status;
      const view = await renderLoaded("/entreno/rutina/r-pecho");
      fireEvent.click(screen.getByRole("button", { name: "Archivar rutina" }));
      fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Sí, archivar" }));
      await screen.findByText("Pantalla Entreno");

      expect(snapshot.refresh, `DELETE ${status}`).toHaveBeenCalledTimes(1);
      view.unmount();
    }
  });

  it("si el guardado o el archivado fallan no se refresca nada: no ha cambiado nada", async () => {
    server.saveStatus = 500;
    server.archiveStatus = 500;
    await renderLoaded("/entreno/rutina/r-pecho");

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Archivar rutina" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Sí, archivar" }));
    await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThan(1));

    expect(snapshot.refresh).not.toHaveBeenCalled();
  });

  it("no bloquea: aunque el refresco no termine nunca, se vuelve a Entreno", async () => {
    snapshot.refresh.mockReturnValue(new Promise(() => undefined));
    await renderLoaded("/entreno/rutina/r-pecho");

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByText("Pantalla Entreno")).toBeTruthy();
  });

  it("si el refresco falla se ignora: se vuelve a Entreno sin avisos", async () => {
    snapshot.refresh.mockRejectedValue(new Error("Sin conexión"));
    await renderLoaded("/entreno/rutina/r-pecho");

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByText("Pantalla Entreno")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
