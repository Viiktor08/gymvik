import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HookKey, NotificationType, Settings as UserSettings } from "../../src/shared/types";
import { ApiError } from "../../src/web/api";
import { Settings } from "../../src/web/screens/Settings";
import { refreshSnapshot } from "../../src/web/session/offlineCache";
import { THEMES } from "../../src/web/theme";

// La copia sin conexión usa IndexedDB, que aquí no importa: solo se comprueba que se pide refrescarla.
vi.mock("../../src/web/session/offlineCache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/web/session/offlineCache")>()),
  refreshSnapshot: vi.fn().mockResolvedValue(undefined),
}));

const webauthn = vi.hoisted(() => ({ registerPasskey: vi.fn<(label?: string) => Promise<void>>() }));

vi.mock("../../src/web/webauthn", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/web/webauthn")>()),
  ...webauthn,
}));

const SETTINGS: UserSettings = {
  displayName: "Victor",
  theme: "green",
  timezone: "Europe/Madrid",
  weeklyGoal: 3,
  stepsGoal: 8000,
  creatineGrams: 5,
  shortcutName: "Gymvik Pasos",
  notifications: {
    today: { enabled: true, time: "09:00" },
    creatine: { enabled: true, time: "10:00" },
    steps: { enabled: true, time: "20:00" },
    streak: { enabled: false, time: "19:00" },
    weight: { enabled: true, time: "09:00" },
  },
};

type Passkey = { id: string; label: string; createdAt: string; transports: string[] };

const PASSKEYS: Passkey[] = [
  { id: "cred-1", label: "iPhone de Victor", createdAt: "2026-11-02T12:00:00.000Z", transports: ["internal"] },
  { id: "cred-2", label: "", createdAt: "2026-11-05T12:00:00.000Z", transports: [] },
];

const KEY_SECRET = `fk_${"AbC-_123".repeat(5)}XYZ`;

const KEYS: HookKey[] = [
  {
    id: "k-1",
    label: "Pegatina de la nevera",
    scopes: ["creatine"],
    createdAt: "2026-11-01T12:00:00.000Z",
    lastUsedAt: "2026-11-09T12:00:00.000Z",
    revokedAt: null,
  },
  {
    id: "k-2",
    label: "Clave vieja",
    scopes: ["creatine", "steps"],
    createdAt: "2026-10-01T12:00:00.000Z",
    lastUsedAt: null,
    revokedAt: "2026-10-20T12:00:00.000Z",
  },
];

// Un punto sin comprimir de P-256 de mentira: 65 bytes en base64url (con - y _ para probar el alfabeto).
const PUBLIC_KEY_BYTES = Uint8Array.from({ length: 65 }, (_, i) => (i * 7 + 251) % 256);
const PUBLIC_KEY = btoa(String.fromCharCode(...PUBLIC_KEY_BYTES))
  .replaceAll("+", "-")
  .replaceAll("/", "_")
  .replace(/=+$/, "");

type Call = { method: string; path: string; body: unknown; raw: string | undefined };

const server = {
  settings: structuredClone(SETTINGS),
  passkeys: [...PASSKEYS],
  keys: [...KEYS],
  calls: [] as Call[],
  /** `"METODO /ruta"` → estado con el que falla. */
  fails: new Map<string, number>(),
  /** `"METODO /ruta"` → la petición no sale (sin red). */
  offline: new Set<string>(),
  testPush: { sent: 1, removed: 0, failed: 0 },
  recoveryCodes: Array.from({ length: 8 }, (_, i) => `aaaa-bbbb-cccc-${String(1000 + i)}`),
  importResult: { exercises: 61, routines: 4, workouts: 12, bodyMetrics: 9, dailySteps: 30, creatineLogs: 20 },
  backup: { version: 1, exportedAt: "2026-11-10T09:00:00.000Z", exercises: [], workouts: [] },
};

const fetchMock = vi.fn<typeof fetch>();

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function mergeSettings(patch: Partial<UserSettings> & { notifications?: Record<string, Partial<UserSettings["notifications"][NotificationType]>> }) {
  const { notifications, ...rest } = patch;
  const next: UserSettings = { ...server.settings, ...rest, notifications: { ...server.settings.notifications } };
  for (const [type, change] of Object.entries(notifications ?? {})) {
    const key = type as NotificationType;
    next.notifications[key] = { ...next.notifications[key], ...change };
  }
  server.settings = next;
}

async function handle(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const path = String(input);
  const method = init?.method ?? "GET";
  const raw = typeof init?.body === "string" ? init.body : undefined;
  let body: unknown = undefined;
  try {
    body = raw === undefined ? undefined : JSON.parse(raw);
  } catch {
    body = undefined;
  }
  server.calls.push({ method, path, body, raw });

  const id = `${method} ${path}`;
  if (server.offline.has(id)) throw new TypeError("Failed to fetch");
  const failure = server.fails.get(id);
  if (failure !== undefined) return json(failure, { error: `Fallo simulado ${String(failure)}` });

  if (path === "/api/settings" && method === "GET") return json(200, server.settings);
  if (path === "/api/settings" && method === "PATCH") {
    mergeSettings(body as Parameters<typeof mergeSettings>[0]);
    return json(200, server.settings);
  }
  if (path === "/api/auth/passkeys" && method === "GET") return json(200, { passkeys: server.passkeys });
  if (path.startsWith("/api/auth/passkeys/") && method === "DELETE") {
    if (server.passkeys.length === 1) return json(409, { error: "No puedes borrar tu única passkey" });
    const credential = decodeURIComponent(path.slice("/api/auth/passkeys/".length));
    server.passkeys = server.passkeys.filter((passkey) => passkey.id !== credential);
    return json(200, { ok: true });
  }
  if (path === "/api/auth/recovery-codes" && method === "POST") return json(200, { recoveryCodes: server.recoveryCodes });
  if (path === "/api/auth/logout" && method === "POST") return json(200, { ok: true });
  if (path === "/api/hook-keys" && method === "GET") return json(200, server.keys);
  if (path === "/api/hook-keys" && method === "POST") {
    const input = body as { label: string; scopes: HookKey["scopes"] };
    server.keys = [
      { id: "k-new", label: input.label, scopes: input.scopes, createdAt: "2026-11-10T09:00:00.000Z", lastUsedAt: null, revokedAt: null },
      ...server.keys,
    ];
    return json(201, { key: KEY_SECRET });
  }
  if (path.startsWith("/api/hook-keys/") && method === "DELETE") {
    const keyId = decodeURIComponent(path.slice("/api/hook-keys/".length));
    server.keys = server.keys.map((key) => (key.id === keyId ? { ...key, revokedAt: "2026-11-10T09:00:00.000Z" } : key));
    return json(200, { revoked: true });
  }
  if (path === "/api/push/public-key") return json(200, { publicKey: PUBLIC_KEY });
  if (path === "/api/push/subscribe" && method === "POST") return json(200, { subscribed: true });
  if (path === "/api/push/test" && method === "POST") return json(200, server.testPush);
  if (path.startsWith("/api/body-metrics/") && method === "PUT") {
    const day = path.slice("/api/body-metrics/".length);
    return json(200, { localDate: day, ...(body as object) });
  }
  if (path === "/api/backup" && method === "GET") return json(200, server.backup);
  if (path === "/api/backup/import" && method === "POST") {
    try {
      JSON.parse(raw ?? "");
    } catch {
      return json(400, { error: "JSON no válido" });
    }
    return json(200, { imported: server.importResult });
  }
  if (path === "/api/routines") return json(200, []);
  if (path === "/api/exercises") return json(200, []);
  return json(404, { error: "No encontrado" });
}

function calls(method: string, path: string): Call[] {
  return server.calls.filter((call) => call.method === method && call.path === path);
}

const assign = vi.fn<(url: string) => void>();
const writeText = vi.fn<(text: string) => Promise<void>>();

type NotificationStub = {
  permission: NotificationPermission;
  requestPermission: ReturnType<typeof vi.fn<() => Promise<NotificationPermission>>>;
};
let notification: NotificationStub;

function makeSubscription(endpoint: string) {
  return {
    endpoint,
    unsubscribe: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
    toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: "clave-p256dh", auth: "clave-auth" } }),
  };
}

let subscription = makeSubscription("https://push.example.test/abc");
const pushManager = {
  subscribe: vi.fn<(options: PushSubscriptionOptionsInit) => Promise<typeof subscription>>(),
  getSubscription: vi.fn<() => Promise<typeof subscription | null>>(),
};

function installPushSupport(options: { standalone: boolean }) {
  notification = { permission: "default", requestPermission: vi.fn() };
  notification.requestPermission.mockImplementation(async () => {
    notification.permission = "granted";
    return "granted";
  });
  vi.stubGlobal("Notification", notification);
  vi.stubGlobal("PushManager", class {});
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: options.standalone && query.includes("standalone"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  const registration = { pushManager };
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { ready: Promise.resolve(registration), getRegistration: vi.fn().mockResolvedValue(registration) },
  });
}

async function renderSettings() {
  const view = render(
    <MemoryRouter initialEntries={["/ajustes"]}>
      <Routes>
        <Route path="/ajustes" element={<Settings />} />
        <Route path="/ajustes/atajos" element={<p>Guía abierta</p>} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { name: "Tema" });
  await waitFor(() => expect(screen.queryByText("Cargando…")).toBeNull());
  return view;
}

function text(element: HTMLElement): string {
  return element.textContent ?? "";
}

function region(name: string): HTMLElement {
  return screen.getByRole("region", { name });
}

beforeEach(() => {
  // Hoy es martes 10 de noviembre de 2026, a media mañana. Solo se finge la fecha: los temporizadores siguen reales.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 10, 10, 0, 0));
  server.settings = structuredClone(SETTINGS);
  server.passkeys = [...PASSKEYS];
  server.keys = [...KEYS];
  server.calls = [];
  server.fails = new Map();
  server.offline = new Set();
  server.testPush = { sent: 1, removed: 0, failed: 0 };
  fetchMock.mockReset();
  fetchMock.mockImplementation(handle);
  vi.stubGlobal("fetch", fetchMock);
  assign.mockReset();
  vi.stubGlobal("location", { pathname: "/ajustes", origin: "https://gymvik.example.test", assign });
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  webauthn.registerPasskey.mockReset();
  webauthn.registerPasskey.mockResolvedValue(undefined);
  vi.mocked(refreshSnapshot).mockClear();
  subscription = makeSubscription("https://push.example.test/abc");
  pushManager.subscribe.mockReset();
  pushManager.subscribe.mockResolvedValue(subscription);
  pushManager.getSubscription.mockReset();
  pushManager.getSubscription.mockResolvedValue(null);
  document.documentElement.removeAttribute("style");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "clipboard");
  Reflect.deleteProperty(navigator, "serviceWorker");
  Reflect.deleteProperty(navigator, "standalone");
});

describe("Ajustes: carga", () => {
  it("pinta todas las secciones cuando llegan los ajustes", async () => {
    await renderSettings();
    const headings = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(headings).toEqual([
      "Cuenta",
      "Tema",
      "Objetivos",
      "Atajos y NFC",
      "Notificaciones",
      "Peso",
      "Entreno pasado",
      "Aplicación",
      "Datos",
    ]);
  });

  it("si los ajustes no cargan avisa y deja reintentar", async () => {
    server.fails.set("GET /api/settings", 500);
    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );
    expect(text(await screen.findByRole("alert"))).toContain("Fallo simulado 500");

    server.fails.clear();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("heading", { name: "Tema" })).toBeTruthy();
  });

  it("enseña la versión instalada, la de package.json", async () => {
    await renderSettings();
    expect(within(region("Aplicación")).getByText(/^\d+\.\d+\.\d+/)).toBeTruthy();
  });
});

describe("Ajustes: tema", () => {
  it("marca el tema actual", async () => {
    await renderSettings();
    expect(screen.getByRole("button", { name: "Verde" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Azul" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getAllByRole("button").filter((button) => button.hasAttribute("aria-pressed"))).toHaveLength(8);
  });

  it("al elegir un color lo aplica y lo guarda en la cuenta", async () => {
    await renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "Azul" }));

    await waitFor(() => expect(calls("PATCH", "/api/settings")).toHaveLength(1));
    expect(calls("PATCH", "/api/settings")[0]?.body).toEqual({ theme: "blue" });
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe(THEMES.blue.light.accent);
    await waitFor(() => expect(screen.getByRole("button", { name: "Azul" }).getAttribute("aria-pressed")).toBe("true"));
    expect(localStorage.getItem("gymvik.theme")).toBe("blue");
  });

  it("si no se puede guardar vuelve al color anterior y lo dice", async () => {
    server.fails.set("PATCH /api/settings", 500);
    await renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "Rojo" }));

    expect(text(await screen.findByRole("alert"))).toContain("Fallo simulado 500");
    expect(screen.getByRole("button", { name: "Verde" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Rojo" }).getAttribute("aria-pressed")).toBe("false");
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe(THEMES.green.light.accent);
  });
});

describe("Ajustes: objetivos", () => {
  it("guarda los tres objetivos, con coma decimal en los gramos", async () => {
    await renderSettings();
    const goals = region("Objetivos");
    fireEvent.change(within(goals).getByLabelText("Entrenos por semana"), { target: { value: "4" } });
    fireEvent.change(within(goals).getByLabelText("Pasos al día"), { target: { value: "10000" } });
    fireEvent.change(within(goals).getByLabelText("Creatina (g)"), { target: { value: "2,5" } });
    fireEvent.click(within(goals).getByRole("button", { name: "Guardar objetivos" }));

    expect(text(await within(goals).findByRole("status"))).toContain("Objetivos guardados.");
    expect(calls("PATCH", "/api/settings")[0]?.body).toEqual({ weeklyGoal: 4, stepsGoal: 10000, creatineGrams: 2.5 });
  });

  it("no manda nada si un objetivo no vale", async () => {
    await renderSettings();
    const goals = region("Objetivos");
    fireEvent.change(within(goals).getByLabelText("Entrenos por semana"), { target: { value: "9" } });
    fireEvent.click(within(goals).getByRole("button", { name: "Guardar objetivos" }));

    expect(text(await within(goals).findByRole("alert"))).toContain("entre 1 y 7");
    expect(calls("PATCH", "/api/settings")).toHaveLength(0);

    fireEvent.change(within(goals).getByLabelText("Entrenos por semana"), { target: { value: "" } });
    fireEvent.click(within(goals).getByRole("button", { name: "Guardar objetivos" }));
    expect(text(await within(goals).findByRole("alert"))).toContain("entre 1 y 7");
    expect(calls("PATCH", "/api/settings")).toHaveLength(0);
  });
});

describe("Ajustes: cuenta", () => {
  it("lista las passkeys con su nombre y la fecha en que se añadieron", async () => {
    await renderSettings();
    const account = region("Cuenta");
    expect(await within(account).findByText("iPhone de Victor")).toBeTruthy();
    expect(within(account).getByText("Añadida el 2 nov 2026")).toBeTruthy();
    expect(within(account).getByText("Passkey sin nombre")).toBeTruthy();
    expect(within(account).getByText("Añadida el 5 nov 2026")).toBeTruthy();
  });

  it("añade la passkey de este dispositivo con el nombre escrito y vuelve a listar", async () => {
    await renderSettings();
    const account = region("Cuenta");
    await within(account).findByText("iPhone de Victor");
    fireEvent.change(within(account).getByLabelText("Nombre del dispositivo (opcional)"), { target: { value: " iPad " } });
    fireEvent.click(within(account).getByRole("button", { name: "Añadir passkey de este dispositivo" }));

    expect(text(await within(account).findByRole("status"))).toContain("Passkey añadida.");
    expect(webauthn.registerPasskey).toHaveBeenCalledWith("iPad");
    expect(calls("GET", "/api/auth/passkeys")).toHaveLength(2);
  });

  it("si la passkey no se puede crear lo dice en español", async () => {
    webauthn.registerPasskey.mockRejectedValue(new ApiError(409, "Esa passkey ya está registrada"));
    await renderSettings();
    const account = region("Cuenta");
    await within(account).findByText("iPhone de Victor");
    fireEvent.click(within(account).getByRole("button", { name: "Añadir passkey de este dispositivo" }));
    expect(text(await within(account).findByRole("alert"))).toContain("Esa passkey ya está registrada");
  });

  it("cancelar la confirmación de quitar una passkey no borra nada", async () => {
    await renderSettings();
    const account = region("Cuenta");
    await within(account).findByText("iPhone de Victor");
    fireEvent.click(within(account).getByRole("button", { name: "Quitar passkey iPhone de Victor" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(calls("DELETE", "/api/auth/passkeys/cred-1")).toHaveLength(0);
    expect(within(account).getByText("iPhone de Victor")).toBeTruthy();
  });

  it("quitar una passkey pide confirmación y la borra", async () => {
    await renderSettings();
    const account = region("Cuenta");
    await within(account).findByText("iPhone de Victor");
    fireEvent.click(within(account).getByRole("button", { name: "Quitar passkey iPhone de Victor" }));

    const sheet = await screen.findByRole("dialog", { name: "¿Quitar esta passkey?" });
    expect(calls("DELETE", "/api/auth/passkeys/cred-1")).toHaveLength(0);
    fireEvent.click(within(sheet).getByRole("button", { name: "Sí, quitar" }));

    await waitFor(() => expect(within(account).queryByText("iPhone de Victor")).toBeNull());
    expect(calls("DELETE", "/api/auth/passkeys/cred-1")).toHaveLength(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("quitar la última passkey da un mensaje claro y no la quita", async () => {
    server.passkeys = [PASSKEYS[0] as Passkey];
    await renderSettings();
    const account = region("Cuenta");
    await within(account).findByText("iPhone de Victor");
    fireEvent.click(within(account).getByRole("button", { name: "Quitar passkey iPhone de Victor" }));
    const sheet = await screen.findByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: "Sí, quitar" }));

    expect(text(await within(sheet).findByRole("alert"))).toContain("Es tu única passkey");
    expect(text(within(sheet).getByRole("alert"))).toContain("Añade otra");
    fireEvent.click(within(sheet).getByRole("button", { name: "Cancelar" }));
    expect(within(account).getByText("iPhone de Victor")).toBeTruthy();
  });

  it("si la sesión caducó al quitar una passkey lleva al acceso", async () => {
    server.fails.set("DELETE /api/auth/passkeys/cred-1", 401);
    await renderSettings();
    const account = region("Cuenta");
    await within(account).findByText("iPhone de Victor");
    fireEvent.click(within(account).getByRole("button", { name: "Quitar passkey iPhone de Victor" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Sí, quitar" }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith("/login"));
  });

  it("si la sesión caducó al listar las passkeys lleva al acceso", async () => {
    server.fails.set("GET /api/auth/passkeys", 401);
    await renderSettings();
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/login"));
  });

  it("los códigos de recuperación nuevos piden confirmación y se enseñan una sola vez", async () => {
    await renderSettings();
    const account = region("Cuenta");
    fireEvent.click(within(account).getByRole("button", { name: "Generar códigos nuevos" }));

    const sheet = await screen.findByRole("dialog", { name: "¿Generar códigos nuevos?" });
    expect(text(sheet)).toContain("dejarán de funcionar");
    expect(calls("POST", "/api/auth/recovery-codes")).toHaveLength(0);
    fireEvent.click(within(sheet).getByRole("button", { name: "Sí, generar" }));

    const panel = await within(account).findByRole("group", { name: "Tus códigos nuevos" });
    const items = within(panel).getAllByRole("listitem").map((item) => item.textContent);
    expect(items).toEqual(server.recoveryCodes);
    expect(text(panel)).toContain("no se podrán volver a ver");

    fireEvent.click(within(panel).getByRole("button", { name: "Copiar códigos" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(server.recoveryCodes.join("\n")));

    fireEvent.click(within(panel).getByRole("button", { name: "Los he guardado" }));
    expect(screen.queryByText("aaaa-bbbb-cccc-1000")).toBeNull();
    expect(within(account).queryByRole("group", { name: "Tus códigos nuevos" })).toBeNull();
  });

  it("si no se pueden generar los códigos lo dice y no enseña ninguno", async () => {
    server.fails.set("POST /api/auth/recovery-codes", 500);
    await renderSettings();
    fireEvent.click(within(region("Cuenta")).getByRole("button", { name: "Generar códigos nuevos" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Sí, generar" }));
    expect(text(await screen.findByRole("alert"))).toContain("Fallo simulado 500");
    expect(screen.queryByRole("group", { name: "Tus códigos nuevos" })).toBeNull();
  });

  it("cerrar sesión la cierra en el servidor y va al acceso", async () => {
    await renderSettings();
    fireEvent.click(within(region("Cuenta")).getByRole("button", { name: "Cerrar sesión" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/login"));
    expect(calls("POST", "/api/auth/logout")).toHaveLength(1);
  });

  it("si no se puede cerrar la sesión se queda y avisa", async () => {
    server.offline.add("POST /api/auth/logout");
    await renderSettings();
    fireEvent.click(within(region("Cuenta")).getByRole("button", { name: "Cerrar sesión" }));
    expect(text(await within(region("Cuenta")).findByRole("alert"))).toContain("Sin conexión");
    expect(assign).not.toHaveBeenCalled();
  });
});

describe("Ajustes: atajos y NFC", () => {
  it("lista las claves con sus permisos y su último uso, sin enseñar nunca el secreto", async () => {
    await renderSettings();
    const shortcuts = region("Atajos y NFC");
    expect(await within(shortcuts).findByText("Pegatina de la nevera")).toBeTruthy();
    expect(within(shortcuts).getByText("Creatina · Último uso: 9 nov 2026")).toBeTruthy();
    expect(within(shortcuts).getByText("Clave vieja")).toBeTruthy();
    expect(within(shortcuts).getByText("Creatina y Pasos · Revocada el 20 oct 2026")).toBeTruthy();
    // Solo la clave activa se puede revocar.
    expect(within(shortcuts).getAllByRole("button", { name: /^Revocar/ })).toHaveLength(1);
  });

  it("una clave sin usar lo dice", async () => {
    server.keys = [{ ...(KEYS[0] as HookKey), lastUsedAt: null }];
    await renderSettings();
    expect(await within(region("Atajos y NFC")).findByText("Creatina · Sin usar todavía")).toBeTruthy();
  });

  it("sin claves explica para qué sirven", async () => {
    server.keys = [];
    await renderSettings();
    expect(await within(region("Atajos y NFC")).findByText("Todavía no has creado ninguna clave.")).toBeTruthy();
  });

  it("crear una clave pide nombre y algún permiso", async () => {
    await renderSettings();
    const shortcuts = region("Atajos y NFC");
    const create = within(shortcuts).getByRole("button", { name: "Crear clave" });
    expect((create as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(within(shortcuts).getByLabelText("Nombre de la clave"), { target: { value: "Pegatina" } });
    expect((create as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(shortcuts).getByRole("checkbox", { name: "Creatina" }));
    expect((create as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(within(shortcuts).getByRole("checkbox", { name: "Creatina" }));
    expect((create as HTMLButtonElement).disabled).toBe(true);
  });

  it("la clave nueva se enseña una sola vez, con botón para copiarla", async () => {
    await renderSettings();
    const shortcuts = region("Atajos y NFC");
    await within(shortcuts).findByText("Pegatina de la nevera");
    fireEvent.change(within(shortcuts).getByLabelText("Nombre de la clave"), { target: { value: " Atajo de pasos " } });
    fireEvent.click(within(shortcuts).getByRole("checkbox", { name: "Pasos" }));
    fireEvent.click(within(shortcuts).getByRole("button", { name: "Crear clave" }));

    const panel = await within(shortcuts).findByRole("group", { name: "Tu clave nueva" });
    expect(calls("POST", "/api/hook-keys")[0]?.body).toEqual({ label: "Atajo de pasos", scopes: ["steps"] });
    expect(within(panel).getByText(KEY_SECRET)).toBeTruthy();
    expect(text(panel)).toContain("no se podrá volver a ver");
    // La lista se vuelve a pedir y ya incluye la clave nueva (solo con su nombre).
    expect(await within(shortcuts).findByText("Atajo de pasos")).toBeTruthy();
    expect(calls("GET", "/api/hook-keys")).toHaveLength(2);

    fireEvent.click(within(panel).getByRole("button", { name: "Copiar clave" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(KEY_SECRET));
    expect(await within(panel).findByRole("button", { name: "Copiado" })).toBeTruthy();

    fireEvent.click(within(panel).getByRole("button", { name: "Ya la he copiado" }));
    expect(screen.queryByText(KEY_SECRET)).toBeNull();
    expect(within(shortcuts).queryByRole("group", { name: "Tu clave nueva" })).toBeNull();
    // El formulario queda limpio para la siguiente.
    expect((within(shortcuts).getByLabelText("Nombre de la clave") as HTMLInputElement).value).toBe("");
    expect((within(shortcuts).getByRole("checkbox", { name: "Pasos" }) as HTMLInputElement).checked).toBe(false);
  });

  it("tras crear la clave no queda en ningún sitio del DOM salvo el panel", async () => {
    await renderSettings();
    const shortcuts = region("Atajos y NFC");
    fireEvent.change(within(shortcuts).getByLabelText("Nombre de la clave"), { target: { value: "Otra" } });
    fireEvent.click(within(shortcuts).getByRole("checkbox", { name: "Creatina" }));
    fireEvent.click(within(shortcuts).getByRole("button", { name: "Crear clave" }));
    await within(shortcuts).findByRole("group", { name: "Tu clave nueva" });

    expect(screen.getAllByText(KEY_SECRET)).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Ya la he copiado" }));
    expect(document.body.textContent).not.toContain(KEY_SECRET);
  });

  it("si la clave no se puede crear lo dice y no enseña ninguna", async () => {
    server.fails.set("POST /api/hook-keys", 400);
    await renderSettings();
    const shortcuts = region("Atajos y NFC");
    fireEvent.change(within(shortcuts).getByLabelText("Nombre de la clave"), { target: { value: "Otra" } });
    fireEvent.click(within(shortcuts).getByRole("checkbox", { name: "Creatina" }));
    fireEvent.click(within(shortcuts).getByRole("button", { name: "Crear clave" }));

    expect(text(await within(shortcuts).findByRole("alert"))).toContain("Fallo simulado 400");
    expect(within(shortcuts).queryByRole("group", { name: "Tu clave nueva" })).toBeNull();
  });

  it("revocar una clave pide confirmación y la marca como revocada", async () => {
    await renderSettings();
    const shortcuts = region("Atajos y NFC");
    await within(shortcuts).findByText("Pegatina de la nevera");
    fireEvent.click(within(shortcuts).getByRole("button", { name: "Revocar Pegatina de la nevera" }));

    const sheet = await screen.findByRole("dialog", { name: "¿Revocar esta clave?" });
    expect(text(sheet)).toContain("dejará de funcionar");
    expect(text(sheet)).toContain("Pegatina de la nevera");
    expect(calls("DELETE", "/api/hook-keys/k-1")).toHaveLength(0);
    fireEvent.click(within(sheet).getByRole("button", { name: "Sí, revocar" }));

    await waitFor(() => expect(within(shortcuts).queryByRole("button", { name: /^Revocar/ })).toBeNull());
    expect(calls("DELETE", "/api/hook-keys/k-1")).toHaveLength(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("guarda el nombre exacto del Atajo de Salud", async () => {
    await renderSettings();
    const shortcuts = region("Atajos y NFC");
    const field = within(shortcuts).getByLabelText("Nombre del Atajo de Salud");
    expect((field as HTMLInputElement).value).toBe("Gymvik Pasos");
    fireEvent.change(field, { target: { value: "  Mis pasos " } });
    fireEvent.click(within(shortcuts).getByRole("button", { name: "Guardar nombre" }));

    expect(await within(shortcuts).findByText("Nombre guardado.")).toBeTruthy();
    expect(calls("PATCH", "/api/settings")[0]?.body).toEqual({ shortcutName: "Mis pasos" });
  });

  it("no guarda un nombre vacío", async () => {
    await renderSettings();
    const shortcuts = region("Atajos y NFC");
    fireEvent.change(within(shortcuts).getByLabelText("Nombre del Atajo de Salud"), { target: { value: "  " } });
    fireEvent.click(within(shortcuts).getByRole("button", { name: "Guardar nombre" }));
    expect(text(await within(shortcuts).findByRole("alert"))).toContain("Escribe el nombre");
    expect(calls("PATCH", "/api/settings")).toHaveLength(0);
  });

  it("copia las URL de cada atajo y enlaza con la guía", async () => {
    await renderSettings();
    const shortcuts = region("Atajos y NFC");
    expect(within(shortcuts).getByText("https://gymvik.example.test/api/hook/creatine")).toBeTruthy();
    fireEvent.click(within(shortcuts).getByRole("button", { name: "Copiar URL de creatina" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("https://gymvik.example.test/api/hook/creatine"));
    fireEvent.click(within(shortcuts).getByRole("button", { name: "Copiar URL de pasos" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("https://gymvik.example.test/api/hook/steps"));

    fireEvent.click(within(shortcuts).getByRole("link", { name: /Guía paso a paso/ }));
    expect(await screen.findByText("Guía abierta")).toBeTruthy();
  });
});

describe("Ajustes: notificaciones", () => {
  it("si la app no está en la pantalla de inicio explica cómo instalarla y no deja activar", async () => {
    installPushSupport({ standalone: false });
    await renderSettings();
    const notifications = region("Notificaciones");

    expect(text(notifications)).toContain("pantalla de inicio");
    expect(text(notifications)).toContain("Compartir");
    expect(text(notifications)).toContain("Añadir a pantalla de inicio");
    expect(within(notifications).queryByRole("button", { name: "Activar notificaciones" })).toBeNull();
  });

  it("en Safari de iPhone, donde ni existe Notification, también explica la instalación", async () => {
    await renderSettings();
    const notifications = region("Notificaciones");
    expect(text(notifications)).toContain("Añadir a pantalla de inicio");
    expect(within(notifications).queryByRole("button", { name: "Activar notificaciones" })).toBeNull();
  });

  it("instalada: pide el permiso dentro del propio clic, antes de cualquier otra cosa, y suscribe", async () => {
    installPushSupport({ standalone: true });
    await renderSettings();
    const notifications = region("Notificaciones");
    expect(text(notifications)).not.toContain("Añadir a pantalla de inicio");
    const button = await within(notifications).findByRole("button", { name: "Activar notificaciones" });
    const callsBefore = server.calls.length;

    fireEvent.click(button);
    // Sin esperar nada: iOS solo enseña el permiso si la petición sale directamente del toque.
    expect(notification.requestPermission).toHaveBeenCalledTimes(1);
    expect(server.calls.length).toBe(callsBefore);
    expect(pushManager.subscribe).not.toHaveBeenCalled();

    expect(await within(notifications).findByText("Notificaciones activadas en este dispositivo.")).toBeTruthy();
    expect(calls("GET", "/api/push/public-key")).toHaveLength(1);

    expect(pushManager.subscribe).toHaveBeenCalledTimes(1);
    const options = pushManager.subscribe.mock.calls[0]?.[0];
    expect(options?.userVisibleOnly).toBe(true);
    // La clave pública base64url llega como bytes, no como texto.
    expect(options?.applicationServerKey).toBeInstanceOf(Uint8Array);
    expect(Array.from(options?.applicationServerKey as Uint8Array)).toEqual(Array.from(PUBLIC_KEY_BYTES));

    const posts = calls("POST", "/api/push/subscribe");
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toEqual(subscription.toJSON());
    // El botón ya no hace falta en este dispositivo.
    expect(within(notifications).queryByRole("button", { name: "Activar notificaciones" })).toBeNull();
  });

  it("también cuenta como instalada con navigator.standalone (Safari de iOS)", async () => {
    installPushSupport({ standalone: false });
    Object.defineProperty(navigator, "standalone", { configurable: true, value: true });
    await renderSettings();
    expect(await within(region("Notificaciones")).findByRole("button", { name: "Activar notificaciones" })).toBeTruthy();
    expect(text(region("Notificaciones"))).not.toContain("Añadir a pantalla de inicio");
  });

  it("si ya estaban activadas en este dispositivo no vuelve a pedirlo", async () => {
    installPushSupport({ standalone: true });
    notification.permission = "granted";
    pushManager.getSubscription.mockResolvedValue(subscription);
    await renderSettings();
    expect(await within(region("Notificaciones")).findByText("Notificaciones activadas en este dispositivo.")).toBeTruthy();
    expect(within(region("Notificaciones")).queryByRole("button", { name: "Activar notificaciones" })).toBeNull();
  });

  it("si se rechaza el permiso no suscribe, no avisa al servidor y explica cómo cambiarlo", async () => {
    installPushSupport({ standalone: true });
    notification.requestPermission.mockImplementation(async () => {
      notification.permission = "denied";
      return "denied";
    });
    await renderSettings();
    const notifications = region("Notificaciones");
    fireEvent.click(await within(notifications).findByRole("button", { name: "Activar notificaciones" }));

    expect(text(await within(notifications).findByRole("alert"))).toContain("Ajustes de iOS");
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(calls("POST", "/api/push/subscribe")).toHaveLength(0);
    expect(calls("GET", "/api/push/public-key")).toHaveLength(0);
  });

  it("si se cierra el aviso del permiso sin decidir lo dice y se puede volver a intentar", async () => {
    installPushSupport({ standalone: true });
    notification.requestPermission.mockImplementation(async () => "default");
    await renderSettings();
    const notifications = region("Notificaciones");
    fireEvent.click(await within(notifications).findByRole("button", { name: "Activar notificaciones" }));

    expect(text(await within(notifications).findByRole("alert"))).toContain("No se ha concedido el permiso");
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect((within(notifications).getByRole("button", { name: "Activar notificaciones" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("si el servidor no tiene las notificaciones configuradas enseña su mensaje y no suscribe", async () => {
    installPushSupport({ standalone: true });
    server.fails.set("GET /api/push/public-key", 503);
    await renderSettings();
    const notifications = region("Notificaciones");
    fireEvent.click(await within(notifications).findByRole("button", { name: "Activar notificaciones" }));

    expect(text(await within(notifications).findByRole("alert"))).toContain("Fallo simulado 503");
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it("si el navegador no puede suscribir lo dice sin detalles técnicos", async () => {
    installPushSupport({ standalone: true });
    pushManager.subscribe.mockRejectedValue(new DOMException("push service error", "AbortError"));
    await renderSettings();
    const notifications = region("Notificaciones");
    fireEvent.click(await within(notifications).findByRole("button", { name: "Activar notificaciones" }));

    expect(text(await within(notifications).findByRole("alert"))).toContain("No se pudieron activar las notificaciones");
    expect(calls("POST", "/api/push/subscribe")).toHaveLength(0);
  });

  it("si el servidor rechaza la suscripción no da el aviso por activado", async () => {
    installPushSupport({ standalone: true });
    server.fails.set("POST /api/push/subscribe", 400);
    await renderSettings();
    const notifications = region("Notificaciones");
    fireEvent.click(await within(notifications).findByRole("button", { name: "Activar notificaciones" }));

    expect(text(await within(notifications).findByRole("alert"))).toContain("Fallo simulado 400");
    expect(within(notifications).queryByText("Notificaciones activadas en este dispositivo.")).toBeNull();
    expect((within(notifications).getByRole("button", { name: "Activar notificaciones" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("si el servidor rechaza la suscripción, la del navegador se anula para no dejarla huérfana", async () => {
    installPushSupport({ standalone: true });
    server.fails.set("POST /api/push/subscribe", 400);
    await renderSettings();
    const notifications = region("Notificaciones");
    fireEvent.click(await within(notifications).findByRole("button", { name: "Activar notificaciones" }));

    expect(text(await within(notifications).findByRole("alert"))).toContain("Fallo simulado 400");
    // Sin esto, al recargar el navegador diría "activadas" mientras el servidor no tiene ninguna fila.
    expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("si anular la suscripción tras el fallo también falla, se sigue mostrando el error original", async () => {
    installPushSupport({ standalone: true });
    server.fails.set("POST /api/push/subscribe", 400);
    subscription.unsubscribe.mockRejectedValue(new Error("no se pudo anular"));
    await renderSettings();
    const notifications = region("Notificaciones");
    fireEvent.click(await within(notifications).findByRole("button", { name: "Activar notificaciones" }));

    expect(text(await within(notifications).findByRole("alert"))).toContain("Fallo simulado 400");
  });

  it("antes de suscribir anula la suscripción que el navegador ya tuviera, para no reutilizar un endpoint viejo", async () => {
    installPushSupport({ standalone: true });
    await renderSettings();
    const notifications = region("Notificaciones");
    const button = await within(notifications).findByRole("button", { name: "Activar notificaciones" });
    // El navegador conserva una suscripción que el servidor ya no tiene.
    const stale = makeSubscription("https://push.example.test/vieja");
    pushManager.getSubscription.mockResolvedValue(stale);
    fireEvent.click(button);

    expect(await within(notifications).findByText("Notificaciones activadas en este dispositivo.")).toBeTruthy();
    expect(stale.unsubscribe).toHaveBeenCalledTimes(1);
    expect(pushManager.subscribe).toHaveBeenCalledTimes(1);
    expect(stale.unsubscribe.mock.invocationCallOrder[0]).toBeLessThan(pushManager.subscribe.mock.invocationCallOrder[0] as number);
    // El permiso se sigue pidiendo primero, dentro del clic.
    expect(notification.requestPermission.mock.invocationCallOrder[0]).toBeLessThan(
      stale.unsubscribe.mock.invocationCallOrder[0] as number,
    );
    expect(calls("POST", "/api/push/subscribe")[0]?.body).toEqual(subscription.toJSON());
    // La suscripción nueva no se anula.
    expect(subscription.unsubscribe).not.toHaveBeenCalled();
  });

  it("si anular la suscripción vieja falla, se intenta suscribir igualmente", async () => {
    installPushSupport({ standalone: true });
    await renderSettings();
    const notifications = region("Notificaciones");
    const button = await within(notifications).findByRole("button", { name: "Activar notificaciones" });
    const stale = makeSubscription("https://push.example.test/vieja");
    stale.unsubscribe.mockRejectedValue(new Error("no se pudo anular"));
    pushManager.getSubscription.mockResolvedValue(stale);
    fireEvent.click(button);

    expect(await within(notifications).findByText("Notificaciones activadas en este dispositivo.")).toBeTruthy();
    expect(pushManager.subscribe).toHaveBeenCalledTimes(1);
  });

  it("muestra un interruptor y una hora por aviso, con lo que hay guardado", async () => {
    await renderSettings();
    const notifications = region("Notificaciones");
    const expected: [string, boolean, string][] = [
      ["Entreno de hoy", true, "09:00"],
      ["Creatina", true, "10:00"],
      ["Pasos", true, "20:00"],
      ["Racha", false, "19:00"],
      ["Peso", true, "09:00"],
    ];
    for (const [name, enabled, time] of expected) {
      expect(within(notifications).getByRole("switch", { name }).getAttribute("aria-checked")).toBe(String(enabled));
      expect((within(notifications).getByLabelText(`Hora del aviso de ${name}`) as HTMLInputElement).value).toBe(time);
    }
  });

  it("apagar o encender un aviso guarda solo ese aviso", async () => {
    await renderSettings();
    const notifications = region("Notificaciones");
    fireEvent.click(within(notifications).getByRole("switch", { name: "Creatina" }));
    await waitFor(() =>
      expect(within(notifications).getByRole("switch", { name: "Creatina" }).getAttribute("aria-checked")).toBe("false"),
    );
    expect(calls("PATCH", "/api/settings")[0]?.body).toEqual({ notifications: { creatine: { enabled: false } } });

    fireEvent.click(within(notifications).getByRole("switch", { name: "Racha" }));
    await waitFor(() => expect(calls("PATCH", "/api/settings")).toHaveLength(2));
    expect(calls("PATCH", "/api/settings")[1]?.body).toEqual({ notifications: { streak: { enabled: true } } });
  });

  it("cambiar la hora de un aviso guarda solo la hora", async () => {
    await renderSettings();
    const notifications = region("Notificaciones");
    fireEvent.change(within(notifications).getByLabelText("Hora del aviso de Pasos"), { target: { value: "21:30" } });
    await waitFor(() => expect(calls("PATCH", "/api/settings")).toHaveLength(1));
    expect(calls("PATCH", "/api/settings")[0]?.body).toEqual({ notifications: { steps: { time: "21:30" } } });
    expect((within(notifications).getByLabelText("Hora del aviso de Pasos") as HTMLInputElement).value).toBe("21:30");
  });

  it("si no se guarda un interruptor vuelve a como estaba y avisa", async () => {
    server.fails.set("PATCH /api/settings", 500);
    await renderSettings();
    const notifications = region("Notificaciones");
    fireEvent.click(within(notifications).getByRole("switch", { name: "Peso" }));

    expect(text(await within(notifications).findByRole("alert"))).toContain("Fallo simulado 500");
    expect(within(notifications).getByRole("switch", { name: "Peso" }).getAttribute("aria-checked")).toBe("true");
  });

  it("el aviso de prueba dice si ha llegado", async () => {
    await renderSettings();
    const notifications = region("Notificaciones");
    fireEvent.click(within(notifications).getByRole("button", { name: "Enviar aviso de prueba" }));
    expect(text(await within(notifications).findByRole("status"))).toContain("Aviso enviado");
    expect(calls("POST", "/api/push/test")).toHaveLength(1);
  });

  it("el aviso de prueba sin ningún dispositivo suscrito lo explica", async () => {
    server.testPush = { sent: 0, removed: 0, failed: 0 };
    await renderSettings();
    const notifications = region("Notificaciones");
    fireEvent.click(within(notifications).getByRole("button", { name: "Enviar aviso de prueba" }));
    expect(text(await within(notifications).findByRole("status"))).toContain("Ningún dispositivo");
  });

  it("el aviso de prueba que falla en el servicio de avisos se cuenta como error", async () => {
    server.testPush = { sent: 0, removed: 0, failed: 2 };
    await renderSettings();
    const notifications = region("Notificaciones");
    fireEvent.click(within(notifications).getByRole("button", { name: "Enviar aviso de prueba" }));
    expect(text(await within(notifications).findByRole("alert"))).toContain("No se pudo entregar");
  });

  it("si la suscripción había caducado dice que hay que activarlas otra vez", async () => {
    server.testPush = { sent: 0, removed: 1, failed: 0 };
    await renderSettings();
    const notifications = region("Notificaciones");
    fireEvent.click(within(notifications).getByRole("button", { name: "Enviar aviso de prueba" }));
    expect(text(await within(notifications).findByRole("alert"))).toContain("caducado");
  });

  it("si el servidor quitó la suscripción de este dispositivo vuelve el botón para activarlas otra vez", async () => {
    installPushSupport({ standalone: true });
    notification.permission = "granted";
    pushManager.getSubscription.mockResolvedValue(subscription);
    server.testPush = { sent: 0, removed: 1, failed: 0 };
    await renderSettings();
    const notifications = region("Notificaciones");
    await within(notifications).findByText("Notificaciones activadas en este dispositivo.");
    expect(within(notifications).queryByRole("button", { name: "Activar notificaciones" })).toBeNull();

    fireEvent.click(within(notifications).getByRole("button", { name: "Enviar aviso de prueba" }));
    expect(text(await within(notifications).findByRole("alert"))).toContain("caducado");
    expect(within(notifications).queryByText("Notificaciones activadas en este dispositivo.")).toBeNull();

    // Y desde ahí se puede volver a activar: la suscripción vieja del navegador se anula y se crea otra.
    fireEvent.click(within(notifications).getByRole("button", { name: "Activar notificaciones" }));
    expect(await within(notifications).findByText("Notificaciones activadas en este dispositivo.")).toBeTruthy();
    expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
    expect(calls("POST", "/api/push/subscribe")).toHaveLength(1);
  });
});

describe("Ajustes: peso", () => {
  it("apunta el peso de hoy, con coma decimal, y deja la grasa vacía", async () => {
    await renderSettings();
    const weight = region("Peso");
    expect((within(weight).getByLabelText("Fecha") as HTMLInputElement).value).toBe("2026-11-10");
    fireEvent.change(within(weight).getByLabelText("Peso (kg)"), { target: { value: "57,5" } });
    fireEvent.click(within(weight).getByRole("button", { name: "Guardar peso" }));

    expect(text(await within(weight).findByRole("status"))).toContain("Peso guardado.");
    expect(calls("PUT", "/api/body-metrics/2026-11-10")[0]?.body).toEqual({ weightKg: 57.5, bodyFatPct: null });
    expect((within(weight).getByLabelText("Peso (kg)") as HTMLInputElement).value).toBe("");
  });

  it("apunta el peso de otro día con el % de grasa", async () => {
    await renderSettings();
    const weight = region("Peso");
    fireEvent.change(within(weight).getByLabelText("Fecha"), { target: { value: "2026-11-03" } });
    fireEvent.change(within(weight).getByLabelText("Peso (kg)"), { target: { value: "74,3" } });
    fireEvent.change(within(weight).getByLabelText("% de grasa (opcional)"), { target: { value: "18,5" } });
    fireEvent.click(within(weight).getByRole("button", { name: "Guardar peso" }));

    await within(weight).findByRole("status");
    expect(calls("PUT", "/api/body-metrics/2026-11-03")[0]?.body).toEqual({ weightKg: 74.3, bodyFatPct: 18.5 });
  });

  it("no guarda sin peso ni con una grasa fuera de rango", async () => {
    await renderSettings();
    const weight = region("Peso");
    fireEvent.click(within(weight).getByRole("button", { name: "Guardar peso" }));
    expect(text(await within(weight).findByRole("alert"))).toContain("Escribe tu peso");

    fireEvent.change(within(weight).getByLabelText("Peso (kg)"), { target: { value: "70" } });
    fireEvent.change(within(weight).getByLabelText("% de grasa (opcional)"), { target: { value: "120" } });
    fireEvent.click(within(weight).getByRole("button", { name: "Guardar peso" }));
    expect(text(await within(weight).findByRole("alert"))).toContain("entre 0 y 100");
    expect(server.calls.some((call) => call.method === "PUT")).toBe(false);
  });

  it("si no se puede guardar el peso lo dice y conserva lo escrito", async () => {
    server.fails.set("PUT /api/body-metrics/2026-11-10", 500);
    await renderSettings();
    const weight = region("Peso");
    fireEvent.change(within(weight).getByLabelText("Peso (kg)"), { target: { value: "70" } });
    fireEvent.click(within(weight).getByRole("button", { name: "Guardar peso" }));
    expect(text(await within(weight).findByRole("alert"))).toContain("Fallo simulado 500");
    expect((within(weight).getByLabelText("Peso (kg)") as HTMLInputElement).value).toBe("70");
  });
});

describe("Ajustes: entreno pasado", () => {
  it("abre el formulario en la propia sección y se puede cancelar", async () => {
    await renderSettings();
    const past = region("Entreno pasado");
    expect(within(past).queryByLabelText("Duración (min)")).toBeNull();
    fireEvent.click(within(past).getByRole("button", { name: "Apuntar entreno pasado" }));

    expect(await within(past).findByLabelText("Duración (min)")).toBeTruthy();
    fireEvent.click(within(past).getByRole("button", { name: "Cancelar" }));
    expect(within(past).queryByLabelText("Duración (min)")).toBeNull();
    expect(within(past).getByRole("button", { name: "Apuntar entreno pasado" })).toBeTruthy();
  });
});

describe("Ajustes: entreno pasado sin rutinas", () => {
  it("si las rutinas no cargan se puede reintentar y también cerrar el formulario", async () => {
    server.fails.set("GET /api/routines", 500);
    await renderSettings();
    const past = region("Entreno pasado");
    fireEvent.click(within(past).getByRole("button", { name: "Apuntar entreno pasado" }));
    expect(await within(past).findByRole("alert")).toBeTruthy();
    expect(within(past).getByRole("button", { name: "Reintentar" })).toBeTruthy();

    fireEvent.click(within(past).getByRole("button", { name: "Cancelar" }));
    expect(within(past).getByRole("button", { name: "Apuntar entreno pasado" })).toBeTruthy();
  });
});

describe("Ajustes: datos", () => {
  function pickFile(text: string, name = "copia.json") {
    const input = screen.getByLabelText("Importar JSON");
    fireEvent.change(input, { target: { files: [new File([text], name, { type: "application/json" })] } });
  }

  it("exporta la copia como un archivo JSON con la fecha de hoy", async () => {
    const createObjectURL = vi.fn<(blob: Blob) => string>().mockReturnValue("blob:copia");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    try {
      await renderSettings();
      fireEvent.click(within(region("Datos")).getByRole("button", { name: "Exportar JSON" }));

      await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
      const anchor = click.mock.contexts[0] as HTMLAnchorElement;
      expect(anchor.download).toBe("gymvik-2026-11-10.json");
      expect(anchor.getAttribute("href")).toBe("blob:copia");
      const blob = createObjectURL.mock.calls[0]?.[0];
      expect(blob?.type).toBe("application/json");
      expect(JSON.parse(await (blob as Blob).text())).toEqual(server.backup);
      expect(calls("GET", "/api/backup")).toHaveLength(1);
    } finally {
      click.mockRestore();
    }
  });

  it("si no se puede exportar lo dice", async () => {
    server.offline.add("GET /api/backup");
    await renderSettings();
    fireEvent.click(within(region("Datos")).getByRole("button", { name: "Exportar JSON" }));
    expect(text(await within(region("Datos")).findByRole("alert"))).toContain("Sin conexión");
  });

  it("importar pide confirmación y no envía nada hasta que se acepta", async () => {
    await renderSettings();
    pickFile('{"version":1}');

    const sheet = await screen.findByRole("dialog", { name: "¿Importar esta copia?" });
    expect(text(sheet)).toContain("Se sustituirán todos tus datos");
    expect(text(sheet)).toContain("copia.json");
    expect(calls("POST", "/api/backup/import")).toHaveLength(0);

    fireEvent.click(within(sheet).getByRole("button", { name: "Sí, importar" }));
    await waitFor(() => expect(calls("POST", "/api/backup/import")).toHaveLength(1));
    // El archivo viaja tal cual, sin reescribirlo.
    expect(calls("POST", "/api/backup/import")[0]?.raw).toBe('{"version":1}');
  });

  it("cancelar la confirmación no importa nada", async () => {
    await renderSettings();
    pickFile('{"version":1}');
    const sheet = await screen.findByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(calls("POST", "/api/backup/import")).toHaveLength(0);
  });

  it("al importar con éxito cuenta lo importado y recarga ajustes, tema y copia sin conexión", async () => {
    await renderSettings();
    pickFile('{"version":1}');
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Sí, importar" }));

    const data = region("Datos");
    expect(text(await within(data).findByRole("status"))).toContain("Copia importada: 61 ejercicios, 4 rutinas y 12 entrenos.");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(refreshSnapshot).toHaveBeenCalled();

    // Los ajustes importados sustituyen a los que se veían, también el tema.
    server.settings = { ...server.settings, theme: "teal", weeklyGoal: 5 };
    const before = calls("GET", "/api/settings").length;
    pickFile('{"version":1}');
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Sí, importar" }));
    await waitFor(() => expect(calls("GET", "/api/settings").length).toBeGreaterThan(before));
    await waitFor(() => expect(screen.getByRole("button", { name: "Turquesa" }).getAttribute("aria-pressed")).toBe("true"));
    expect(document.documentElement.style.getPropertyValue("--accent")).toBe(THEMES.teal.light.accent);
    expect((within(region("Objetivos")).getByLabelText("Entrenos por semana") as HTMLInputElement).value).toBe("5");
  });

  it("si el archivo no vale enseña el error del servidor y no da nada por importado", async () => {
    await renderSettings();
    pickFile("esto no es JSON");
    const sheet = await screen.findByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: "Sí, importar" }));

    expect(text(await within(sheet).findByRole("alert"))).toContain("JSON no válido");
    expect(refreshSnapshot).not.toHaveBeenCalled();
    expect(within(region("Datos")).queryByText(/Copia importada/)).toBeNull();

    fireEvent.click(within(sheet).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("un 400 con datos que no cumplen el formato también se enseña", async () => {
    server.fails.set("POST /api/backup/import", 400);
    await renderSettings();
    pickFile('{"version":2}');
    const sheet = await screen.findByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: "Sí, importar" }));
    expect(text(await within(sheet).findByRole("alert"))).toContain("Fallo simulado 400");
  });

  it("elegir otra vez el mismo archivo vuelve a pedir confirmación", async () => {
    await renderSettings();
    pickFile('{"version":1}');
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancelar" }));
    expect((screen.getByLabelText("Importar JSON") as HTMLInputElement).value).toBe("");
    pickFile('{"version":1}');
    expect(await screen.findByRole("dialog", { name: "¿Importar esta copia?" })).toBeTruthy();
  });
});
