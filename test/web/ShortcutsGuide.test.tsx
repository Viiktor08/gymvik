import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShortcutsGuide } from "../../src/web/screens/ShortcutsGuide";

const ORIGIN = "https://gymvik.example.test";

const server = {
  shortcutName: "Gymvik Pasos" as string | null,
  settingsFails: false,
  calls: [] as string[],
};

const fetchMock = vi.fn<typeof fetch>();
const writeText = vi.fn<(text: string) => Promise<void>>();

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function handle(input: RequestInfo | URL): Promise<Response> {
  const path = String(input);
  server.calls.push(path);
  if (path === "/api/settings") {
    if (server.settingsFails) return json(500, { error: "Error del servidor" });
    return json(200, { shortcutName: server.shortcutName });
  }
  return json(404, { error: "No encontrado" });
}

function text(element: HTMLElement): string {
  return element.textContent ?? "";
}

async function renderGuide() {
  const view = render(
    <MemoryRouter initialEntries={["/ajustes/atajos"]}>
      <Routes>
        <Route path="/ajustes" element={<p>Pantalla Ajustes</p>} />
        <Route path="/ajustes/atajos" element={<ShortcutsGuide />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { name: "Atajos y NFC" });
  return view;
}

function region(name: string): HTMLElement {
  return screen.getByRole("region", { name });
}

function steps(section: HTMLElement): string[] {
  return within(section)
    .getAllByRole("listitem")
    .map((item) => text(item));
}

beforeEach(() => {
  server.shortcutName = "Gymvik Pasos";
  server.settingsFails = false;
  server.calls = [];
  fetchMock.mockReset();
  fetchMock.mockImplementation(handle);
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("location", { pathname: "/ajustes/atajos", origin: ORIGIN, assign: vi.fn() });
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("Guía de atajos", () => {
  it("enlaza con Ajustes y explica qué se necesita antes de empezar", async () => {
    await renderGuide();
    // El primer enlace es el de volver; el de la lista de pasos también lleva a Ajustes.
    const links = screen.getAllByRole("link", { name: /Ajustes/ });
    expect(links[0]?.textContent).toBe("Ajustes");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/ajustes", "/ajustes"]);
    const before = region("Antes de empezar");
    expect(text(before)).toContain("clave");
    expect(text(before)).toContain("una sola vez");
  });

  it("el Atajo Creatina: POST con la clave, notificación con el mensaje y automatización NFC inmediata", async () => {
    await renderGuide();
    const creatine = region("Atajo Creatina");
    const list = steps(creatine).join("\n");

    expect(list).toContain("Obtener contenido de URL");
    expect(list).toContain(`${ORIGIN}/api/hook/creatine`);
    expect(list).toContain("POST");
    expect(list).toContain("Authorization");
    expect(list).toContain("Bearer");
    expect(list).toContain("Obtener valor del diccionario");
    expect(list).toContain("message");
    expect(list).toContain("Mostrar notificación");
    expect(list).toContain("NFC");
    expect(list).toContain("Ejecutar inmediatamente");
    // La clave no se puede mostrar (solo se ve al crearla): la guía usa un hueco.
    expect(list).toContain("<clave>");
  });

  it("el Atajo Pasos: pasos de hoy sumados, enviados como Número y con automatizaciones a varias horas", async () => {
    await renderGuide();
    const stepsGuide = region("Atajo Pasos");
    const list = steps(stepsGuide).join("\n");

    expect(list).toContain("Buscar muestras de salud");
    expect(list).toContain("Pasos");
    expect(list).toContain("hoy");
    expect(list).toContain("Suma");
    expect(list).toContain(`${ORIGIN}/api/hook/steps`);
    expect(list).toContain("POST");
    expect(list).toContain("Authorization");
    expect(list).toContain("Mostrar notificación");
    expect(list).toContain("Hora del día");
    expect(list).toContain("Ejecutar inmediatamente");

    // El aviso que evita el 400: `steps` va como Número, no como Texto.
    const warning = within(stepsGuide).getByRole("note");
    expect(text(warning)).toContain("Número");
    expect(text(warning)).toContain("Texto");
    expect(text(warning)).toContain("400");
    expect(text(stepsGuide)).toContain('{ "steps": 8432 }');
  });

  it("usa el nombre del Atajo de Salud guardado en Ajustes", async () => {
    server.shortcutName = "Mis pasos de Salud";
    await renderGuide();
    await waitFor(() => expect(text(region("Atajo Pasos"))).toContain("Mis pasos de Salud"));
    expect(text(region("Atajo Pasos"))).not.toContain("Gymvik Pasos");
  });

  it("antes de saber el nombre guardado, y si los ajustes no cargan, propone el de por defecto", async () => {
    await renderGuide();
    expect(text(region("Atajo Pasos"))).toContain("Gymvik Pasos");

    server.settingsFails = true;
    server.calls = [];
    const second = render(
      <MemoryRouter>
        <ShortcutsGuide />
      </MemoryRouter>,
    );
    await waitFor(() => expect(server.calls).toContain("/api/settings"));
    expect(text(within(second.container).getByRole("region", { name: "Atajo Pasos" }))).toContain("Gymvik Pasos");
  });

  it("copia cada URL con su botón", async () => {
    await renderGuide();
    fireEvent.click(within(region("Atajo Creatina")).getByRole("button", { name: "Copiar URL de creatina" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${ORIGIN}/api/hook/creatine`));

    fireEvent.click(within(region("Atajo Pasos")).getByRole("button", { name: "Copiar URL de pasos" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${ORIGIN}/api/hook/steps`));
  });

  it("si no se puede copiar lo dice, para copiarlo a mano", async () => {
    writeText.mockRejectedValue(new Error("sin permiso"));
    await renderGuide();
    const creatine = region("Atajo Creatina");
    fireEvent.click(within(creatine).getByRole("button", { name: "Copiar URL de creatina" }));
    expect(await within(creatine).findByRole("alert")).toBeTruthy();
    expect(text(creatine)).toContain(`${ORIGIN}/api/hook/creatine`);
  });

  it("explica qué significan los errores más habituales", async () => {
    await renderGuide();
    const help = region("Si algo falla");
    const content = text(help);
    expect(content).toContain("401");
    expect(content).toContain("403");
    expect(content).toContain("400");
    expect(content).toContain("429");
  });
});
