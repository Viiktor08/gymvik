import { ApiError, api } from "../api";

/**
 * Un 401 en una llamada con sesión es que la sesión ha caducado: se vuelve al acceso. `api()` ya lo hace salvo
 * bajo /api/auth/*, donde un 401 es lo normal en el login; allí lo hacemos nosotros.
 */
export function leaveIfSignedOut(failure: unknown): void {
  if (failure instanceof ApiError && failure.status === 401) location.assign("/login");
}

/** `api()` para las rutas de /api/auth/* que exigen sesión (passkeys, códigos de recuperación, cerrar sesión). */
export async function sessionApi<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    return await api<T>(path, init);
  } catch (failure) {
    leaveIfSignedOut(failure);
    throw failure;
  }
}
