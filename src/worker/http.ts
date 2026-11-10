import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { z } from "zod";
import { isValidLocalDate } from "../shared/dates";

/**
 * Lee el cuerpo JSON de la petición y lo valida con zod. JSON mal formado,
 * ausente o que no cumple el esquema responde 400. Los mensajes son genéricos
 * a propósito: `onError` los muestra tal cual y el detalle de zod no aporta al
 * usuario.
 */
export async function readJson<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: "JSON no válido" });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new HTTPException(400, { message: "Datos no válidos" });
  return parsed.data;
}

/** Comprueba que `value` es una fecha real YYYY-MM-DD ("2026-02-30" no lo es); si no, responde 400. */
export function parseLocalDate(value: string): string {
  if (!isValidLocalDate(value)) throw new HTTPException(400, { message: "Fecha no válida (se espera YYYY-MM-DD)" });
  return value;
}
