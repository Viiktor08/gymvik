import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Sheet } from "../../src/web/components/Sheet";

function Harness({ onClose = () => undefined }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Abrir</button>
      <Sheet
        open={open}
        title="Apuntar peso"
        onClose={() => {
          onClose();
          setOpen(false);
        }}
      >
        <input aria-label="Peso" />
        <button>Guardar</button>
      </Sheet>
    </>
  );
}

describe("Sheet", () => {
  it("cerrada no pinta nada", () => {
    render(
      <Sheet open={false} title="Apuntar peso" onClose={() => undefined}>
        <p>Contenido</p>
      </Sheet>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("Contenido")).toBeNull();
  });

  it("abierta es un diálogo modal con el título como nombre", () => {
    render(
      <Sheet open title="Apuntar peso" onClose={() => undefined}>
        <p>Contenido</p>
      </Sheet>,
    );
    const dialog = screen.getByRole("dialog", { name: "Apuntar peso" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByText("Contenido")).toBeTruthy();
  });

  it("se cierra con Escape, con el botón y tocando fuera, pero no tocando dentro", () => {
    const onClose = vi.fn();
    render(
      <Sheet open title="Apuntar peso" onClose={onClose}>
        <p>Contenido</p>
      </Sheet>,
    );
    fireEvent.click(screen.getByText("Contenido"));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("dialog").parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("lleva el foco al diálogo y lo devuelve al botón que lo abrió", () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Abrir" });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("mantiene el foco dentro con Tab y Mayús+Tab", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir" }));
    const close = screen.getByRole("button", { name: "Cerrar" });
    const save = screen.getByRole("button", { name: "Guardar" });

    save.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(close);

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(save);
  });

  it("bloquea el desplazamiento de la página mientras está abierta", () => {
    render(<Harness />);
    expect(document.body.classList.contains("sheet-open")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Abrir" }));
    expect(document.body.classList.contains("sheet-open")).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.body.classList.contains("sheet-open")).toBe(false);
  });

  it("no roba el foco cuando el padre se vuelve a pintar", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir" }));
    const field = screen.getByLabelText("Peso");
    field.focus();
    fireEvent.change(field, { target: { value: "70" } });
    expect(document.activeElement).toBe(field);
  });
});
