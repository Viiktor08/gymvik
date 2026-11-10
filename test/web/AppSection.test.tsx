import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appVersion } from "../../src/web/appVersion";
import { checkForUpdate } from "../../src/web/pwa";
import { AppSection } from "../../src/web/settings/AppSection";

vi.mock("../../src/web/pwa", () => ({ checkForUpdate: vi.fn() }));

const check = vi.mocked(checkForUpdate);

/** Una comprobación que se resuelve (o falla) cuando el test lo decide. */
function pending() {
  let finish!: (outcome: Awaited<ReturnType<typeof checkForUpdate>>) => void;
  let fail!: (failure: unknown) => void;
  const promise = new Promise<Awaited<ReturnType<typeof checkForUpdate>>>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  return { promise, finish, fail };
}

beforeEach(() => {
  check.mockReset();
});

describe("Ajustes: aplicación", () => {
  it("enseña la versión instalada y el botón Actualizar", () => {
    render(<AppSection />);
    expect(screen.getByRole("heading", { name: "Aplicación" })).toBeTruthy();
    expect(screen.getByText(appVersion)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Actualizar" })).toBeTruthy();
    expect(check).not.toHaveBeenCalled();
  });

  it("mientras busca deshabilita el botón y no lanza una segunda comprobación", async () => {
    const { promise, finish } = pending();
    check.mockReturnValueOnce(promise);
    render(<AppSection />);

    fireEvent.click(screen.getByRole("button", { name: "Actualizar" }));
    const busy = await screen.findByRole("button", { name: "Buscando…" });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(busy);
    expect(check).toHaveBeenCalledOnce();

    finish("current");
    await screen.findByRole("button", { name: "Actualizar" });
  });

  it("sin versión nueva dice que ya tiene la última y deja volver a comprobar", async () => {
    check.mockResolvedValueOnce("current");
    render(<AppSection />);
    fireEvent.click(screen.getByRole("button", { name: "Actualizar" }));

    expect((await screen.findByRole("status")).textContent).toBe("Ya tienes la última versión.");
    const button = screen.getByRole("button", { name: "Actualizar" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it("con una versión nueva avisa de que recarga y no permite pulsar otra vez", async () => {
    check.mockResolvedValueOnce("reloading");
    render(<AppSection />);
    fireEvent.click(screen.getByRole("button", { name: "Actualizar" }));

    expect((await screen.findByRole("status")).textContent).toBe("Hay una versión nueva. Recargando…");
    expect((screen.getByRole("button", { name: "Actualizar" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("si todavía no hay service worker lo explica", async () => {
    check.mockResolvedValueOnce("unavailable");
    render(<AppSection />);
    fireEvent.click(screen.getByRole("button", { name: "Actualizar" }));

    expect((await screen.findByRole("status")).textContent).toBe(
      "Todavía no se puede comprobar. Cierra la app, ábrela de nuevo e inténtalo otra vez.",
    );
  });

  it("si la comprobación falla (sin conexión) lo avisa sin enseñar detalles técnicos y permite reintentar", async () => {
    check.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<AppSection />);
    fireEvent.click(screen.getByRole("button", { name: "Actualizar" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("No se pudo comprobar si hay una versión nueva. Revisa la conexión e inténtalo de nuevo.");
    expect(alert.textContent).not.toContain("Failed to fetch");

    check.mockResolvedValueOnce("current");
    fireEvent.click(screen.getByRole("button", { name: "Actualizar" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect((await screen.findByRole("status")).textContent).toBe("Ya tienes la última versión.");
  });
});
