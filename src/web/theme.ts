import type { Theme } from "../shared/types";

type Palette = {
  /** Color de relleno y de enlaces. */
  accent: string;
  /** Color del texto o los iconos sobre el acento. */
  onAccent: string;
};

type ThemeColors = {
  label: string;
  light: Palette;
  dark: Palette;
};

// Los 8 colores del tema. Cada variante llega a 4,5:1 tanto entre el
// acento y su texto como entre el acento y el fondo de styles.css (lo comprueba
// test/web/theme.test.ts).
export const THEMES: Record<Theme, ThemeColors> = {
  green: {
    label: "Verde",
    light: { accent: "#1b7a4b", onAccent: "#ffffff" },
    dark: { accent: "#4cc58b", onAccent: "#0b0d10" },
  },
  blue: {
    label: "Azul",
    light: { accent: "#2559c9", onAccent: "#ffffff" },
    dark: { accent: "#6ea3ff", onAccent: "#0b0d10" },
  },
  purple: {
    label: "Morado",
    light: { accent: "#6c3fc2", onAccent: "#ffffff" },
    dark: { accent: "#a98cfb", onAccent: "#0b0d10" },
  },
  red: {
    label: "Rojo",
    light: { accent: "#c2302a", onAccent: "#ffffff" },
    dark: { accent: "#ff7b72", onAccent: "#0b0d10" },
  },
  orange: {
    label: "Naranja",
    light: { accent: "#a85208", onAccent: "#ffffff" },
    dark: { accent: "#ffa24f", onAccent: "#0b0d10" },
  },
  pink: {
    label: "Rosa",
    light: { accent: "#b3256d", onAccent: "#ffffff" },
    dark: { accent: "#f574b7", onAccent: "#0b0d10" },
  },
  teal: {
    label: "Turquesa",
    light: { accent: "#0e7469", onAccent: "#ffffff" },
    dark: { accent: "#2fd5c0", onAccent: "#0b0d10" },
  },
  graphite: {
    label: "Grafito",
    light: { accent: "#3b424d", onAccent: "#ffffff" },
    dark: { accent: "#c5cad3", onAccent: "#0b0d10" },
  },
};

export const DEFAULT_THEME: Theme = "green";

const DARK_QUERY = "(prefers-color-scheme: dark)";
const STORAGE_KEY = "gymvik.theme";

function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && Object.hasOwn(THEMES, value);
}

function prefersDark(): boolean {
  return typeof matchMedia === "function" && matchMedia(DARK_QUERY).matches;
}

/**
 * Último tema aplicado en este dispositivo, para pintar el arranque con el color
 * correcto antes de que lleguen los ajustes. Solo es una comodidad: sin acceso
 * al almacenamiento vale el verde.
 */
export function cachedTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isTheme(saved)) return saved;
  } catch {
    // Almacenamiento bloqueado (ventana privada, etc.).
  }
  return DEFAULT_THEME;
}

function remember(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Igual que arriba: no pasa nada si no se puede guardar.
  }
}

function setThemeColorMeta(color: string): void {
  let meta = document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.append(meta);
  }
  meta.content = color;
}

let current: Theme = DEFAULT_THEME;
let watchingColorScheme = false;

// El sistema cambia de claro a oscuro (por ejemplo al anochecer): se vuelve a pintar el tema.
function watchColorScheme(): void {
  if (watchingColorScheme || typeof matchMedia !== "function") return;
  watchingColorScheme = true;
  matchMedia(DARK_QUERY).addEventListener("change", () => applyTheme(current));
}

/**
 * Pone el tema como variables CSS (`--accent`, `--on-accent`) en <html> y en la
 * meta `theme-color`, en su variante clara u oscura según `prefers-color-scheme`.
 * Un nombre desconocido usa el verde.
 */
export function applyTheme(theme: string): void {
  current = isTheme(theme) ? theme : DEFAULT_THEME;
  const { accent, onAccent } = THEMES[current][prefersDark() ? "dark" : "light"];
  const root = document.documentElement;
  root.style.setProperty("--accent", accent);
  root.style.setProperty("--on-accent", onAccent);
  setThemeColorMeta(accent);
  remember(current);
  watchColorScheme();
}
