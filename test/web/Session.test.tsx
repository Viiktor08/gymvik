import "fake-indexeddb/auto";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Exercise, Routine, SetEntry } from "../../src/shared/types";
import { Session } from "../../src/web/screens/Session";
import { clearDraft, loadDraft, saveDraft, type Draft } from "../../src/web/session/draftStore";
import { isQueued, listRejected, pendingCount, rejectedCount } from "../../src/web/session/outbox";
import { saveSnapshot } from "../../src/web/session/offlineCache";
import { syncOutbox } from "../../src/web/session/sync";

function exercise(id: string, name: string, extra: Partial<Exercise> = {}): Exercise {
  return { id, name, category: "strength", muscle: "", description: "", mediaUrl: null, isCustom: false, archived: false, ...extra };
}

function set(weightKg: number | null, reps: number | null, extra: Partial<SetEntry> = {}): SetEntry {
  return { weightKg, reps, rir: null, durationMin: null, distanceKm: null, ...extra };
}

const EXERCISES: Exercise[] = [
  exercise("e-press", "Press banca", { muscle: "Pecho" }),
  exercise("e-fondos", "Fondos"),
  exercise("e-remo", "Remo con barra"),
  exercise("e-correr", "Correr", { category: "cardio" }),
  exercise("e-viejo", "Press antiguo", { archived: true }),
];

const PECHO: Routine = {
  id: "r-pecho",
  name: "Pecho y tríceps",
  inRotation: true,
  rotationOrder: 0,
  archived: false,
  items: [
    { exerciseId: "e-press", position: 0, sets: 3, repsTarget: "8-10", restSeconds: 90 },
    { exerciseId: "e-fondos", position: 1, sets: 2, repsTarget: "12", restSeconds: 60 },
  ],
};

const ESPALDA: Routine = {
  id: "r-espalda",
  name: "Espalda",
  inRotation: true,
  rotationOrder: 1,
  archived: false,
  items: [{ exerciseId: "e-remo", position: 0, sets: 3, repsTarget: "10", restSeconds: 75 }],
};

const CARDIO: Routine = {
  id: "r-cardio",
  name: "Cardio",
  inRotation: false,
  rotationOrder: 0,
  archived: false,
  items: [{ exerciseId: "e-correr", position: 0, sets: 1, repsTarget: "20 min", restSeconds: 0 }],
};

type Call = { method: string; path: string; body: unknown };

const server = {
  routines: [PECHO, ESPALDA, CARDIO],
  exercises: EXERCISES,
  history: {
    "e-press": [{ workoutId: "w-old", localDate: "2026-11-03", sets: [set(60, 10), set(60, 9), set(57.5, 8)] }],
    "e-correr": [{ workoutId: "w-old", localDate: "2026-11-03", sets: [set(null, null, { durationMin: 30, distanceKm: 5 })] }],
  } as Record<string, unknown[]>,
  /** Sin red: toda petición falla como un fetch sin cobertura. */
  offline: false,
  /** Un error del servidor (p. ej. 500) en rutinas y ejercicios; el historial sigue respondiendo. */
  catalogStatus: null as number | null,
  putStatus: 200,
  applyStatus: 200,
  newRecords: [] as unknown[],
  calls: [] as Call[],
};

const fetchMock = vi.fn<typeof fetch>();

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function handle(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (server.offline) throw new TypeError("Failed to fetch");
  const path = String(input);
  const method = init?.method ?? "GET";
  const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
  server.calls.push({ method, path, body });

  const isCatalog = path === "/api/routines" || path === "/api/exercises" || path === "/api/exercises?archived=1";
  if (isCatalog && server.catalogStatus !== null) return json(server.catalogStatus, { error: "Error interno" });
  if (path === "/api/routines") return json(200, server.routines);
  if (path === "/api/exercises?archived=1") return json(200, server.exercises);
  if (path === "/api/exercises") return json(200, server.exercises.filter((e) => !e.archived));
  const history = /^\/api\/exercises\/([^/]+)\/history$/.exec(path);
  if (history) return json(200, server.history[decodeURIComponent(history[1] ?? "")] ?? []);
  if (method === "PUT" && path.startsWith("/api/workouts/")) {
    if (server.putStatus !== 200) return json(server.putStatus, { error: "Fallo simulado" });
    return json(200, { workout: body, newRecords: server.newRecords });
  }
  if (method === "POST" && path.endsWith("/apply-to-routine")) {
    if (server.applyStatus !== 200) return json(server.applyStatus, { error: "Fallo simulado" });
    return json(200, PECHO);
  }
  return json(404, { error: "No encontrado" });
}

function calls(method: string): Call[] {
  return server.calls.filter((call) => call.method === method && call.path !== "/api/routines");
}

function Where() {
  const location = useLocation();
  return <p data-testid="where">{`${location.pathname}${location.search}`}</p>;
}

function renderSession(url = "/entreno/sesion?rutina=r-pecho") {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Where />
      <Routes>
        <Route path="/entreno/sesion" element={<Session />} />
        <Route path="/entreno" element={<p>PANTALLA ENTRENO</p>} />
        <Route path="/" element={<p>PANTALLA HOY</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** La tarjeta de un ejercicio de la sesión. */
function card(name: string): HTMLElement {
  return screen.getByRole("region", { name });
}

async function cardAppears(name: string): Promise<HTMLElement> {
  return screen.findByRole("region", { name });
}

function field(name: string, label: string): HTMLInputElement {
  return within(card(name)).getByLabelText(label) as HTMLInputElement;
}

function mark(name: string, setNumber: number) {
  fireEvent.click(within(card(name)).getByRole("button", { name: `Marcar serie ${setNumber} como hecha` }));
}

function type(name: string, label: string, value: string) {
  fireEvent.change(field(name, label), { target: { value } });
}

async function savedDraft(): Promise<Draft> {
  const draft = await loadDraft();
  if (!draft) throw new Error("No hay borrador guardado");
  return draft;
}

function open(name: RegExp | string) {
  fireEvent.click(screen.getByRole("button", { name }));
}

function menuOf(name: string) {
  fireEvent.click(within(card(name)).getByRole("button", { name: `Opciones de ${name}` }));
}

function dialog(name: string): HTMLElement {
  return screen.getByRole("dialog", { name });
}

const HOUR = 3_600_000;

/** Un borrador empezado hace 20 minutos (salvo que se diga otra cosa): reciente, no olvidado. */
function draftOf(overrides: Partial<Draft> = {}): Draft {
  return {
    id: "w-draft",
    routineId: "r-pecho",
    startedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
    exercises: [
      {
        exerciseId: "e-press",
        restSeconds: 90,
        sets: [{ ...set(61, 10), done: true }, { ...set(61, 10), done: false }],
      },
      { exerciseId: "e-fondos", restSeconds: 60, sets: [{ ...set(null, 12), done: false }] },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  server.routines = [PECHO, ESPALDA, CARDIO];
  server.exercises = EXERCISES;
  server.offline = false;
  server.catalogStatus = null;
  server.putStatus = 200;
  server.applyStatus = 200;
  server.newRecords = [];
  server.calls = [];
  fetchMock.mockReset();
  fetchMock.mockImplementation(handle);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("empezar una rutina", () => {
  it("enseña los ejercicios en orden, con la última vez debajo del nombre y las series prerrellenadas", async () => {
    renderSession();

    const press = await cardAppears("Press banca");
    expect(within(press).getByText("Última vez: 60×10 · 60×9 · 57,5×8")).toBeTruthy();
    // Con historial se copian las series de la última vez; la rutina pide 3 y hubo 3.
    expect(field("Press banca", "Peso, serie 1").value).toBe("60");
    expect(field("Press banca", "Repeticiones, serie 1").value).toBe("10");
    expect(field("Press banca", "Peso, serie 3").value).toBe("57,5");
    expect(field("Press banca", "Repeticiones, serie 3").value).toBe("8");
    expect(within(press).getAllByRole("button", { name: /^Marcar serie \d como hecha$/ })).toHaveLength(3);

    const names = screen.getAllByRole("region").map((region) => region.getAttribute("aria-label") ?? within(region).queryByRole("heading")?.textContent);
    expect(names.slice(0, 2)).toEqual(["Press banca", "Fondos"]);
  });

  it("un ejercicio que nunca se hizo sale con el peso vacío y las repeticiones del objetivo, sin 'Última vez'", async () => {
    renderSession();

    const fondos = await cardAppears("Fondos");

    expect(within(fondos).queryByText(/Última vez/)).toBeNull();
    expect(field("Fondos", "Peso, serie 1").value).toBe("");
    expect(field("Fondos", "Repeticiones, serie 1").value).toBe("12");
    expect(within(fondos).getAllByRole("button", { name: /^Marcar serie/ })).toHaveLength(2);
  });

  it("ninguna serie empieza marcada y el borrador se guarda desde el primer momento", async () => {
    renderSession();
    await cardAppears("Press banca");

    expect(screen.queryByRole("timer", { name: "Descanso" })).toBeNull();
    await waitFor(async () => {
      const draft = await savedDraft();
      expect(draft.routineId).toBe("r-pecho");
      expect(draft.exercises.map((e) => e.exerciseId)).toEqual(["e-press", "e-fondos"]);
      expect(draft.exercises.flatMap((e) => e.sets).every((s) => !s.done)).toBe(true);
      expect(draft.exercises[0]?.restSeconds).toBe(90);
    });
  });

  it("un id nuevo cada vez y la hora de inicio es la de ahora", async () => {
    const before = Date.now();
    renderSession();
    await cardAppears("Press banca");

    const draft = await savedDraft();
    expect(draft.id.length).toBeGreaterThan(10);
    expect(Date.parse(draft.startedAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(draft.startedAt)).toBeLessThanOrEqual(Date.now());
  });

  it("una rutina que no existe lo dice y no empieza nada", async () => {
    renderSession("/entreno/sesion?rutina=no-existe");

    expect(await screen.findByText("Rutina no encontrada")).toBeTruthy();
    expect(await loadDraft()).toBeNull();
  });

  it("si el servidor falla, enseña el error con Reintentar", async () => {
    fetchMock.mockImplementation(async () => json(500, { error: "Error interno" }));
    renderSession();

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeTruthy();
    expect(await loadDraft()).toBeNull();
  });
});

describe("entreno libre", () => {
  it("sin parámetro y sin borrador empieza vacío, sin rutina, y se guarda", async () => {
    renderSession("/entreno/sesion");

    expect(await screen.findByText("Entreno libre")).toBeTruthy();
    expect(screen.getByText("Todavía no hay ejercicios. Añade el primero.")).toBeTruthy();
    await waitFor(async () => expect((await savedDraft()).routineId).toBeNull());
  });

  it("añadir un ejercicio desde el selector trae sus series con la última vez", async () => {
    renderSession("/entreno/sesion");
    await screen.findByText("Entreno libre");

    open("Añadir ejercicio");
    fireEvent.click(await within(dialog("Añadir ejercicio")).findByRole("button", { name: /Press banca/ }));

    const press = await cardAppears("Press banca");
    expect(within(press).getByText("Última vez: 60×10 · 60×9 · 57,5×8")).toBeTruthy();
    // 3 series de fuerza, copiando la última vez y repitiendo la última.
    expect(within(press).getAllByRole("button", { name: /^Marcar serie/ })).toHaveLength(3);
    expect(field("Press banca", "Peso, serie 3").value).toBe("57,5");
    await waitFor(async () => expect((await savedDraft()).exercises.map((e) => e.exerciseId)).toEqual(["e-press"]));
  });

  it("un ejercicio nuevo sin historial sale con 3 series de 10 repeticiones y 90 s de descanso", async () => {
    renderSession("/entreno/sesion");
    await screen.findByText("Entreno libre");

    open("Añadir ejercicio");
    fireEvent.click(await within(dialog("Añadir ejercicio")).findByRole("button", { name: /Remo con barra/ }));

    await cardAppears("Remo con barra");
    expect(field("Remo con barra", "Repeticiones, serie 2").value).toBe("10");
    expect(field("Remo con barra", "Peso, serie 1").value).toBe("");
    await waitFor(async () => expect((await savedDraft()).exercises[0]?.restSeconds).toBe(90));
  });

  it("el selector no ofrece los ejercicios archivados", async () => {
    renderSession("/entreno/sesion");
    await screen.findByText("Entreno libre");

    open("Añadir ejercicio");
    await within(dialog("Añadir ejercicio")).findByRole("button", { name: /Press banca/ });

    expect(within(dialog("Añadir ejercicio")).queryByText("Press antiguo")).toBeNull();
  });

  it("al terminar no pregunta por la rutina: no hay rutina de origen", async () => {
    renderSession("/entreno/sesion");
    await screen.findByText("Entreno libre");
    open("Añadir ejercicio");
    fireEvent.click(await within(dialog("Añadir ejercicio")).findByRole("button", { name: /Press banca/ }));
    await cardAppears("Press banca");
    mark("Press banca", 1);

    open("Terminar");

    expect(screen.queryByText("¿Guardar estos cambios en la rutina o solo para hoy?")).toBeNull();
    expect(within(dialog("Terminar entreno")).getByRole("button", { name: "Guardar entreno" })).toBeTruthy();
  });
});

describe("rellenar series", () => {
  it("cada cambio se guarda en el móvil: peso con coma, repeticiones y marca", async () => {
    renderSession();
    await cardAppears("Press banca");

    type("Press banca", "Peso, serie 1", "62,5");
    await waitFor(async () => expect((await savedDraft()).exercises[0]?.sets[0]?.weightKg).toBe(62.5));

    type("Press banca", "Repeticiones, serie 1", "8");
    await waitFor(async () => expect((await savedDraft()).exercises[0]?.sets[0]?.reps).toBe(8));

    mark("Press banca", 1);
    await waitFor(async () => expect((await savedDraft()).exercises[0]?.sets[0]?.done).toBe(true));

    fireEvent.click(within(card("Press banca")).getByRole("button", { name: "Desmarcar serie 1" }));
    await waitFor(async () => expect((await savedDraft()).exercises[0]?.sets[0]?.done).toBe(false));
  });

  it("vaciar un campo lo guarda como vacío, no como 0", async () => {
    renderSession();
    await cardAppears("Press banca");

    type("Press banca", "Peso, serie 1", "");

    await waitFor(async () => expect((await savedDraft()).exercises[0]?.sets[0]?.weightKg).toBeNull());
  });

  it("el RIR está plegado y se despliega con su botón", async () => {
    renderSession();
    await cardAppears("Press banca");
    expect(within(card("Press banca")).queryByLabelText("RIR, serie 1")).toBeNull();

    fireEvent.click(within(card("Press banca")).getByRole("button", { name: "RIR" }));
    type("Press banca", "RIR, serie 1", "2");

    await waitFor(async () => expect((await savedDraft()).exercises[0]?.sets[0]?.rir).toBe(2));
  });

  it("el cardio tiene minutos y distancia, no peso ni repeticiones", async () => {
    renderSession("/entreno/sesion?rutina=r-cardio");
    const correr = await cardAppears("Correr");

    expect(within(correr).getByText("Última vez: 30 min · 5 km")).toBeTruthy();
    expect(field("Correr", "Minutos, serie 1").value).toBe("30");
    expect(field("Correr", "Distancia (km), serie 1").value).toBe("5");
    expect(within(correr).queryByLabelText("Peso, serie 1")).toBeNull();
    expect(within(correr).queryByLabelText("RIR, serie 1")).toBeNull();
    expect(within(correr).queryByRole("button", { name: "RIR" })).toBeNull();

    type("Correr", "Distancia (km), serie 1", "5,25");
    await waitFor(async () => expect((await savedDraft()).exercises[0]?.sets[0]?.distanceKm).toBe(5.25));
  });
});

describe("temporizador de descanso", () => {
  it("marcar una serie arranca la cuenta atrás con los segundos de descanso de su ejercicio", async () => {
    renderSession();
    await cardAppears("Press banca");

    mark("Press banca", 1);
    expect(screen.getByRole("timer", { name: "Descanso" }).textContent).toContain("1:30");

    mark("Fondos", 1);
    expect(screen.getByRole("timer", { name: "Descanso" }).textContent).toContain("1:00");
  });

  it("desmarcar una serie no arranca ningún descanso", async () => {
    renderSession();
    await cardAppears("Press banca");
    mark("Press banca", 1);
    fireEvent.click(screen.getByRole("button", { name: "Saltar" }));

    fireEvent.click(within(card("Press banca")).getByRole("button", { name: "Desmarcar serie 1" }));

    expect(screen.queryByRole("timer", { name: "Descanso" })).toBeNull();
  });

  it("+15 s suma a lo que queda y Saltar lo quita", async () => {
    renderSession();
    await cardAppears("Press banca");
    mark("Press banca", 1);

    fireEvent.click(screen.getByRole("button", { name: "+15 s" }));
    expect(screen.getByRole("timer", { name: "Descanso" }).textContent).toContain("1:45");

    fireEvent.click(screen.getByRole("button", { name: "Saltar" }));
    expect(screen.queryByRole("timer", { name: "Descanso" })).toBeNull();
  });

  it("un ejercicio con 0 s de descanso no arranca la cuenta atrás", async () => {
    renderSession("/entreno/sesion?rutina=r-cardio");
    await cardAppears("Correr");

    mark("Correr", 1);

    expect(screen.queryByRole("timer", { name: "Descanso" })).toBeNull();
  });

  it("al acabar el descanso suena el aviso (Web Audio)", async () => {
    const oscillators: unknown[] = [];
    class FakeAudioContext {
      currentTime = 0;
      destination = {};
      resume() {
        return Promise.resolve();
      }
      createGain() {
        return { connect() {}, gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} } };
      }
      createOscillator() {
        const node = { connect() {}, start() {}, stop() {}, frequency: { value: 0 }, type: "sine" };
        oscillators.push(node);
        return node;
      }
    }
    vi.stubGlobal("AudioContext", FakeAudioContext);
    server.routines = [{ ...PECHO, items: [{ ...PECHO.items[0]!, restSeconds: 1 }] }];
    renderSession();
    await cardAppears("Press banca");

    mark("Press banca", 1);
    expect(oscillators).toHaveLength(0);

    await waitFor(() => expect(oscillators.length).toBeGreaterThan(0), { timeout: 3000 });
    expect(screen.queryByRole("timer", { name: "Descanso" })).toBeNull();
  });
});

describe("menú del ejercicio", () => {
  it("añadir serie repite la última sin marcar; quitar serie quita la última", async () => {
    renderSession();
    await cardAppears("Press banca");

    menuOf("Press banca");
    fireEvent.click(within(dialog("Press banca")).getByRole("button", { name: "Añadir serie" }));
    expect(within(card("Press banca")).getAllByRole("button", { name: /^Marcar serie/ })).toHaveLength(4);
    expect(field("Press banca", "Peso, serie 4").value).toBe("57,5");

    fireEvent.click(within(dialog("Press banca")).getByRole("button", { name: "Quitar última serie" }));
    fireEvent.click(within(dialog("Press banca")).getByRole("button", { name: "Quitar última serie" }));
    expect(within(card("Press banca")).getAllByRole("button", { name: /^Marcar serie/ })).toHaveLength(2);
    await waitFor(async () => expect((await savedDraft()).exercises[0]?.sets).toHaveLength(2));
  });

  it("no se puede quitar la única serie que queda", async () => {
    renderSession("/entreno/sesion?rutina=r-cardio");
    await cardAppears("Correr");

    menuOf("Correr");

    expect((within(dialog("Correr")).getByRole("button", { name: "Quitar última serie" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("subir y bajar cambian el orden; en los extremos están desactivados", async () => {
    renderSession();
    await cardAppears("Press banca");
    menuOf("Press banca");
    expect((within(dialog("Press banca")).getByRole("button", { name: "Subir" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(within(dialog("Press banca")).getByRole("button", { name: "Bajar" }));

    await waitFor(async () => expect((await savedDraft()).exercises.map((e) => e.exerciseId)).toEqual(["e-fondos", "e-press"]));
  });

  it("quitar ejercicio lo saca de la sesión", async () => {
    renderSession();
    await cardAppears("Press banca");
    menuOf("Fondos");

    fireEvent.click(within(dialog("Fondos")).getByRole("button", { name: "Quitar ejercicio" }));

    expect(screen.queryByRole("region", { name: "Fondos" })).toBeNull();
    await waitFor(async () => expect((await savedDraft()).exercises.map((e) => e.exerciseId)).toEqual(["e-press"]));
  });

  it("cambiar por otro ejercicio: mismo sitio, series nuevas y desmarcadas, mismo descanso", async () => {
    renderSession();
    await cardAppears("Press banca");
    mark("Press banca", 1);

    menuOf("Press banca");
    fireEvent.click(within(dialog("Press banca")).getByRole("button", { name: "Cambiar por otro ejercicio" }));
    fireEvent.click(await within(dialog("Cambiar ejercicio")).findByRole("button", { name: /Remo con barra/ }));

    const remo = await cardAppears("Remo con barra");
    expect(screen.queryByRole("region", { name: "Press banca" })).toBeNull();
    expect(within(remo).getAllByRole("button", { name: /^Marcar serie/ })).toHaveLength(3);
    await waitFor(async () => {
      const draft = await savedDraft();
      expect(draft.exercises.map((e) => e.exerciseId)).toEqual(["e-remo", "e-fondos"]);
      expect(draft.exercises[0]?.restSeconds).toBe(90);
      expect(draft.exercises[0]?.sets.every((s) => !s.done)).toBe(true);
    });
  });
});

describe("terminar", () => {
  it("sin ninguna serie marcada avisa, no envía nada y deja seguir o descartar", async () => {
    renderSession();
    await cardAppears("Press banca");

    open("Terminar");

    const notice = dialog("Aún no hay series hechas");
    expect(within(notice).getByText(/Todavía no has marcado ninguna serie/)).toBeTruthy();
    fireEvent.click(within(notice).getByRole("button", { name: "Seguir entrenando" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(calls("PUT")).toHaveLength(0);
    expect(await pendingCount()).toBe(0);
    expect(await loadDraft()).not.toBeNull();
  });

  it("solo se envían las series marcadas con ✓ y los ejercicios que tienen alguna", async () => {
    renderSession();
    await cardAppears("Press banca");
    type("Press banca", "Peso, serie 1", "62,5");
    mark("Press banca", 1);
    mark("Press banca", 2);

    open("Terminar");
    fireEvent.change(within(dialog("Terminar entreno")).getByLabelText("Notas"), { target: { value: "Buen día" } });
    fireEvent.click(within(dialog("Terminar entreno")).getByRole("button", { name: "Guardar entreno" }));

    await screen.findByRole("heading", { name: "Entreno terminado" });
    const puts = calls("PUT");
    expect(puts).toHaveLength(1);
    const draft = puts[0]?.path.split("/").pop();
    expect(puts[0]?.path).toBe(`/api/workouts/${draft}`);
    expect(puts[0]?.body).toMatchObject({
      id: draft,
      routineId: "r-pecho",
      notes: "Buen día",
      source: "live",
      exercises: [
        {
          exerciseId: "e-press",
          sets: [set(62.5, 10), set(60, 9)],
        },
      ],
    });
    // Fondos no tenía ninguna serie marcada: no se envía.
    const body = puts[0]?.body as { exercises: unknown[]; startedAt: string; endedAt: string };
    expect(body.exercises).toHaveLength(1);
    expect(Date.parse(body.endedAt)).toBeGreaterThanOrEqual(Date.parse(body.startedAt));
  });

  it("solo cambian pesos y repeticiones: no pregunta por la rutina", async () => {
    renderSession();
    await cardAppears("Press banca");
    type("Press banca", "Peso, serie 1", "65");
    type("Press banca", "Repeticiones, serie 1", "5");
    mark("Press banca", 1);

    open("Terminar");

    expect(screen.queryByText("¿Guardar estos cambios en la rutina o solo para hoy?")).toBeNull();
    expect(within(dialog("Terminar entreno")).getByRole("button", { name: "Guardar entreno" })).toBeTruthy();
    expect(within(dialog("Terminar entreno")).queryByRole("button", { name: "Guardar en la rutina" })).toBeNull();
  });

  it("saltarse series sin marcar no cuenta como cambiar la rutina", async () => {
    renderSession();
    await cardAppears("Press banca");
    // Solo se marca una serie de las 3 y ninguna de Fondos: la estructura de las filas sigue igual.
    mark("Press banca", 1);

    open("Terminar");

    expect(screen.queryByText("¿Guardar estos cambios en la rutina o solo para hoy?")).toBeNull();
  });

  it("tras añadir una serie pregunta si guardar los cambios en la rutina o solo para hoy", async () => {
    renderSession();
    await cardAppears("Press banca");
    menuOf("Press banca");
    fireEvent.click(within(dialog("Press banca")).getByRole("button", { name: "Añadir serie" }));
    fireEvent.click(within(dialog("Press banca")).getByRole("button", { name: "Cerrar" }));
    mark("Press banca", 1);

    open("Terminar");

    const finish = dialog("Terminar entreno");
    expect(within(finish).getByText("¿Guardar estos cambios en la rutina o solo para hoy?")).toBeTruthy();
    expect(within(finish).getByRole("button", { name: "Guardar en la rutina" })).toBeTruthy();
    expect(within(finish).getByRole("button", { name: "Solo para hoy" })).toBeTruthy();
    expect(within(finish).queryByRole("button", { name: "Guardar entreno" })).toBeNull();
  });

  it("'Solo para hoy' guarda el entreno y no toca la rutina", async () => {
    renderSession();
    await cardAppears("Press banca");
    menuOf("Press banca");
    fireEvent.click(within(dialog("Press banca")).getByRole("button", { name: "Añadir serie" }));
    fireEvent.click(within(dialog("Press banca")).getByRole("button", { name: "Cerrar" }));
    mark("Press banca", 1);
    open("Terminar");

    fireEvent.click(within(dialog("Terminar entreno")).getByRole("button", { name: "Solo para hoy" }));

    await screen.findByRole("heading", { name: "Entreno terminado" });
    expect(calls("PUT")).toHaveLength(1);
    expect(calls("POST")).toHaveLength(0);
  });

  it("'Guardar en la rutina' envía el entreno y después la estructura del borrador (todas las filas)", async () => {
    renderSession();
    await cardAppears("Press banca");
    menuOf("Press banca");
    fireEvent.click(within(dialog("Press banca")).getByRole("button", { name: "Añadir serie" }));
    fireEvent.click(within(dialog("Press banca")).getByRole("button", { name: "Cerrar" }));
    mark("Press banca", 1);
    open("Terminar");

    fireEvent.click(within(dialog("Terminar entreno")).getByRole("button", { name: "Guardar en la rutina" }));

    await screen.findByRole("heading", { name: "Entreno terminado" });
    const writes = server.calls.filter((call) => call.method === "PUT" || call.method === "POST");
    expect(writes.map((call) => call.method)).toEqual(["PUT", "POST"]);
    const id = writes[0]?.path.split("/").pop();
    expect(writes[1]?.path).toBe(`/api/workouts/${id}/apply-to-routine`);
    // Fondos no se hizo, pero sigue en la estructura de la sesión: no se borra de la rutina.
    expect(writes[1]?.body).toEqual({
      exercises: [
        { exerciseId: "e-press", sets: 4 },
        { exerciseId: "e-fondos", sets: 2 },
      ],
    });
  });

  it("quitar un ejercicio entero también es un cambio de estructura", async () => {
    renderSession();
    await cardAppears("Press banca");
    menuOf("Fondos");
    fireEvent.click(within(dialog("Fondos")).getByRole("button", { name: "Quitar ejercicio" }));
    mark("Press banca", 1);

    open("Terminar");

    expect(screen.getByText("¿Guardar estos cambios en la rutina o solo para hoy?")).toBeTruthy();
  });

  it("al terminar borra el borrador y desde el resumen se vuelve a Hoy", async () => {
    renderSession();
    await cardAppears("Press banca");
    mark("Press banca", 1);
    open("Terminar");

    fireEvent.click(within(dialog("Terminar entreno")).getByRole("button", { name: "Guardar entreno" }));

    await screen.findByRole("heading", { name: "Entreno terminado" });
    expect(await loadDraft()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Listo" }));
    expect(await screen.findByText("PANTALLA HOY")).toBeTruthy();
  });

  it("el resumen enseña duración, volumen, series y las notas, calculados con lo marcado", async () => {
    // Entreno libre: sin rutina de origen no hay pregunta sobre la estructura.
    await saveDraft(draftOf({ routineId: null, startedAt: new Date(Date.now() - 65 * 60_000).toISOString() }));
    renderSession("/entreno/sesion");
    await cardAppears("Press banca");
    mark("Press banca", 2);
    open("Terminar");
    fireEvent.change(within(dialog("Terminar entreno")).getByLabelText("Notas"), { target: { value: "Fuerte" } });
    fireEvent.click(within(dialog("Terminar entreno")).getByRole("button", { name: "Guardar entreno" }));

    await screen.findByRole("heading", { name: "Entreno terminado" });
    const summary = screen.getByRole("region", { name: "Resumen" });
    expect(within(summary).getByText("1 h 05 min")).toBeTruthy();
    // 2 series de 61 × 10.
    expect(within(summary).getByText("1.220 kg")).toBeTruthy();
    expect(within(summary).getByText("2")).toBeTruthy();
    expect(within(summary).getByText("Fuerte")).toBeTruthy();
    expect(summary.textContent).not.toMatch(/NaN|Infinity/);
  });

  it("el resumen enseña los récords que devuelve el PUT, con el nombre del ejercicio", async () => {
    server.newRecords = [
      { exerciseId: "e-press", kind: "maxWeight", value: 62.5 },
      { exerciseId: "e-press", kind: "volume", value: 1220 },
    ];
    renderSession();
    await cardAppears("Press banca");
    mark("Press banca", 1);
    open("Terminar");
    fireEvent.click(within(dialog("Terminar entreno")).getByRole("button", { name: "Guardar entreno" }));

    await screen.findByRole("heading", { name: "Entreno terminado" });
    const records = screen.getByRole("region", { name: "Récords nuevos" });
    expect(within(records).getByText("Press banca")).toBeTruthy();
    expect(within(records).getByText("Peso máximo: 62,5 kg")).toBeTruthy();
    expect(within(records).getByText("Volumen: 1.220 kg")).toBeTruthy();
    expect(screen.queryByText("Récords pendientes de sincronizar")).toBeNull();
  });

  it("sin récords nuevos lo dice", async () => {
    renderSession();
    await cardAppears("Press banca");
    mark("Press banca", 1);
    open("Terminar");
    fireEvent.click(within(dialog("Terminar entreno")).getByRole("button", { name: "Guardar entreno" }));

    expect(await screen.findByText("Sin récords nuevos esta vez.")).toBeTruthy();
  });

  it("tras guardar, refresca la instantánea sin conexión", async () => {
    renderSession();
    await cardAppears("Press banca");
    mark("Press banca", 1);
    server.calls = [];
    open("Terminar");

    fireEvent.click(within(dialog("Terminar entreno")).getByRole("button", { name: "Guardar entreno" }));

    await screen.findByRole("heading", { name: "Entreno terminado" });
    await waitFor(() => expect(server.calls.some((call) => call.path === "/api/exercises/e-press/history")).toBe(true));
  });

  it("tocar dos veces Guardar entreno envía un solo PUT", async () => {
    renderSession();
    await cardAppears("Press banca");
    mark("Press banca", 1);
    open("Terminar");
    const save = within(dialog("Terminar entreno")).getByRole("button", { name: "Guardar entreno" });

    fireEvent.click(save);
    fireEvent.click(save);

    await screen.findByRole("heading", { name: "Entreno terminado" });
    expect(calls("PUT")).toHaveLength(1);
  });
});

describe("sin conexión", () => {
  const SNAPSHOT = {
    savedAt: "2026-11-09T10:00:00.000Z",
    routines: [PECHO, ESPALDA, CARDIO],
    exercises: EXERCISES,
    last: { "e-press": [set(60, 10), set(60, 9), set(57.5, 8)] },
  };

  it("empieza una rutina con la instantánea: ejercicios, series y última vez", async () => {
    await saveSnapshot(SNAPSHOT);
    server.offline = true;

    renderSession();

    const press = await cardAppears("Press banca");
    expect(within(press).getByText("Última vez: 60×10 · 60×9 · 57,5×8")).toBeTruthy();
    expect(field("Press banca", "Peso, serie 1").value).toBe("60");
    expect(screen.getByText(/Sin conexión/)).toBeTruthy();
    expect(await cardAppears("Fondos")).toBeTruthy();
    await waitFor(async () => expect((await savedDraft()).routineId).toBe("r-pecho"));
  });

  it("empieza un entreno libre con la instantánea y el selector ofrece sus ejercicios", async () => {
    await saveSnapshot(SNAPSHOT);
    server.offline = true;
    renderSession("/entreno/sesion");
    await screen.findByText("Entreno libre");

    open("Añadir ejercicio");
    fireEvent.click(await within(dialog("Añadir ejercicio")).findByRole("button", { name: /Press banca/ }));

    const press = await cardAppears("Press banca");
    expect(within(press).getByText("Última vez: 60×10 · 60×9 · 57,5×8")).toBeTruthy();
  });

  it("sin instantánea guardada dice claramente que hay que conectarse una vez", async () => {
    server.offline = true;

    renderSession();

    expect(await screen.findByText(/Todavía no hay datos guardados en este móvil/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeTruthy();
    expect(await loadDraft()).toBeNull();
  });

  it("terminar sin conexión guarda el entreno en la cola y dice que los récords están pendientes", async () => {
    await saveSnapshot(SNAPSHOT);
    server.offline = true;
    renderSession();
    await cardAppears("Press banca");
    mark("Press banca", 1);
    open("Terminar");

    fireEvent.click(within(dialog("Terminar entreno")).getByRole("button", { name: "Guardar entreno" }));

    await screen.findByRole("heading", { name: "Entreno terminado" });
    expect(screen.getByText("Récords pendientes de sincronizar")).toBeTruthy();
    expect(screen.getByText(/Se enviará solo cuando vuelva la conexión/)).toBeTruthy();
    expect(await pendingCount()).toBe(1);
    expect(await loadDraft()).toBeNull();
    // El resumen sale igualmente, calculado en el móvil.
    expect(screen.getByRole("region", { name: "Resumen" }).textContent).not.toMatch(/NaN|Infinity/);
  });

  it("al volver la conexión el entreno se envía una sola vez, aunque se reintente varias", async () => {
    await saveSnapshot(SNAPSHOT);
    server.offline = true;
    renderSession();
    await cardAppears("Press banca");
    mark("Press banca", 1);
    open("Terminar");
    fireEvent.click(within(dialog("Terminar entreno")).getByRole("button", { name: "Guardar entreno" }));
    await screen.findByRole("heading", { name: "Entreno terminado" });
    server.offline = false;
    await syncOutbox();
    await syncOutbox();

    expect(calls("PUT")).toHaveLength(1);
    expect(await pendingCount()).toBe(0);
  });

  it("un 401 al terminar conserva el entreno en la cola", async () => {
    server.putStatus = 401;
    renderSession();
    await cardAppears("Press banca");
    mark("Press banca", 1);
    open("Terminar");

    fireEvent.click(within(dialog("Terminar entreno")).getByRole("button", { name: "Guardar entreno" }));

    await screen.findByRole("heading", { name: "Entreno terminado" });
    expect(await pendingCount()).toBe(1);
    expect(screen.getByText("Récords pendientes de sincronizar")).toBeTruthy();
    const puts = calls("PUT");
    expect(await isQueued(puts[0]?.path.split("/").pop() ?? "")).toBe(true);
  });

  it("sin conexión, 'Guardar en la rutina' encola el PUT y después el cambio de rutina, en ese orden", async () => {
    await saveSnapshot(SNAPSHOT);
    server.offline = true;
    renderSession();
    await cardAppears("Press banca");
    menuOf("Press banca");
    fireEvent.click(within(dialog("Press banca")).getByRole("button", { name: "Añadir serie" }));
    fireEvent.click(within(dialog("Press banca")).getByRole("button", { name: "Cerrar" }));
    mark("Press banca", 1);
    open("Terminar");
    fireEvent.click(within(dialog("Terminar entreno")).getByRole("button", { name: "Guardar en la rutina" }));
    await screen.findByRole("heading", { name: "Entreno terminado" });
    expect(await pendingCount()).toBe(2);

    server.offline = false;
    await syncOutbox();

    const writes = server.calls.filter((call) => call.method === "PUT" || call.method === "POST");
    expect(writes.map((call) => call.method)).toEqual(["PUT", "POST"]);
    expect(await pendingCount()).toBe(0);
  });

  it("si no se puede guardar el borrador en el móvil avisa de que se perderá al cerrar", async () => {
    renderSession();
    await cardAppears("Press banca");
    vi.stubGlobal("indexedDB", undefined);

    type("Press banca", "Peso, serie 1", "70");

    expect(await screen.findByText(/No se está guardando el entreno en este móvil/)).toBeTruthy();
  });
});

describe("continuar un borrador", () => {
  it("sin parámetro continúa el borrador guardado, con sus valores y marcas", async () => {
    await saveDraft(draftOf());

    renderSession("/entreno/sesion");

    await cardAppears("Press banca");
    expect(field("Press banca", "Peso, serie 1").value).toBe("61");
    // La serie 1 estaba marcada; la 2, no.
    expect(within(card("Press banca")).getByRole("button", { name: "Desmarcar serie 1" })).toBeTruthy();
    expect(within(card("Press banca")).getByRole("button", { name: "Marcar serie 2 como hecha" })).toBeTruthy();
    expect(within(card("Press banca")).getByText("Última vez: 60×10 · 60×9 · 57,5×8")).toBeTruthy();
    // No es un entreno nuevo: no se ha creado otro borrador.
    expect((await savedDraft()).id).toBe("w-draft");
  });

  it("el borrador sobrevive a recargar la pantalla", async () => {
    const first = renderSession();
    await cardAppears("Press banca");
    type("Press banca", "Peso, serie 1", "70");
    mark("Press banca", 1);
    await waitFor(async () => expect((await savedDraft()).exercises[0]?.sets[0]?.done).toBe(true));
    const id = (await savedDraft()).id;
    first.unmount();

    renderSession("/entreno/sesion");

    await cardAppears("Press banca");
    expect(field("Press banca", "Peso, serie 1").value).toBe("70");
    expect((await savedDraft()).id).toBe(id);
  });

  it("la misma rutina que el borrador: continúa sin preguntar", async () => {
    await saveDraft(draftOf());

    renderSession("/entreno/sesion?rutina=r-pecho");

    await cardAppears("Press banca");
    expect(screen.queryByText("Ya tienes un entreno en curso")).toBeNull();
    expect((await savedDraft()).id).toBe("w-draft");
  });

  it("el cronómetro cuenta desde el inicio del borrador", async () => {
    await saveDraft(draftOf({ startedAt: new Date(Date.now() - (3600 + 125) * 1000).toISOString() }));

    renderSession("/entreno/sesion");
    await cardAppears("Press banca");

    expect(screen.getByRole("timer", { name: "Tiempo de entreno" }).textContent).toMatch(/^1:02:0[5-9]$/);
  });

  describe("otra rutina con un borrador en curso", () => {
    it("pregunta antes de sustituirlo y no toca el borrador mientras tanto", async () => {
      await saveDraft(draftOf());

      renderSession("/entreno/sesion?rutina=r-espalda");

      expect(await screen.findByText("Ya tienes un entreno en curso")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Continuar el entreno en curso" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Empezar Espalda y descartar el anterior" })).toBeTruthy();
      expect((await savedDraft()).id).toBe("w-draft");
    });

    it("Continuar sigue con el borrador y quita la rutina de la dirección", async () => {
      await saveDraft(draftOf());
      renderSession("/entreno/sesion?rutina=r-espalda");

      fireEvent.click(await screen.findByRole("button", { name: "Continuar el entreno en curso" }));

      await cardAppears("Press banca");
      expect(screen.getByTestId("where").textContent).toBe("/entreno/sesion");
      expect((await savedDraft()).id).toBe("w-draft");
    });

    it("Empezar la otra descarta el borrador y empieza la rutina pedida", async () => {
      await saveDraft(draftOf());
      renderSession("/entreno/sesion?rutina=r-espalda");

      fireEvent.click(await screen.findByRole("button", { name: "Empezar Espalda y descartar el anterior" }));

      await cardAppears("Remo con barra");
      expect(screen.queryByRole("region", { name: "Press banca" })).toBeNull();
      await waitFor(async () => {
        const draft = await savedDraft();
        expect(draft.id).not.toBe("w-draft");
        expect(draft.routineId).toBe("r-espalda");
      });
    });

    it("un borrador de entreno libre también se pregunta antes de pisarlo", async () => {
      await saveDraft(draftOf({ routineId: null }));

      renderSession("/entreno/sesion?rutina=r-espalda");

      expect(await screen.findByText("Ya tienes un entreno en curso")).toBeTruthy();
    });
  });
});

describe("descartar", () => {
  it("pide confirmación y, al confirmar, borra el borrador y vuelve a Entreno", async () => {
    renderSession();
    await cardAppears("Press banca");
    await waitFor(async () => expect(await loadDraft()).not.toBeNull());

    open("Más opciones del entreno");
    fireEvent.click(within(dialog("Entreno en curso")).getByRole("button", { name: "Descartar entreno" }));
    expect(within(dialog("¿Descartar este entreno?")).getByText(/Se perderán las series/)).toBeTruthy();
    fireEvent.click(within(dialog("¿Descartar este entreno?")).getByRole("button", { name: "Sí, descartar" }));

    expect(await screen.findByText("PANTALLA ENTRENO")).toBeTruthy();
    expect(await loadDraft()).toBeNull();
    expect(calls("PUT")).toHaveLength(0);
    expect(await pendingCount()).toBe(0);
  });

  it("Cancelar deja el entreno como estaba", async () => {
    renderSession();
    await cardAppears("Press banca");
    await waitFor(async () => expect(await loadDraft()).not.toBeNull());

    open("Más opciones del entreno");
    fireEvent.click(within(dialog("Entreno en curso")).getByRole("button", { name: "Descartar entreno" }));
    fireEvent.click(within(dialog("¿Descartar este entreno?")).getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await loadDraft()).not.toBeNull();
    expect(card("Press banca")).toBeTruthy();
  });

  it("desde el aviso de 'sin series hechas' también se puede descartar", async () => {
    renderSession();
    await cardAppears("Press banca");
    open("Terminar");

    fireEvent.click(within(dialog("Aún no hay series hechas")).getByRole("button", { name: "Descartar entreno" }));
    fireEvent.click(await screen.findByRole("button", { name: "Sí, descartar" }));

    expect(await screen.findByText("PANTALLA ENTRENO")).toBeTruthy();
    expect(await loadDraft()).toBeNull();
  });
});

describe("estado entre sesiones", () => {
  it("con un borrador guardado que ya no existe en la base tras descartar, sin parámetro empieza uno libre", async () => {
    await saveDraft(draftOf());
    await clearDraft();

    renderSession("/entreno/sesion");

    expect(await screen.findByText("Entreno libre")).toBeTruthy();
  });

  it("la pantalla pasa por Cargando antes de enseñar el entreno", async () => {
    renderSession();

    expect(screen.getByText("Cargando entreno…")).toBeTruthy();
    await cardAppears("Press banca");
    await act(async () => {});
  });
});

describe("abrir el borrador aunque no se puedan cargar las rutinas", () => {
  const SNAPSHOT = {
    savedAt: "2026-11-09T10:00:00.000Z",
    routines: [PECHO, ESPALDA, CARDIO],
    exercises: EXERCISES,
    last: { "e-press": [set(60, 10), set(60, 9), set(57.5, 8)] },
  };

  it("con un error del servidor y una copia guardada, abre el borrador con la copia", async () => {
    await saveSnapshot(SNAPSHOT);
    await saveDraft(draftOf());
    server.catalogStatus = 500;

    renderSession("/entreno/sesion");

    await cardAppears("Press banca");
    expect(field("Press banca", "Peso, serie 1").value).toBe("61");
    expect(within(card("Press banca")).getByText("Última vez: 60×10 · 60×9 · 57,5×8")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(/Sin conexión con el servidor/);
  });

  it("con un error del servidor y sin copia, abre el borrador con nombres genéricos y lo avisa", async () => {
    await saveDraft(draftOf());
    server.catalogStatus = 500;

    renderSession("/entreno/sesion");

    await cardAppears("Ejercicio 1");
    expect(card("Ejercicio 2")).toBeTruthy();
    expect(field("Ejercicio 1", "Peso, serie 1").value).toBe("61");
    expect(screen.getByText(/No se han podido cargar los nombres de los ejercicios/)).toBeTruthy();
    expect(screen.queryByText(/Todavía no hay datos guardados/)).toBeNull();

    // Se puede seguir entrenando: lo que se marca se guarda en el borrador.
    mark("Ejercicio 2", 1);
    await waitFor(async () => expect((await savedDraft()).exercises[1]?.sets[0]?.done).toBe(true));
  });

  it("sin red y sin copia también abre el borrador, en vez de decir que no hay datos", async () => {
    await saveDraft(draftOf());
    server.offline = true;

    renderSession("/entreno/sesion");

    await cardAppears("Ejercicio 1");
    expect(screen.queryByText(/Todavía no hay datos guardados/)).toBeNull();
  });

  it("un borrador de cardio sin catálogo sigue enseñando minutos y distancia", async () => {
    await saveDraft(
      draftOf({
        routineId: "r-cardio",
        exercises: [{ exerciseId: "e-correr", restSeconds: 0, sets: [{ ...set(null, null, { durationMin: 30, distanceKm: 5 }), done: false }] }],
      }),
    );
    server.catalogStatus = 500;

    renderSession("/entreno/sesion");

    await cardAppears("Ejercicio 1");
    expect(field("Ejercicio 1", "Minutos, serie 1").value).toBe("30");
    expect(field("Ejercicio 1", "Distancia (km), serie 1").value).toBe("5");
  });

  it("sin borrador, un error del servidor sigue siendo un error con Reintentar", async () => {
    await saveSnapshot(SNAPSHOT);
    server.catalogStatus = 500;

    renderSession();

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeTruthy();
  });

  it("si se pide otra rutina y no se pueden cargar las rutinas, solo ofrece continuar", async () => {
    await saveDraft(draftOf());
    server.catalogStatus = 500;

    renderSession("/entreno/sesion?rutina=r-espalda");

    expect(await screen.findByText("Ya tienes un entreno en curso")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continuar el entreno en curso" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Empezar / })).toBeNull();
    expect((await savedDraft()).id).toBe("w-draft");
  });
});

describe("un borrador olvidado de la misma rutina", () => {
  const stale = () => draftOf({ startedAt: new Date(Date.now() - 13 * HOUR).toISOString() });

  it("pregunta antes de mezclarlo con el entreno de hoy, y no lo toca mientras tanto", async () => {
    await saveDraft(stale());

    renderSession("/entreno/sesion?rutina=r-pecho");

    expect(await screen.findByText("Tienes un entreno sin terminar")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continuar" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Empezar de nuevo" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Press banca" })).toBeNull();
    expect((await savedDraft()).id).toBe("w-draft");
  });

  it("Continuar sigue con el borrador viejo y quita la rutina de la dirección", async () => {
    await saveDraft(stale());
    renderSession("/entreno/sesion?rutina=r-pecho");

    fireEvent.click(await screen.findByRole("button", { name: "Continuar" }));

    await cardAppears("Press banca");
    expect(screen.getByTestId("where").textContent).toBe("/entreno/sesion");
    expect((await savedDraft()).id).toBe("w-draft");
  });

  it("Empezar de nuevo descarta el viejo y empieza uno con la hora de ahora", async () => {
    await saveDraft(stale());
    renderSession("/entreno/sesion?rutina=r-pecho");

    fireEvent.click(await screen.findByRole("button", { name: "Empezar de nuevo" }));

    await cardAppears("Press banca");
    await waitFor(async () => {
      const draft = await savedDraft();
      expect(draft.id).not.toBe("w-draft");
      expect(draft.routineId).toBe("r-pecho");
      expect(Date.now() - Date.parse(draft.startedAt)).toBeLessThan(60_000);
    });
    // Las series del borrador viejo no pasan al nuevo: salen prerrellenadas con la última vez.
    expect(field("Press banca", "Peso, serie 1").value).toBe("60");
  });

  it("con menos de 12 horas lo continúa sin preguntar", async () => {
    await saveDraft(draftOf({ startedAt: new Date(Date.now() - 11 * HOUR).toISOString() }));

    renderSession("/entreno/sesion?rutina=r-pecho");

    await cardAppears("Press banca");
    expect(screen.queryByText("Tienes un entreno sin terminar")).toBeNull();
  });

  it("el aviso de Hoy (sin rutina en la dirección) continúa aunque sea viejo, sin preguntar", async () => {
    await saveDraft(stale());

    renderSession("/entreno/sesion");

    await cardAppears("Press banca");
    expect(screen.queryByText("Tienes un entreno sin terminar")).toBeNull();
    expect((await savedDraft()).id).toBe("w-draft");
  });

  it("un borrador viejo de entreno libre y una rutina pedida sigue preguntando lo de siempre", async () => {
    await saveDraft(draftOf({ routineId: null, startedAt: new Date(Date.now() - 30 * HOUR).toISOString() }));

    renderSession("/entreno/sesion?rutina=r-pecho");

    expect(await screen.findByText("Ya tienes un entreno en curso")).toBeTruthy();
  });
});

describe("un entreno que el servidor rechaza", () => {
  it("no desaparece: el resumen dice que no se ha guardado y que sigue en el móvil", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    server.putStatus = 400;
    renderSession();
    await cardAppears("Press banca");
    mark("Press banca", 1);
    open("Terminar");

    fireEvent.click(within(dialog("Terminar entreno")).getByRole("button", { name: "Guardar entreno" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("No se ha podido guardar este entreno; sigue guardado en este móvil.");
    expect(screen.queryByRole("heading", { name: "Entreno terminado" })).toBeNull();
    expect(screen.queryByText("Récords pendientes de sincronizar")).toBeNull();
    expect(screen.queryByText(/Se enviará solo cuando vuelva la conexión/)).toBeNull();
    // El entreno no se ha perdido: está aparte, con su respuesta, esperando que se reintente.
    expect(await pendingCount()).toBe(0);
    expect(await rejectedCount()).toBe(1);
    const [rejected] = await listRejected();
    expect(rejected?.status).toBe(400);
    expect(rejected?.item).toMatchObject({ kind: "workout", workout: { source: "live", routineId: "r-pecho" } });
    expect(await loadDraft()).toBeNull();
    warn.mockRestore();
  });

  it("aun así enseña los números del entreno, calculados en el móvil", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    server.putStatus = 422;
    renderSession();
    await cardAppears("Press banca");
    mark("Press banca", 1);
    open("Terminar");
    fireEvent.click(within(dialog("Terminar entreno")).getByRole("button", { name: "Guardar entreno" }));

    await screen.findByRole("alert");
    expect(within(screen.getByRole("region", { name: "Resumen" })).getByText("600 kg")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Listo" })).toBeTruthy();
    warn.mockRestore();
  });
});
