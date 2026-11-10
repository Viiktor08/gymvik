import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "../../src/shared/types";
import { ApiError } from "../../src/web/api";
import { App } from "../../src/web/App";
import { THEMES } from "../../src/web/theme";

const webauthn = vi.hoisted(() => ({
  registerFirstPasskey: vi.fn(),
  registerPasskey: vi.fn(),
  signInWithPasskey: vi.fn(),
}));

vi.mock("../../src/web/webauthn", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/web/webauthn")>()),
  ...webauthn,
}));

type Me = { authenticated: boolean; setupRequired: boolean };

const CODES = Array.from({ length: 8 }, (_, i) => `aaaa-bbbb-cccc-${String(1000 + i)}`);

/**
 * Los ajustes tal como los devuelve `GET /api/settings`: siempre completos (con `notifications`). Una respuesta a
 * medias hacía fallar al azar la pantalla de Ajustes cuando llegaba mientras el test seguía comprobando.
 */
function completeSettings(): Settings {
  return {
    displayName: "Victor",
    theme: "blue",
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
}

type StoredPasskey = { id: string; label: string; createdAt: string; transports: string[] };

const LOST_PHONE: StoredPasskey = { id: "cred-perdido", label: "iPhone perdido", createdAt: "2026-10-02T10:00:00.000Z", transports: [] };
const OLD_IPAD: StoredPasskey = { id: "cred-ipad", label: "", createdAt: "2026-10-20T10:00:00.000Z", transports: [] };

const server = {
  me: { authenticated: false, setupRequired: false } as Me,
  /** Las passkeys que hay en el servidor; `null` hace fallar el listado. */
  passkeys: [LOST_PHONE] as StoredPasskey[] | null,
  /** "hang": la petición no responde ni falla hasta que se aborta, como una señal que no llega. */
  meFails: null as "offline" | "hang" | 500 | 401 | 403 | null,
  settings: completeSettings(),
};

const fetchMock = vi.fn<typeof fetch>();

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function signIn() {
  server.me = { authenticated: true, setupRequired: false };
}

async function handle(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const path = String(input);
  const method = init?.method ?? "GET";
  if (path === "/api/auth/me") {
    if (server.meFails === "offline") throw new TypeError("Failed to fetch");
    if (server.meFails === "hang") {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Abortado", "AbortError")));
      });
    }
    if (typeof server.meFails === "number") return json(server.meFails, { error: "Error simulado" });
    return json(200, server.me);
  }
  if (path === "/api/settings") return json(200, server.settings);
  if (path === "/api/auth/recover" && method === "POST") {
    const { code } = JSON.parse(String(init?.body)) as { code: string };
    if (code !== "aaaa-bbbb-cccc-dddd") return json(401, { error: "Código de recuperación no válido" });
    // Como el servidor real: el código abre la sesión, pero la app no se entera hasta volver a preguntar a /me.
    signIn();
    return json(200, { mustRegisterPasskey: true });
  }
  if (path === "/api/auth/passkeys" && method === "GET") {
    return server.passkeys === null ? json(500, { error: "Error interno" }) : json(200, { passkeys: server.passkeys });
  }
  if (path.startsWith("/api/auth/passkeys/") && method === "DELETE") {
    const stored = server.passkeys ?? [];
    if (stored.length <= 1) return json(409, { error: "No puedes borrar tu única passkey" });
    const id = decodeURIComponent(path.slice("/api/auth/passkeys/".length));
    server.passkeys = stored.filter((passkey) => passkey.id !== id);
    return json(200, { ok: true });
  }
  return json(404, { error: "No encontrado" });
}

/**
 * Avisa de cuándo la app se suscribe a `type` en `target`. Los efectos de React (donde la app se suscribe) corren
 * después de que el DOM ya cambió, así que un test que lanza el evento nada más ver la pantalla puede adelantarse a la
 * suscripción y el evento se pierde. Hay que llamarla antes de pintar; devuelve la espera.
 */
function whenSubscribed(target: EventTarget, type: string): () => Promise<void> {
  const added = vi.spyOn(target, "addEventListener");
  return () => waitFor(() => expect(added.mock.calls.some(([name]) => name === type)).toBe(true));
}

function renderAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <App />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  server.me = { authenticated: false, setupRequired: false };
  server.meFails = null;
  server.passkeys = [LOST_PHONE];
  server.settings = completeSettings();
  fetchMock.mockReset();
  fetchMock.mockImplementation(handle);
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("location", { pathname: "/", assign: vi.fn() });
  document.documentElement.removeAttribute("style");
  webauthn.registerFirstPasskey.mockReset();
  webauthn.registerPasskey.mockReset();
  webauthn.signInWithPasskey.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("primer arranque y acceso", () => {
  it("con setupRequired lleva a /setup desde cualquier ruta", async () => {
    server.me = { authenticated: false, setupRequired: true };
    renderAt("/entreno");
    expect(await screen.findByRole("heading", { name: "Primera configuración" })).toBeTruthy();
  });

  it("con setupRequired, /login también lleva a /setup", async () => {
    server.me = { authenticated: false, setupRequired: true };
    renderAt("/login");
    expect(await screen.findByRole("heading", { name: "Primera configuración" })).toBeTruthy();
  });

  it("sin sesión lleva a /login", async () => {
    renderAt("/");
    expect(await screen.findByRole("button", { name: "Entrar con passkey" })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Principal" })).toBeNull();
  });

  it.each([
    ["/login", "Entrar con passkey"],
    ["/recuperar", "Continuar"],
  ])("sin sesión deja ver %s, sin la barra de pestañas", async (path, button) => {
    renderAt(path);
    expect(await screen.findByRole("button", { name: button })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Principal" })).toBeNull();
  });

  it("con sesión muestra Hoy, las tres pestañas y el icono de Ajustes", async () => {
    signIn();
    renderAt("/");
    expect(await screen.findByRole("heading", { name: "Hoy" })).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "Principal" });
    expect(within(nav).getAllByRole("link").map((link) => link.textContent)).toEqual(["Hoy", "Entreno", "Progreso"]);
    expect(screen.getByRole("link", { name: "Ajustes" }).getAttribute("href")).toBe("/ajustes");
  });

  it("con sesión, /login y /setup llevan a Hoy", async () => {
    signIn();
    const view = renderAt("/login");
    expect(await screen.findByRole("heading", { name: "Hoy" })).toBeTruthy();
    view.unmount();
    renderAt("/setup");
    expect(await screen.findByRole("heading", { name: "Hoy" })).toBeTruthy();
  });

  it("una ruta desconocida lleva a Hoy", async () => {
    signIn();
    renderAt("/no-existe");
    expect(await screen.findByRole("heading", { name: "Hoy" })).toBeTruthy();
  });

  it("aplica el tema de los ajustes", async () => {
    signIn();
    renderAt("/");
    await screen.findByRole("heading", { name: "Hoy" });
    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue("--accent")).toBe(THEMES.blue.light.accent);
    });
  });

  it("sin red deja entrar en la app (la sesión en directo funciona sin conexión)", async () => {
    server.meFails = "offline";
    renderAt("/");
    expect(await screen.findByRole("heading", { name: "Hoy" })).toBeTruthy();
  });

  it("con un error del servidor en /me deja entrar igualmente: no bloquea la app, ni la sesión en directo", async () => {
    server.meFails = 500;
    renderAt("/");
    expect(await screen.findByRole("heading", { name: "Hoy" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Principal" })).toBeTruthy();
  });

  it("con un error del servidor, también se puede abrir la sesión directamente", async () => {
    server.meFails = 500;
    renderAt("/entreno/sesion");
    expect(await screen.findByRole("heading", { name: "Entreno en curso" })).toBeTruthy();
  });

  it("tras un error del servidor, al volver la red comprueba de verdad la sesión y lleva a /login si no vale", async () => {
    const subscribed = whenSubscribed(window, "online");
    server.meFails = 500;
    renderAt("/");
    await screen.findByRole("heading", { name: "Hoy" });
    await subscribed();

    server.meFails = null;
    server.me = { authenticated: false, setupRequired: false };
    window.dispatchEvent(new Event("online"));

    expect(await screen.findByRole("button", { name: "Entrar con passkey" })).toBeTruthy();
  });

  it("tras un error del servidor, al volver a la app desde segundo plano también la comprueba", async () => {
    const subscribed = whenSubscribed(document, "visibilitychange");
    server.meFails = 500;
    renderAt("/");
    await screen.findByRole("heading", { name: "Hoy" });
    await subscribed();

    server.meFails = null;
    server.me = { authenticated: false, setupRequired: false };
    document.dispatchEvent(new Event("visibilitychange"));

    expect(await screen.findByRole("button", { name: "Entrar con passkey" })).toBeTruthy();
  });

  it("un 401 de /me sí lleva a /login", async () => {
    server.meFails = 401;
    renderAt("/");
    expect(await screen.findByRole("button", { name: "Entrar con passkey" })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Principal" })).toBeNull();
  });

  it("otro error del cliente (403) sigue enseñando el error con Reintentar", async () => {
    server.meFails = 403;
    renderAt("/");
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Principal" })).toBeNull();

    server.meFails = null;
    signIn();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("heading", { name: "Hoy" })).toBeTruthy();
  });

  describe("si /me no responde ni falla", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("a los 5 s se aborta y deja entrar, como sin red; antes, sigue la pantalla de carga", async () => {
      // Solo se falsean los temporizadores; el tiempo avanza solo para que Testing Library siga sondeando.
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
      server.meFails = "hang";
      renderAt("/");

      expect(screen.getByText("Cargando…")).toBeTruthy();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4_500);
      });
      expect(screen.getByText("Cargando…")).toBeTruthy();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      expect(await screen.findByRole("heading", { name: "Hoy" })).toBeTruthy();
      expect(screen.getByRole("navigation", { name: "Principal" })).toBeTruthy();
    });

    it("una vez dentro, al volver la red comprueba la sesión", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
      server.meFails = "hang";
      renderAt("/");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_500);
      });
      await screen.findByRole("heading", { name: "Hoy" });

      server.meFails = null;
      server.me = { authenticated: false, setupRequired: false };
      window.dispatchEvent(new Event("online"));

      expect(await screen.findByRole("button", { name: "Entrar con passkey" })).toBeTruthy();
    });
  });
});

describe("rutas de la app", () => {
  it.each([
    ["/", "Hoy"],
    ["/entreno", "Entreno"],
    ["/entreno/rutina/abc", "Rutina"],
    ["/entreno/sesion", "Entreno en curso"],
    ["/entreno/historial", "Historial"],
    ["/entreno/historial/abc", "Entreno"],
    ["/entreno/biblioteca", "Biblioteca"],
    ["/ejercicio/abc", "Ejercicio"],
    ["/progreso?tab=semana", "Progreso"],
    ["/ajustes", "Ajustes"],
    ["/ajustes/atajos", "Atajos y NFC"],
  ])("%s muestra «%s»", async (path, heading) => {
    signIn();
    renderAt(path);
    expect(await screen.findByRole("heading", { name: heading })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Principal" })).toBeTruthy();
  });

  it.each([
    ["/", "Hoy"],
    ["/entreno/historial", "Entreno"],
    ["/ejercicio/abc", "Entreno"],
    ["/progreso", "Progreso"],
  ])("en %s la pestaña activa es %s", async (path, tab) => {
    signIn();
    renderAt(path);
    await screen.findByRole("navigation", { name: "Principal" });
    const current = screen.getAllByRole("link").filter((link) => link.getAttribute("aria-current") === "page");
    expect(current.map((link) => link.textContent)).toEqual([tab]);
  });
});

describe("Setup", () => {
  beforeEach(() => {
    server.me = { authenticated: false, setupRequired: true };
  });

  it("sin token explica cómo abrir el enlace y no deja registrar", async () => {
    renderAt("/setup");
    expect(await screen.findByText(/Falta el token de configuración/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Crear passkey" })).toBeNull();
  });

  it("registra la passkey con el token y muestra los 8 códigos hasta pulsar «Los he guardado»", async () => {
    webauthn.registerFirstPasskey.mockImplementation(async () => {
      signIn();
      return CODES;
    });
    renderAt("/setup?token=tok-123");
    fireEvent.click(await screen.findByRole("button", { name: "Crear passkey" }));

    expect(await screen.findByRole("heading", { name: "Guarda tus códigos de recuperación" })).toBeTruthy();
    expect(webauthn.registerFirstPasskey).toHaveBeenCalledExactlyOnceWith("tok-123");
    const codes = screen.getAllByRole("listitem").map((item) => item.textContent);
    expect(codes).toEqual(CODES);
    // La sesión ya está abierta, pero la pantalla no se va hasta confirmarlo.
    expect(screen.queryByRole("heading", { name: "Hoy" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Los he guardado" }));
    expect(await screen.findByRole("heading", { name: "Hoy" })).toBeTruthy();
  });

  it("copia los códigos al portapapeles", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    webauthn.registerFirstPasskey.mockImplementation(async () => {
      signIn();
      return CODES;
    });
    renderAt("/setup?token=tok");
    fireEvent.click(await screen.findByRole("button", { name: "Crear passkey" }));
    fireEvent.click(await screen.findByRole("button", { name: "Copiar códigos" }));
    expect(writeText).toHaveBeenCalledWith(CODES.join("\n"));
    expect(await screen.findByText("Copiados")).toBeTruthy();
  });

  it("enseña el error del servidor y deja reintentar", async () => {
    webauthn.registerFirstPasskey.mockRejectedValue(new ApiError(403, "Token de configuración no válido"));
    renderAt("/setup?token=mal");
    fireEvent.click(await screen.findByRole("button", { name: "Crear passkey" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Token de configuración no válido");
    expect((screen.getByRole("button", { name: "Crear passkey" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("no deja pulsar dos veces mientras registra", async () => {
    let finish: (codes: string[]) => void = () => undefined;
    webauthn.registerFirstPasskey.mockReturnValue(new Promise<string[]>((resolve) => (finish = resolve)));
    renderAt("/setup?token=tok");
    fireEvent.click(await screen.findByRole("button", { name: "Crear passkey" }));
    const busy = (await screen.findByRole("button", { name: "Creando…" })) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    finish(CODES);
    expect(await screen.findByRole("heading", { name: "Guarda tus códigos de recuperación" })).toBeTruthy();
  });
});

describe("Login", () => {
  it("entra con la passkey y lleva a Hoy", async () => {
    webauthn.signInWithPasskey.mockImplementation(async () => signIn());
    renderAt("/login");
    fireEvent.click(await screen.findByRole("button", { name: "Entrar con passkey" }));
    expect(await screen.findByRole("heading", { name: "Hoy" })).toBeTruthy();
    expect(webauthn.signInWithPasskey).toHaveBeenCalledTimes(1);
  });

  it("si se cancela la verificación lo dice y se puede reintentar", async () => {
    webauthn.signInWithPasskey.mockRejectedValue(new DOMException("x", "NotAllowedError"));
    renderAt("/login");
    fireEvent.click(await screen.findByRole("button", { name: "Entrar con passkey" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/cancelado/);
    expect((screen.getByRole("button", { name: "Entrar con passkey" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("enlaza con la recuperación", async () => {
    renderAt("/login");
    const link = await screen.findByRole("link", { name: /código de recuperación/i });
    expect(link.getAttribute("href")).toBe("/recuperar");
  });
});

describe("Recuperar", () => {
  async function enterCode() {
    fireEvent.change(await screen.findByLabelText("Código de recuperación"), {
      target: { value: "aaaa-bbbb-cccc-dddd" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    return screen.findByRole("heading", { name: "Registra una passkey nueva" });
  }

  /** Lo que hace `registerPasskey` de verdad: el servidor guarda la passkey de este dispositivo. */
  function createsPasskey() {
    webauthn.registerPasskey.mockImplementationOnce(async () => {
      server.passkeys = [...(server.passkeys ?? []), { id: "cred-nueva", label: "iPhone nuevo", createdAt: "2026-11-10T10:00:00.000Z", transports: [] }];
    });
  }

  it("con un código válido pasa a registrar una passkey nueva y, al crearla, a Passkey creada", async () => {
    createsPasskey();
    renderAt("/recuperar");
    await enterCode();
    expect(webauthn.registerPasskey).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Crear passkey" }));

    expect(await screen.findByRole("heading", { name: "Passkey creada" })).toBeTruthy();
    expect(webauthn.registerPasskey).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(await screen.findByRole("heading", { name: "Hoy" })).toBeTruthy();
  });

  it("tras aceptar el código lista las passkeys que ya había, para quitar la del dispositivo perdido", async () => {
    server.passkeys = [LOST_PHONE, OLD_IPAD];
    renderAt("/recuperar");
    await enterCode();

    expect(await screen.findByText("iPhone perdido")).toBeTruthy();
    expect(screen.getByText("Passkey sin nombre")).toBeTruthy();
    expect(screen.getByText("Añadida el 2 oct 2026")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Quitar passkey iPhone perdido" }));
    const sheet = await screen.findByRole("dialog", { name: "¿Quitar esta passkey?" });
    expect(within(sheet).getByText(/se cerrará la sesión en los demás dispositivos/i)).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("button", { name: "Sí, quitar" }));

    await waitFor(() => expect(screen.queryByText("iPhone perdido")).toBeNull());
    expect(screen.getByText("Passkey sin nombre")).toBeTruthy();
    expect(fetchMock.mock.calls.some(([path, init]) => path === "/api/auth/passkeys/cred-perdido" && init?.method === "DELETE")).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("antes de crear la nueva, la única passkey no se puede quitar y lo explica", async () => {
    renderAt("/recuperar");
    await enterCode();

    fireEvent.click(await screen.findByRole("button", { name: "Quitar passkey iPhone perdido" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Sí, quitar" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/única passkey/);
    expect(screen.getAllByText("iPhone perdido").length).toBeGreaterThan(0);
  });

  it("al crear la passkey nueva vuelve a listar y deja quitar la vieja antes de continuar", async () => {
    createsPasskey();
    renderAt("/recuperar");
    await enterCode();
    await screen.findByText("iPhone perdido");
    fireEvent.click(screen.getByRole("button", { name: "Crear passkey" }));

    expect(await screen.findByRole("heading", { name: "Passkey creada" })).toBeTruthy();
    expect(await screen.findByText("iPhone nuevo")).toBeTruthy();
    expect(screen.getByText("iPhone perdido")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Quitar passkey iPhone perdido" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Sí, quitar" }));
    await waitFor(() => expect(screen.queryByText("iPhone perdido")).toBeNull());
    expect(screen.getByText("iPhone nuevo")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(await screen.findByRole("heading", { name: "Hoy" })).toBeTruthy();
  });

  it("si las passkeys no se pueden listar no estorba: se crea la nueva y se continúa", async () => {
    server.passkeys = null;
    webauthn.registerPasskey.mockImplementationOnce(async () => undefined);
    renderAt("/recuperar");
    await enterCode();
    fireEvent.click(screen.getByRole("button", { name: "Crear passkey" }));

    expect(await screen.findByRole("heading", { name: "Passkey creada" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(await screen.findByRole("heading", { name: "Hoy" })).toBeTruthy();
  });

  it("si crear la passkey falla, ofrece Continuar sin passkey, que lleva a Hoy", async () => {
    webauthn.registerPasskey.mockRejectedValueOnce(new DOMException("x", "NotAllowedError"));
    renderAt("/recuperar");
    await enterCode();
    // Mientras no haya fallado nada, la salida no estorba.
    expect(screen.queryByRole("link", { name: "Continuar sin passkey" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Crear passkey" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/cancelado/);
    fireEvent.click(screen.getByRole("link", { name: "Continuar sin passkey" }));

    expect(await screen.findByRole("heading", { name: "Hoy" })).toBeTruthy();
  });

  it("con un código no válido enseña el error y se queda en el formulario", async () => {
    renderAt("/recuperar");
    fireEvent.change(await screen.findByLabelText("Código de recuperación"), { target: { value: "zzzz-zzzz-zzzz-zzzz" } });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Código de recuperación no válido");
    expect(screen.getByLabelText("Código de recuperación")).toBeTruthy();
  });

  it("no envía un código vacío", async () => {
    renderAt("/recuperar");
    fireEvent.click(await screen.findByRole("button", { name: "Continuar" }));
    expect(fetchMock.mock.calls.some(([path]) => path === "/api/auth/recover")).toBe(false);
  });

  it("si falla el registro de la passkey deja reintentar sin volver a pedir el código", async () => {
    webauthn.registerPasskey.mockRejectedValueOnce(new DOMException("x", "NotAllowedError"));
    renderAt("/recuperar");
    fireEvent.change(await screen.findByLabelText("Código de recuperación"), {
      target: { value: "aaaa-bbbb-cccc-dddd" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Crear passkey" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/cancelado/);

    webauthn.registerPasskey.mockImplementationOnce(async () => undefined);
    fireEvent.click(screen.getByRole("button", { name: "Crear passkey" }));
    expect(await screen.findByRole("heading", { name: "Passkey creada" })).toBeTruthy();
  });
});
