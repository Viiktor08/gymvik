// Lado de la página del service worker (src/web/sw.ts): registrarlo y, a petición, buscar una versión nueva.

const SW_URL = "/sw.js";
/** Cuánto se espera a que la versión nueva tome el control antes de recargar de todos modos. */
const ACTIVATION_TIMEOUT_MS = 4000;

/** Lo que se usa de `navigator.serviceWorker`; se puede sustituir en los tests. */
export interface ContainerLike extends EventTarget {
  getRegistration(): Promise<RegistrationLike | undefined>;
  register(url: string, options: { scope: string }): Promise<unknown>;
}

interface WorkerLike extends EventTarget {
  state: string;
  postMessage(message: unknown): void;
}

interface RegistrationLike {
  waiting: WorkerLike | null;
  installing: WorkerLike | null;
  update(): Promise<unknown>;
}

function browserContainer(): ContainerLike | undefined {
  return "serviceWorker" in navigator ? (navigator.serviceWorker as unknown as ContainerLike) : undefined;
}

type RegisterEnv = { enabled?: boolean; container?: ContainerLike | undefined; ready?: boolean };

/**
 * Registra el service worker cuando la página termina de cargar (para no competir con el primer pintado).
 * Solo en la versión compilada: en desarrollo (`vite dev`) no existe /sw.js. Se llama desde el código de la app y
 * no desde un script del HTML, que la CSP (`default-src 'self'`) no permitiría inline.
 */
export function registerServiceWorker({
  enabled = import.meta.env.PROD,
  container = browserContainer(),
  ready = document.readyState === "complete",
}: RegisterEnv = {}): void {
  if (!enabled || !container) return;
  const register = () => {
    container.register(SW_URL, { scope: "/" }).catch((failure: unknown) => {
      // Sin service worker la app sigue funcionando; solo faltan el modo sin conexión y los avisos.
      console.error("No se pudo registrar el service worker", failure);
    });
  };
  if (ready) register();
  else window.addEventListener("load", register, { once: true });
}

export type UpdateEnv = {
  container: ContainerLike | undefined;
  reload: () => void;
  activationTimeoutMs?: number;
};

/** `unavailable`: no hay service worker (desarrollo o navegador sin soporte). `current`: ya es la última. */
export type UpdateOutcome = "unavailable" | "current" | "reloading";

/** La versión nueva, cuando termina de instalarse; `null` si la instalación falla. */
function installed(worker: WorkerLike): Promise<WorkerLike | null> {
  return new Promise((resolve) => {
    const check = () => {
      if (worker.state !== "installed" && worker.state !== "redundant") return;
      worker.removeEventListener("statechange", check);
      resolve(worker.state === "installed" ? worker : null);
    };
    worker.addEventListener("statechange", check);
    check();
  });
}

/** Pide a la versión que espera que se active y aguarda a que tome el control de la página. */
function activate(container: ContainerLike, worker: WorkerLike, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      container.removeEventListener("controllerchange", done);
      resolve();
    };
    // Si el aviso de cambio no llega, se recarga igualmente: la versión nueva ya está activa en cuanto se pide.
    const timer = setTimeout(done, timeoutMs);
    container.addEventListener("controllerchange", done);
    worker.postMessage({ type: "SKIP_WAITING" });
  });
}

/**
 * Ajustes → Actualizar: busca una versión nueva del service worker (`registration.update()`) y, si la hay
 * (descargada o esperando), la activa y recarga la página. Si falla (sin red), lanza el error de `update()`.
 */
export async function checkForUpdate({
  container = browserContainer(),
  reload = () => location.reload(),
  activationTimeoutMs = ACTIVATION_TIMEOUT_MS,
}: Partial<UpdateEnv> = {}): Promise<UpdateOutcome> {
  const registration = await container?.getRegistration();
  if (!container || !registration) return "unavailable";

  await registration.update();
  // Tras update() la versión nueva puede estar ya esperando o todavía instalándose.
  const waiting = registration.waiting ?? (registration.installing ? await installed(registration.installing) : null);
  if (!waiting) return "current";

  await activate(container, waiting, activationTimeoutMs);
  reload();
  return "reloading";
}
