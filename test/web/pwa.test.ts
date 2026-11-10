import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkForUpdate, registerServiceWorker, type UpdateEnv } from "../../src/web/pwa";

type State = "installing" | "installed" | "activating" | "activated" | "redundant";

class FakeWorker extends EventTarget {
  state: State;
  postMessage = vi.fn();
  constructor(state: State) {
    super();
    this.state = state;
  }
  moveTo(state: State) {
    this.state = state;
    this.dispatchEvent(new Event("statechange"));
  }
}

class FakeContainer extends EventTarget {
  registration: FakeRegistration | undefined;
  getRegistration = vi.fn(async () => this.registration);
  register = vi.fn(async () => undefined);
  /** El service worker nuevo toma el control de la página. */
  takeControl() {
    this.dispatchEvent(new Event("controllerchange"));
  }
}

class FakeRegistration {
  waiting: FakeWorker | null = null;
  installing: FakeWorker | null = null;
  /** Qué ocurre al comprobar si hay versión nueva; por defecto, nada (sigue la que hay). */
  onUpdate: () => void = () => undefined;
  update = vi.fn(async () => {
    this.onUpdate();
  });
}

function setup(withRegistration = true) {
  const container = new FakeContainer();
  const registration = new FakeRegistration();
  if (withRegistration) container.registration = registration;
  const reload = vi.fn();
  const env: UpdateEnv = { container, reload };
  return { container, registration, reload, env };
}

describe("checkForUpdate", () => {
  it("sin soporte de service workers no hay nada que actualizar", async () => {
    const reload = vi.fn();
    await expect(checkForUpdate({ container: undefined, reload })).resolves.toBe("unavailable");
    expect(reload).not.toHaveBeenCalled();
  });

  it("sin service worker registrado (por ejemplo, en desarrollo) no hay nada que actualizar", async () => {
    const { env, reload } = setup(false);
    await expect(checkForUpdate(env)).resolves.toBe("unavailable");
    expect(reload).not.toHaveBeenCalled();
  });

  it("llama a registration.update() y, si no hay versión nueva, lo dice sin recargar", async () => {
    const { env, registration, reload } = setup();
    await expect(checkForUpdate(env)).resolves.toBe("current");
    expect(registration.update).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
  });

  it("si no se puede comprobar (sin red) el fallo llega a quien llama y no recarga", async () => {
    const { env, registration, reload } = setup();
    registration.update.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(checkForUpdate(env)).rejects.toThrow("Failed to fetch");
    expect(reload).not.toHaveBeenCalled();
  });

  it("con una versión ya descargada y esperando la activa y recarga cuando toma el control", async () => {
    const { env, container, registration, reload } = setup();
    const waiting = new FakeWorker("installed");
    registration.waiting = waiting;

    const result = checkForUpdate(env);
    await vi.waitFor(() => expect(waiting.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" }));
    expect(reload).not.toHaveBeenCalled();

    container.takeControl();
    await expect(result).resolves.toBe("reloading");
    expect(reload).toHaveBeenCalledOnce();
  });

  it("si la versión nueva se está instalando espera a que termine antes de activarla", async () => {
    const { env, container, registration, reload } = setup();
    const installing = new FakeWorker("installing");
    registration.onUpdate = () => {
      registration.installing = installing;
    };

    const result = checkForUpdate(env);
    await vi.waitFor(() => expect(registration.update).toHaveBeenCalled());
    // Mientras se descarga no se activa nada.
    await Promise.resolve();
    expect(installing.postMessage).not.toHaveBeenCalled();

    registration.installing = null;
    registration.waiting = installing;
    installing.moveTo("installed");
    await vi.waitFor(() => expect(installing.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" }));

    container.takeControl();
    await expect(result).resolves.toBe("reloading");
    expect(reload).toHaveBeenCalledOnce();
  });

  it("si la instalación de la versión nueva falla se queda como está", async () => {
    const { env, registration, reload } = setup();
    const installing = new FakeWorker("installing");
    registration.onUpdate = () => {
      registration.installing = installing;
    };

    const result = checkForUpdate(env);
    await vi.waitFor(() => expect(registration.update).toHaveBeenCalled());
    installing.moveTo("redundant");
    await expect(result).resolves.toBe("current");
    expect(installing.postMessage).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  describe("si el cambio de versión no llega a notificarse", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("recarga pasado un rato en lugar de dejar el botón esperando para siempre", async () => {
      const { env, registration, reload } = setup();
      const waiting = new FakeWorker("installed");
      registration.waiting = waiting;

      const result = checkForUpdate({ ...env, activationTimeoutMs: 3000 });
      await vi.advanceTimersByTimeAsync(2999);
      expect(reload).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await expect(result).resolves.toBe("reloading");
      expect(reload).toHaveBeenCalledOnce();
    });
  });
});

describe("registerServiceWorker", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registra /sw.js con alcance en toda la app cuando la página ya ha cargado", () => {
    const { container } = setup();
    registerServiceWorker({ enabled: true, container, ready: true });
    expect(container.register).toHaveBeenCalledExactlyOnceWith("/sw.js", { scope: "/" });
  });

  it("espera a que la página termine de cargar para no competir con el primer pintado", () => {
    const { container } = setup();
    registerServiceWorker({ enabled: true, container, ready: false });
    expect(container.register).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("load"));
    expect(container.register).toHaveBeenCalledOnce();
  });

  it("en desarrollo no registra nada: allí no hay /sw.js", () => {
    const { container } = setup();
    registerServiceWorker({ enabled: false, container, ready: true });
    expect(container.register).not.toHaveBeenCalled();
  });

  it("en un navegador sin service workers no hace nada ni falla", () => {
    expect(() => registerServiceWorker({ enabled: true, container: undefined, ready: true })).not.toThrow();
  });

  it("si el registro falla lo deja en la consola y la app sigue", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { container } = setup();
    container.register.mockRejectedValueOnce(new Error("sin permiso"));
    registerServiceWorker({ enabled: true, container, ready: true });
    await vi.waitFor(() => expect(error).toHaveBeenCalledOnce());
  });
});
