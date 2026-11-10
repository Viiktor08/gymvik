// Prueba el cableado de src/web/sw.ts (qué escucha y qué registra) cargándolo con `self` y Workbox simulados.
// La lógica de los avisos está en pushNotice.test.ts. Este archivo se comprueba con tsconfig.sw.json (lib de
// WebWorker): por eso se habla con los globales a través de `scope`, no de `window`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const workbox = vi.hoisted(() => {
  class FakeNavigationRoute {
    constructor(
      readonly handler: unknown,
      readonly options: { denylist?: RegExp[] },
    ) {}
  }
  return {
    precacheAndRoute: vi.fn(),
    cleanupOutdatedCaches: vi.fn(),
    createHandlerBoundToURL: vi.fn((url: string) => ({ boundTo: url })),
    registerRoute: vi.fn(),
    clientsClaim: vi.fn(),
    FakeNavigationRoute,
  };
});

vi.mock("workbox-precaching", () => ({
  precacheAndRoute: workbox.precacheAndRoute,
  cleanupOutdatedCaches: workbox.cleanupOutdatedCaches,
  createHandlerBoundToURL: workbox.createHandlerBoundToURL,
}));
vi.mock("workbox-routing", () => ({ registerRoute: workbox.registerRoute, NavigationRoute: workbox.FakeNavigationRoute }));
vi.mock("workbox-core", () => ({ clientsClaim: workbox.clientsClaim }));

type Listener = (event: unknown) => void;

const scope = globalThis as unknown as Record<string, unknown> & {
  addEventListener: (type: string, listener: Listener) => void;
};
const MANIFEST = [{ url: "index.html", revision: "abc" }, { url: "assets/app-1.js", revision: null }];
const GLOBALS = ["__WB_MANIFEST", "skipWaiting", "registration", "clients"] as const;

let listeners: Map<string, Listener>;
const skipWaiting = vi.fn(async () => undefined);
const showNotification = vi.fn(async () => undefined);
const matchAll = vi.fn(async () => []);
const openWindow = vi.fn(async () => null);

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  listeners = new Map();
  vi.spyOn(scope, "addEventListener").mockImplementation((type, listener) => {
    listeners.set(type, listener);
  });
  scope.__WB_MANIFEST = MANIFEST;
  scope.skipWaiting = skipWaiting;
  scope.registration = { showNotification };
  scope.clients = { matchAll, openWindow };
  await import("../../src/web/sw");
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const name of GLOBALS) delete scope[name];
});

function listener(type: string): Listener {
  const found = listeners.get(type);
  if (!found) throw new Error(`El service worker no escucha "${type}"`);
  return found;
}

/** Un evento extensible: guarda lo que se le pasa a `waitUntil` para poder esperarlo. */
function extendable(extra: Record<string, unknown>) {
  const waiting: Promise<unknown>[] = [];
  return {
    event: { waitUntil: vi.fn((promise: Promise<unknown>) => void waiting.push(promise)), ...extra },
    settled: () => Promise.all(waiting),
  };
}

describe("service worker: precaché y navegación", () => {
  it("precachea el esqueleto que inyecta la compilación y limpia las versiones antiguas", () => {
    expect(workbox.precacheAndRoute).toHaveBeenCalledExactlyOnceWith(MANIFEST);
    expect(workbox.cleanupOutdatedCaches).toHaveBeenCalledOnce();
  });

  it("las navegaciones sin red caen en index.html, salvo las de /api/", () => {
    expect(workbox.createHandlerBoundToURL).toHaveBeenCalledExactlyOnceWith("/index.html");
    expect(workbox.registerRoute).toHaveBeenCalledOnce();
    const route = workbox.registerRoute.mock.calls[0]?.[0] as InstanceType<typeof workbox.FakeNavigationRoute>;
    expect(route).toBeInstanceOf(workbox.FakeNavigationRoute);
    expect(route.handler).toEqual({ boundTo: "/index.html" });

    const denied = (path: string) => route.options.denylist?.some((pattern) => pattern.test(path)) ?? false;
    for (const path of ["/api/today", "/api/backup", "/api/auth/me"]) expect(denied(path), path).toBe(true);
    for (const path of ["/", "/entreno/sesion", "/ajustes", "/ejercicio/abc", "/apiario"]) expect(denied(path), path).toBe(false);
  });

  it("no intercepta ninguna petición más: /api/* va siempre a la red y no se cachea", () => {
    // Sin escuchar `fetch` ni registrar otras rutas, solo responde el precaché (rutas exactas del esqueleto).
    expect(listeners.has("fetch")).toBe(false);
    expect(workbox.registerRoute).toHaveBeenCalledOnce();
  });

  it("toma el control de las pestañas abiertas al activarse", () => {
    expect(workbox.clientsClaim).toHaveBeenCalledOnce();
  });

  it("no se salta la espera por su cuenta: la versión nueva espera a que se pida desde Ajustes", () => {
    expect(skipWaiting).not.toHaveBeenCalled();
  });
});

describe("service worker: actualización", () => {
  it("SKIP_WAITING activa la versión que esperaba", () => {
    listener("message")({ data: { type: "SKIP_WAITING" } });
    expect(skipWaiting).toHaveBeenCalledOnce();
  });

  it("cualquier otro mensaje se ignora", () => {
    const handler = listener("message");
    handler({ data: { type: "OTRA_COSA" } });
    handler({ data: "SKIP_WAITING" });
    handler({ data: null });
    handler({});
    expect(skipWaiting).not.toHaveBeenCalled();
  });
});

describe("service worker: push", () => {
  it("enseña el aviso del servidor con su cuerpo y la ruta que abrirá", async () => {
    const body = JSON.stringify({ type: "today", title: "Gymvik", body: "Hoy toca Pecho (6 ejercicios)", url: "/" });
    const { event, settled } = extendable({ data: { json: () => JSON.parse(body) as unknown, text: () => body } });
    listener("push")(event);
    await settled();
    expect(showNotification).toHaveBeenCalledExactlyOnceWith("Gymvik", {
      body: "Hoy toca Pecho (6 ejercicios)",
      data: { url: "/" },
    });
    // El worker no puede cerrarse antes de que el aviso salga.
    expect(event.waitUntil).toHaveBeenCalledOnce();
  });

  it("un push sin datos enseña igualmente un aviso", async () => {
    const { event, settled } = extendable({ data: null });
    listener("push")(event);
    await settled();
    expect(showNotification).toHaveBeenCalledExactlyOnceWith("Gymvik", {
      body: "Tienes un aviso nuevo.",
      data: { url: "/" },
    });
  });
});

describe("service worker: tocar un aviso", () => {
  it("cierra el aviso y abre la app en la ruta guardada", async () => {
    const close = vi.fn();
    const { event, settled } = extendable({ notification: { close, data: { url: "/progreso" } } });
    listener("notificationclick")(event);
    await settled();
    expect(close).toHaveBeenCalledOnce();
    expect(matchAll).toHaveBeenCalledWith({ type: "window", includeUncontrolled: true });
    expect(openWindow).toHaveBeenCalledExactlyOnceWith(`${location.origin}/progreso`);
    expect(event.waitUntil).toHaveBeenCalledOnce();
  });

  it("un aviso sin ruta (o con una de otro sitio) abre Hoy", async () => {
    for (const data of [undefined, null, {}, { url: "https://otro.example/" }]) {
      openWindow.mockClear();
      const { event, settled } = extendable({ notification: { close: vi.fn(), data } });
      listener("notificationclick")(event);
      await settled();
      expect(openWindow).toHaveBeenCalledExactlyOnceWith(`${location.origin}/`);
    }
  });
});
