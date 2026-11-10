import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Theme } from "../../src/shared/types";

type ThemeModule = typeof import("../../src/web/theme");

// matchMedia falso: `dark` decide el modo y `fire()` simula que el sistema cambia de modo.
function stubColorScheme(initialDark: boolean) {
  const listeners: Array<() => void> = [];
  const mql = {
    matches: initialDark,
    addEventListener: (_type: string, listener: () => void) => listeners.push(listener),
  };
  vi.stubGlobal("matchMedia", (query: string) => {
    expect(query).toBe("(prefers-color-scheme: dark)");
    return mql;
  });
  return {
    fire(nowDark: boolean) {
      mql.matches = nowDark;
      for (const listener of listeners) listener();
    },
  };
}

function cssVar(name: string): string {
  return document.documentElement.style.getPropertyValue(name);
}

function themeColor(): string | null {
  return document.head.querySelector('meta[name="theme-color"]')?.getAttribute("content") ?? null;
}

function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => {
    const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi = 0, lo = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

let theme: ThemeModule;

beforeEach(async () => {
  vi.resetModules();
  document.documentElement.removeAttribute("style");
  document.head.innerHTML = "";
  localStorage.clear();
  theme = await import("../../src/web/theme");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("applyTheme", () => {
  it("define los 8 colores de la spec §5.7", () => {
    expect(Object.keys(theme.THEMES).sort()).toEqual(
      ["blue", "graphite", "green", "orange", "pink", "purple", "red", "teal"].sort(),
    );
  });

  it("pone el color de acento y el del texto sobre él como variables CSS", () => {
    stubColorScheme(false);
    theme.applyTheme("blue");
    expect(cssVar("--accent")).toBe(theme.THEMES.blue.light.accent);
    expect(cssVar("--on-accent")).toBe(theme.THEMES.blue.light.onAccent);
  });

  it("usa la variante oscura cuando el sistema está en modo oscuro", () => {
    stubColorScheme(true);
    theme.applyTheme("blue");
    expect(cssVar("--accent")).toBe(theme.THEMES.blue.dark.accent);
    expect(cssVar("--on-accent")).toBe(theme.THEMES.blue.dark.onAccent);
  });

  it("cambia de variante cuando el sistema cambia de modo", () => {
    const scheme = stubColorScheme(false);
    theme.applyTheme("purple");
    scheme.fire(true);
    expect(cssVar("--accent")).toBe(theme.THEMES.purple.dark.accent);
    scheme.fire(false);
    expect(cssVar("--accent")).toBe(theme.THEMES.purple.light.accent);
  });

  it("solo se suscribe una vez al modo del sistema", () => {
    const addEventListener = vi.fn();
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener }));
    theme.applyTheme("red");
    theme.applyTheme("teal");
    expect(addEventListener).toHaveBeenCalledTimes(1);
  });

  it("actualiza la meta theme-color, y la crea si no existe", () => {
    stubColorScheme(false);
    theme.applyTheme("orange");
    expect(themeColor()).toBe(theme.THEMES.orange.light.accent);
    expect(document.head.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1);

    theme.applyTheme("pink");
    expect(themeColor()).toBe(theme.THEMES.pink.light.accent);
    expect(document.head.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1);
  });

  it("un tema desconocido cae al verde", () => {
    stubColorScheme(false);
    theme.applyTheme("fucsia");
    expect(cssVar("--accent")).toBe(theme.THEMES.green.light.accent);
  });

  it("sin matchMedia usa el modo claro", () => {
    vi.stubGlobal("matchMedia", undefined);
    theme.applyTheme("teal");
    expect(cssVar("--accent")).toBe(theme.THEMES.teal.light.accent);
  });

  it("recuerda el tema para pintar bien el siguiente arranque", () => {
    stubColorScheme(false);
    expect(theme.cachedTheme()).toBe("green");
    theme.applyTheme("graphite");
    expect(theme.cachedTheme()).toBe("graphite");
  });

  it("ignora un valor guardado que ya no es un tema", () => {
    localStorage.setItem("gymvik.theme", "fucsia");
    expect(theme.cachedTheme()).toBe("green");
  });

  it("sigue funcionando si el almacenamiento está bloqueado", () => {
    stubColorScheme(false);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("bloqueado", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("bloqueado", "SecurityError");
    });
    expect(() => theme.applyTheme("red")).not.toThrow();
    expect(theme.cachedTheme()).toBe("green");
    vi.restoreAllMocks();
  });

  // Fondos de la app (src/web/styles.css): claro #f5f5f2 / #ffffff, oscuro #0d0f12 / #171a1f.
  describe.each<Theme>(["green", "blue", "purple", "red", "orange", "pink", "teal", "graphite"])("contraste de %s", (id) => {
    it("el texto sobre el acento y el acento sobre el fondo llegan a 4,5:1 en claro", () => {
      const { accent, onAccent } = theme.THEMES[id].light;
      expect(contrast(accent, onAccent)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(accent, "#f5f5f2")).toBeGreaterThanOrEqual(4.5);
    });

    it("el texto sobre el acento y el acento sobre el fondo llegan a 4,5:1 en oscuro", () => {
      const { accent, onAccent } = theme.THEMES[id].dark;
      expect(contrast(accent, onAccent)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(accent, "#171a1f")).toBeGreaterThanOrEqual(4.5);
    });
  });
});
