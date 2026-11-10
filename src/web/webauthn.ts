import {
  WebAuthnError,
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { ApiError, api } from "./api";

const UNSUPPORTED = "Este navegador no admite passkeys.";
const GENERIC = "No se pudo completar. Inténtalo de nuevo.";

function post<T>(path: string, body?: unknown, headers?: HeadersInit): Promise<T> {
  return api<T>(path, { method: "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

function assertSupported(): void {
  if (!browserSupportsWebAuthn()) throw new Error(UNSUPPORTED);
}

/**
 * Primer arranque: registra la primera passkey con el token de configuración y
 * devuelve los códigos de recuperación (el servidor solo los entrega esta vez).
 * El token solo viaja en la cabecera de la primera petición.
 */
export async function registerFirstPasskey(setupToken: string): Promise<string[]> {
  assertSupported();
  const optionsJSON = await post<PublicKeyCredentialCreationOptionsJSON>("/api/auth/setup/options", undefined, {
    "X-Setup-Token": setupToken,
  });
  const response = await startRegistration({ optionsJSON });
  const { recoveryCodes } = await post<{ recoveryCodes: string[] }>("/api/auth/setup/verify", { response });
  return recoveryCodes;
}

/** Registra una passkey nueva en este dispositivo. Exige una sesión abierta (la recuperación también la abre). */
export async function registerPasskey(label?: string): Promise<void> {
  assertSupported();
  const optionsJSON = await post<PublicKeyCredentialCreationOptionsJSON>("/api/auth/passkeys/options");
  const response = await startRegistration({ optionsJSON });
  await post("/api/auth/passkeys/verify", { response, label });
}

/** Inicia sesión con una passkey (el servidor no pide usuario: la credencial es descubrible). */
export async function signInWithPasskey(): Promise<void> {
  assertSupported();
  const optionsJSON = await post<PublicKeyCredentialRequestOptionsJSON>("/api/auth/login/options");
  const response = await startAuthentication({ optionsJSON });
  await post("/api/auth/login/verify", { response });
}

// DOMException (lo que lanza el navegador al cancelar) no siempre cuenta como `instanceof Error`.
function nameOf(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "name" in error && typeof error.name === "string"
    ? error.name
    : undefined;
}

function causeOf(error: unknown): unknown {
  return typeof error === "object" && error !== null && "cause" in error ? error.cause : undefined;
}

/** Texto para el usuario ante un fallo de la API o de WebAuthn. Nunca enseña detalles técnicos. */
export function passkeyErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message === UNSUPPORTED) return UNSUPPORTED;
  if (error instanceof WebAuthnError && error.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") {
    return "Este dispositivo ya tiene una passkey de Gymvik.";
  }
  if (
    nameOf(error) === "NotAllowedError" ||
    nameOf(causeOf(error)) === "NotAllowedError" ||
    (error instanceof WebAuthnError && error.code === "ERROR_CEREMONY_ABORTED")
  ) {
    return "Se ha cancelado la verificación. Inténtalo de nuevo.";
  }
  return GENERIC;
}
