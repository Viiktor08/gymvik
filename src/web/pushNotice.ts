// Lógica de los avisos push que usa el service worker (src/web/sw.ts). Está aparte, sin tocar los globales del
// worker, para poder probarla desde jsdom: el worker solo conecta estas funciones con sus eventos.

const APP_NAME = "Gymvik";
const GENERIC_BODY = "Tienes un aviso nuevo.";

/** Lo que el worker lee de `event.data` (un `PushMessageData`). */
export interface PushDataLike {
  json(): unknown;
  text(): string;
}

/** El aviso listo para `registration.showNotification(title, options)`. */
export interface Notice {
  title: string;
  /** Sin `tag`: `type` no sirve de etiqueta, el aviso de prueba usa `today` y taparía el de verdad. */
  options: { body?: string; data: { url: string } };
}

// Origen de mentira para comprobar que una ruta no se sale de la app al interpretarla como URL.
const PROBE_ORIGIN = "https://gymvik.invalid";

/** Una ruta dentro de la app; cualquier otra cosa (otro sitio, `javascript:`, vacío) lleva a Hoy. */
export function safeTarget(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/")) return "/";
  try {
    // El analizador de URL ignora tabuladores y saltos de línea: "/\t/otro.example" acabaría siendo "//otro.example".
    return new URL(value, PROBE_ORIGIN).origin === PROBE_ORIGIN ? value : "/";
  } catch {
    return "/";
  }
}

function nonBlank(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function readText(data: PushDataLike): string | undefined {
  try {
    return nonBlank(data.text());
  } catch {
    return undefined;
  }
}

/**
 * Convierte el cuerpo del push (`{ type, title, body, url }`, ver `PushMessage`) en el aviso que se enseña.
 * Siempre devuelve algo que mostrar: iOS retira la suscripción de una web que recibe un push sin aviso visible,
 * así que un cuerpo ilegible o vacío da un aviso genérico en lugar de nada.
 */
export function noticeFromPush(data: PushDataLike | null): Notice {
  const generic: Notice = { title: APP_NAME, options: { body: GENERIC_BODY, data: { url: "/" } } };
  if (!data) return generic;

  let parsed: unknown;
  try {
    parsed = data.json();
  } catch {
    // No era JSON (el aviso de prueba de las herramientas del navegador es texto plano).
    const text = readText(data);
    return text === undefined ? generic : { title: APP_NAME, options: { body: text, data: { url: "/" } } };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return generic;

  const message = parsed as Record<string, unknown>;
  const body = nonBlank(message.body);
  return {
    title: nonBlank(message.title) ?? APP_NAME,
    options: { ...(body === undefined ? {} : { body }), data: { url: safeTarget(message.url) } },
  };
}

/** Lo que el worker necesita de una ventana abierta (`WindowClient`). `navigate` falta en algunos navegadores. */
export interface WindowLike {
  url: string;
  focused: boolean;
  focus(): Promise<unknown>;
  navigate?(url: string): Promise<unknown>;
}

/** Lo que el worker necesita de `self.clients`. */
export interface ClientsLike {
  matchAll(options: { type: "window"; includeUncontrolled: boolean }): Promise<readonly WindowLike[]>;
  openWindow(url: string): Promise<unknown>;
}

/**
 * Qué hacer al tocar un aviso: si la app está abierta, enfocarla y llevarla a `url`; si no, abrirla ahí.
 * Si la ventana abierta no se puede enfocar o llevar a la ruta, se abre una nueva.
 */
export async function openTarget(clients: ClientsLike, url: string, origin: string): Promise<void> {
  const target = new URL(safeTarget(url), origin).href;
  const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
  const open = windows.find((window) => window.focused) ?? windows[0];
  if (open) {
    try {
      await open.focus();
      if (open.url === target) return;
      if (open.navigate) {
        await open.navigate(target);
        return;
      }
    } catch {
      // Se cae a abrir una ventana nueva.
    }
  }
  await clients.openWindow(target);
}
