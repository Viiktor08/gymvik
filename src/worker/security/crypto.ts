/** SHA-256 del texto (codificado en UTF-8), en hexadecimal minúsculas. */
export async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Token aleatorio criptográficamente seguro, en base64url sin relleno. */
export function randomToken(bytes = 32): string {
  // getRandomValues admite como máximo 65536 bytes por llamada.
  if (!Number.isInteger(bytes) || bytes < 1 || bytes > 65536) {
    throw new RangeError("randomToken: bytes debe ser un entero entre 1 y 65536");
  }
  const random = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...random))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
