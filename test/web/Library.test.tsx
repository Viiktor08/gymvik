import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Category, Exercise } from "../../src/shared/types";
import { Library } from "../../src/web/screens/Library";


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

// Sin ordenar a propósito. "Nube" va antes que "Ñu" en español (la ñ es una letra aparte, detrás de la n).
const EXERCISES: Exercise[] = [
  exercise("e-press", "Press banca", { muscle: "Pecho" }),
  exercise("e-nu", "Ñu"),
  exercise("e-correr", "Correr", { category: "cardio", muscle: "Piernas" }),
  exercise("e-nube", "Nube"),
  exercise("e-plancha", "Plancha", { category: "core", muscle: "Abdomen" }),
  exercise("e-viejo", "Ejercicio viejo", { archived: true }),
];

type Call = { method: string; path: string; body: unknown };

const server = {
  exercises: EXERCISES,
  listFail: null as "offline" | 500 | null,
  createStatus: 201,
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

  if (path === "/api/exercises" && method === "GET") {
    if (server.listFail === "offline") throw new TypeError("Failed to fetch");
    if (server.listFail === 500) return json(500, { error: "Error interno" });
    return json(
      200,
      server.exercises.filter((e) => !e.archived),
    );
  }
  if (path === "/api/exercises" && method === "POST") {
    if (server.createStatus !== 201) return json(server.createStatus, { error: "Fallo simulado" });
    return json(201, { id: "e-nuevo", isCustom: true, archived: false, ...(body as object) });
  }
  return json(404, { error: "No encontrado" });
}

function renderLibrary() {
  return render(
    <MemoryRouter initialEntries={["/entreno/biblioteca"]}>
      <Routes>
        <Route path="/entreno/biblioteca" element={<Library />} />
        <Route path="/entreno" element={<p>Pantalla Entreno</p>} />
        <Route path="/ejercicio/:id" element={<p>Ficha de prueba</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function renderLoaded() {
  const view = renderLibrary();
  await screen.findByRole("searchbox", { name: "Buscar ejercicio" });
  return view;
}

/** Los nombres de la lista, en el orden en que salen (sin el músculo ni la categoría). */
function listed(): string[] {
  return screen
    .queryAllByRole("button")
    .filter((button) => button.classList.contains("list-row"))
    .map((button) => button.querySelector(".list-row-main")?.textContent ?? "");
}

function callsTo(method: string, path: string): Call[] {
  return server.calls.filter((call) => call.method === method && call.path === path);
}

beforeEach(() => {
  server.exercises = EXERCISES;
  server.listFail = null;
  server.createStatus = 201;
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

describe("Biblioteca: lista y filtros", () => {
  it("ordena por nombre con las reglas del español y no ofrece los archivados", async () => {
    await renderLoaded();
    expect(listed()).toEqual(["Correr", "Nube", "Ñu", "Plancha", "Press banca"]);
  });

  it("busca sin importar mayúsculas ni tildes, también por músculo", async () => {
    await renderLoaded();
    const search = screen.getByRole("searchbox", { name: "Buscar ejercicio" });
    fireEvent.change(search, { target: { value: "ÑU" } });
    expect(listed()).toEqual(["Ñu"]);
    fireEvent.change(search, { target: { value: "abdómen" } });
    expect(listed()).toEqual(["Plancha"]);
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(listed()).toEqual([]);
    expect(screen.getByText("Ningún ejercicio coincide con la búsqueda.")).toBeTruthy();
  });

  it("filtra por categoría y se combina con la búsqueda", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Cardio" }));
    expect(listed()).toEqual(["Correr"]);
    expect(screen.getByRole("button", { name: "Cardio" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar ejercicio" }), { target: { value: "press" } });
    expect(listed()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Todos" }));
    expect(listed()).toEqual(["Press banca"]);
  });

  it("tocar un ejercicio abre su ficha", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: /^Press banca/ }));
    expect(await screen.findByText("Ficha de prueba")).toBeTruthy();
  });

  it("una biblioteca vacía lo dice", async () => {
    server.exercises = [];
    await renderLoaded();
    expect(screen.getByText("Todavía no hay ejercicios en la biblioteca.")).toBeTruthy();
  });

  it("un error de carga sale con Reintentar, y reintentar recupera la lista", async () => {
    server.listFail = 500;
    renderLibrary();
    expect((await screen.findByRole("alert")).textContent).toBe("Error interno");
    server.listFail = null;
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await screen.findByRole("searchbox", { name: "Buscar ejercicio" });
    expect(listed()).toHaveLength(5);
  });

  it("sin conexión sale Sin conexión con Reintentar", async () => {
    server.listFail = "offline";
    renderLibrary();
    expect(await screen.findByText("Sin conexión")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeTruthy();
  });

  it("vuelve a Entreno", async () => {
    await renderLoaded();
    expect(screen.getByRole("link", { name: "Entreno" }).getAttribute("href")).toBe("/entreno");
  });
});

describe("Biblioteca: crear ejercicio", () => {
  async function openForm() {
    await renderLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Nuevo ejercicio" }));
    return screen.findByRole("dialog", { name: "Nuevo ejercicio" });
  }

  it("crea el ejercicio con POST y abre su ficha", async () => {
    const dialog = await openForm();
    fireEvent.change(within(dialog).getByLabelText("Nombre"), { target: { value: "  Remo con barra  " } });
    fireEvent.change(within(dialog).getByLabelText("Categoría"), { target: { value: "strength" } });
    fireEvent.change(within(dialog).getByLabelText("Músculo (opcional)"), { target: { value: "Espalda" } });
    fireEvent.change(within(dialog).getByLabelText("Descripción (opcional)"), { target: { value: "Tira hacia el ombligo." } });
    fireEvent.change(within(dialog).getByLabelText("Enlace de imagen o vídeo (opcional)"), {
      target: { value: " https://example.com/remo.jpg " },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar" }));

    expect(await screen.findByText("Ficha de prueba")).toBeTruthy();
    expect(callsTo("POST", "/api/exercises").map((call) => call.body)).toEqual([
      {
        name: "Remo con barra",
        category: "strength",
        muscle: "Espalda",
        description: "Tira hacia el ombligo.",
        mediaUrl: "https://example.com/remo.jpg",
      },
    ]);
  });

  it("los campos opcionales vacíos se envían vacíos y el enlace como null", async () => {
    const dialog = await openForm();
    fireEvent.change(within(dialog).getByLabelText("Nombre"), { target: { value: "Saltos" } });
    fireEvent.change(within(dialog).getByLabelText("Categoría"), { target: { value: "power" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar" }));
    await screen.findByText("Ficha de prueba");
    expect(callsTo("POST", "/api/exercises")[0]?.body).toEqual({
      name: "Saltos",
      category: "power",
      muscle: "",
      description: "",
      mediaUrl: null,
    });
  });

  it("sin nombre no envía nada", async () => {
    const dialog = await openForm();
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar" }));
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(/nombre/i);
    expect(callsTo("POST", "/api/exercises")).toHaveLength(0);
    expect(snapshot.refresh).not.toHaveBeenCalled();
  });

  it("al crear un ejercicio refresca la copia sin conexión, y sin bloquear la ficha", async () => {
    snapshot.refresh.mockReturnValue(new Promise(() => undefined));
    const dialog = await openForm();
    fireEvent.change(within(dialog).getByLabelText("Nombre"), { target: { value: "Saltos" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar" }));

    expect(await screen.findByText("Ficha de prueba")).toBeTruthy();
    expect(snapshot.refresh).toHaveBeenCalledTimes(1);
  });

  it("si el servidor rechaza el ejercicio no se refresca la copia", async () => {
    const dialog = await openForm();
    fireEvent.change(within(dialog).getByLabelText("Nombre"), { target: { value: "Saltos" } });
    server.createStatus = 400;
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar" }));
    await within(dialog).findByRole("alert");

    expect(snapshot.refresh).not.toHaveBeenCalled();
  });

  it("un enlace que no es https no se envía", async () => {
    const dialog = await openForm();
    fireEvent.change(within(dialog).getByLabelText("Nombre"), { target: { value: "Saltos" } });
    fireEvent.change(within(dialog).getByLabelText("Enlace de imagen o vídeo (opcional)"), {
      target: { value: "http://example.com/a.jpg" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar" }));
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(/https/);
    expect(callsTo("POST", "/api/exercises")).toHaveLength(0);
  });

  it("si el servidor lo rechaza, enseña su mensaje y deja la hoja abierta con lo escrito", async () => {
    const dialog = await openForm();
    fireEvent.change(within(dialog).getByLabelText("Nombre"), { target: { value: "Saltos" } });
    server.createStatus = 400;
    fireEvent.click(within(dialog).getByRole("button", { name: "Guardar" }));
    expect((await within(dialog).findByRole("alert")).textContent).toBe("Fallo simulado");
    expect((within(dialog).getByLabelText("Nombre") as HTMLInputElement).value).toBe("Saltos");
    expect(screen.queryByText("Ficha de prueba")).toBeNull();
  });

  it("cerrar la hoja sin guardar descarta lo escrito", async () => {
    const dialog = await openForm();
    fireEvent.change(within(dialog).getByLabelText("Nombre"), { target: { value: "A medias" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cerrar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Nuevo ejercicio" }));
    const again = await screen.findByRole("dialog", { name: "Nuevo ejercicio" });
    expect((within(again).getByLabelText("Nombre") as HTMLInputElement).value).toBe("");
  });
});
