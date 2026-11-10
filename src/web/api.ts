/** Error de la API. `status` es 0 cuando la petición ni siquiera llegó al servidor (sin red). */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// Pantallas de acceso: ahí un 401 es normal y no debe provocar otra redirección.
const AUTH_SCREENS: ReadonlySet<string> = new Set(["/login", "/setup", "/recuperar"]);

function redirectsOnUnauthorized(apiPath: string): boolean {
  // En /api/auth/* un 401 es la respuesta esperada de un intento fallido (o de /me sin sesión).
  if (apiPath.startsWith("/api/auth/")) return false;
  return !AUTH_SCREENS.has(location.pathname);
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string") {
      return body.error;
    }
  } catch {
    // Sin JSON: se cae al mensaje genérico.
  }
  return response.status >= 500 ? "Error del servidor" : "No se pudo completar la petición";
}

/**
 * Llama a la API y devuelve el JSON de la respuesta (`undefined` si viene vacía).
 * Si el cuerpo es un texto lo manda como JSON. Cualquier fallo lanza `ApiError`.
 * Un 401 fuera de las pantallas de acceso y de /api/auth/* lleva a /login.
 */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (typeof init.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(path, { ...init, headers });
  } catch {
    throw new ApiError(0, "Sin conexión");
  }

  if (!response.ok) {
    if (response.status === 401 && redirectsOnUnauthorized(path)) {
      location.assign("/login");
    }
    throw new ApiError(response.status, await errorMessage(response));
  }

  const text = await response.text();
  return (text === "" ? undefined : JSON.parse(text)) as T;
}
