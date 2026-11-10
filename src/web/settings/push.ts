import { ApiError, api } from "../api";

/** Cuánto se espera al service worker antes de dar el servicio de avisos por no disponible. */
const READY_TIMEOUT_MS = 8000;

/** Un fallo que ya viene explicado para el usuario. */
export class PushSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PushSetupError";
  }
}

/** La clave pública VAPID llega en base64url; `applicationServerKey` la quiere en bytes. */
export function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** La app abierta desde el icono de la pantalla de inicio (Safari de iOS lo da en `navigator.standalone`). */
export function isInstalled(): boolean {
  const standalone = typeof matchMedia === "function" && matchMedia("(display-mode: standalone)").matches;
  return standalone || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** El navegador puede pedir permiso y suscribirse. En iOS solo ocurre con la app instalada. */
export function pushSupported(): boolean {
  return typeof Notification !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
}

/** ¿Este dispositivo ya tiene permiso y una suscripción activa? Cualquier fallo cuenta como que no. */
export async function hasSubscription(): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== "granted") return false;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    return (await registration?.pushManager.getSubscription()) != null;
  } catch {
    return false;
  }
}

/** Sin service worker registrado `ready` no se resuelve nunca: se espera un rato y se avisa. */
async function serviceWorkerReady(): Promise<ServiceWorkerRegistration> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new PushSetupError("La app aún no está lista para los avisos. Ciérrala, ábrela de nuevo e inténtalo otra vez.")),
      READY_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([navigator.serviceWorker.ready, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export type EnableOutcome = "enabled" | "denied" | "dismissed";

/**
 * Activa los avisos en este dispositivo: permiso → suscripción → servidor.
 * Hay que llamarla directamente desde el clic de un botón y sin esperar nada antes: iOS solo enseña el aviso
 * de permiso si `Notification.requestPermission()` sale del propio toque, así que es lo primero que se hace.
 */
export async function enablePush(): Promise<EnableOutcome> {
  const permission = await Notification.requestPermission();
  if (permission === "denied") return "denied";
  if (permission !== "granted") return "dismissed";

  const registration = await serviceWorkerReady();
  const { publicKey } = await api<{ publicKey: string }>("/api/push/public-key");
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  // PushSubscription.toJSON() es justo lo que espera el servidor: { endpoint, keys: { p256dh, auth } }.
  await api("/api/push/subscribe", { method: "POST", body: JSON.stringify(subscription) });
  return "enabled";
}

const OUTCOME_MESSAGES: Record<Exclude<EnableOutcome, "enabled">, string> = {
  denied:
    "Has bloqueado las notificaciones de Gymvik. Para activarlas, abre Ajustes de iOS, entra en Notificaciones, elige Gymvik y permite las notificaciones.",
  dismissed: "No se ha concedido el permiso. Pulsa otra vez el botón y acepta el aviso del sistema.",
};

/** Qué decirle al usuario cuando el permiso no se ha concedido. */
export function outcomeMessage(outcome: Exclude<EnableOutcome, "enabled">): string {
  return OUTCOME_MESSAGES[outcome];
}

/** Texto para el usuario ante un fallo al activar los avisos. Nunca enseña detalles técnicos. */
export function pushErrorMessage(failure: unknown): string {
  if (failure instanceof PushSetupError || failure instanceof ApiError) return failure.message;
  return "No se pudieron activar las notificaciones. Inténtalo de nuevo.";
}
