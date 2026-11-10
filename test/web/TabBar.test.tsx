import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { TabBar } from "../../src/web/components/TabBar";

function activeTabs(path: string): string[] {
  render(
    <MemoryRouter initialEntries={[path]}>
      <TabBar />
    </MemoryRouter>,
  );
  return screen
    .getAllByRole("link")
    .filter((link) => link.getAttribute("aria-current") === "page")
    .map((link) => link.textContent ?? "");
}

describe("TabBar", () => {
  it("tiene Hoy, Entreno y Progreso en ese orden", () => {
    activeTabs("/");
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["Hoy", "Entreno", "Progreso"]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/", "/entreno", "/progreso"]);
  });

  it.each([
    ["/", "Hoy"],
    ["/entreno", "Entreno"],
    ["/entreno/rutina/abc", "Entreno"],
    ["/entreno/sesion", "Entreno"],
    ["/entreno/biblioteca", "Entreno"],
    ["/ejercicio/abc", "Entreno"],
    ["/progreso", "Progreso"],
  ])("en %s marca %s", (path, tab) => {
    expect(activeTabs(path)).toEqual([tab]);
  });

  it("en Ajustes no marca ninguna pestaña", () => {
    expect(activeTabs("/ajustes")).toEqual([]);
  });

  it("no confunde rutas que solo empiezan igual", () => {
    expect(activeTabs("/entrenos-raros")).toEqual([]);
  });
});
