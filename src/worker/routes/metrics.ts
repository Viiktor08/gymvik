import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { bodyMetricInputSchema } from "../../shared/schemas";
import { deleteBodyMetric, deleteCreatine, upsertBodyMetric, upsertCreatine } from "../db/metrics";
import { getSettings } from "../db/settings";
import type { Env } from "../env";
import { parseLocalDate, readJson } from "../http";

/** Rutas /api/body-metrics: peso y grasa corporal, solo a mano. */
export function bodyMetricRoutes(): Hono<{ Bindings: Env }> {
  const metrics = new Hono<{ Bindings: Env }>();

  // Un registro por día: reenviarlo lo reemplaza (sin grasa, la grasa queda en null).
  metrics.put("/:date", async (c) => {
    const date = parseLocalDate(c.req.param("date"));
    const body = await readJson(c, bodyMetricInputSchema);
    return c.json(await upsertBodyMetric(c.env.DB, date, body.weightKg, body.bodyFatPct ?? null));
  });

  metrics.delete("/:date", async (c) => {
    const date = parseLocalDate(c.req.param("date"));
    if (!(await deleteBodyMetric(c.env.DB, date))) {
      throw new HTTPException(404, { message: "No hay peso apuntado ese día" });
    }
    return c.json({ deleted: true });
  });

  return metrics;
}

/** Rutas /api/creatine: marcar y desmarcar a mano (el NFC usa /api/hook/creatine). */
export function creatineRoutes(): Hono<{ Bindings: Env }> {
  const creatine = new Hono<{ Bindings: Env }>();

  // Sin cuerpo: los gramos son los de ajustes. Marcar un día ya marcado lo deja igual (una fila, origen manual).
  creatine.put("/:date", async (c) => {
    const date = parseLocalDate(c.req.param("date"));
    const { creatineGrams } = await getSettings(c.env.DB);
    return c.json(await upsertCreatine(c.env.DB, date, creatineGrams, "manual"));
  });

  creatine.delete("/:date", async (c) => {
    const date = parseLocalDate(c.req.param("date"));
    if (!(await deleteCreatine(c.env.DB, date))) {
      throw new HTTPException(404, { message: "No hay creatina marcada ese día" });
    }
    return c.json({ deleted: true });
  });

  return creatine;
}
