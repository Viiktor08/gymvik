import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/web/App";

const sync = vi.hoisted(() => ({ stop: vi.fn(), startBackgroundSync: vi.fn() }));

vi.mock("../../src/web/session/sync", () => ({ startBackgroundSync: sync.startBackgroundSync }));

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  sync.stop.mockReset();
  sync.startBackgroundSync.mockReset();
  sync.startBackgroundSync.mockReturnValue(sync.stop);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input) => {
    const path = String(input);
    if (path === "/api/auth/me") return json(200, { authenticated: true, setupRequired: false });
    if (path === "/api/settings") return json(200, { theme: "blue" });
    return json(404, { error: "No encontrado" });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Marco de la app: envío en segundo plano", () => {
  it("con sesión arranca el envío de lo pendiente una sola vez, y lo para al salir", async () => {
    const view = render(
      <MemoryRouter initialEntries={["/entreno/historial"]}>
        <App />
      </MemoryRouter>,
    );
    await screen.findByRole("navigation", { name: "Principal" });
    // El envío se arranca en un efecto de React, que corre después de que el DOM ya muestra la barra.
    await waitFor(() => expect(sync.startBackgroundSync).toHaveBeenCalled());

    expect(sync.startBackgroundSync).toHaveBeenCalledTimes(1);
    expect(sync.stop).not.toHaveBeenCalled();

    view.unmount();
    expect(sync.stop).toHaveBeenCalledTimes(1);
  });

  it("sin sesión (pantalla de acceso) no envía nada", async () => {
    fetchMock.mockImplementation(async (input) =>
      String(input) === "/api/auth/me" ? json(200, { authenticated: false, setupRequired: false }) : json(404, {}),
    );

    render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );
    await screen.findByRole("button", { name: "Entrar con passkey" });

    expect(sync.startBackgroundSync).not.toHaveBeenCalled();
  });
});
