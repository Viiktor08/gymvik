import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { formatThousands, localDate } from "../../shared/dates";
import { creatineHookSchema, hookKeyInputSchema, stepsHookSchema } from "../../shared/schemas";
import { type HookEnv, createHookKey, listHookKeys, requireHookKey, revokeHookKey } from "../auth/hookKeys";
import { insertCreatineIfAbsent, upsertSteps } from "../db/metrics";
import { getSettings, getTimezone } from "../db/settings";
import type { Env } from "../env";
import { readJson, readOptionalJson } from "../http";
import { rateLimit } from "../security/rateLimit";

const HOOKS_PER_MINUTE = 30;

// Gramos con coma decimal ("2,5"), sin recortar decimales: son los que se guardan.
const gramsFormat = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 20 });

/**
 * Rutas /api/hook-keys: gestión de las claves de los Atajos. Van con sesión (la puerta de index.ts) y con
 * comprobación de Origin: /api/hook-keys NO es un hook, aunque su ruta empiece parecido.
 */
export function hookKeyRoutes(): Hono<{ Bindings: Env }> {
  const keys = new Hono<{ Bindings: Env }>();

  keys.get("/", async (c) => c.json(await listHookKeys(c.env.DB)));

  // El secreto solo viaja en esta respuesta: no debe quedar en ninguna caché.
  keys.post("/", async (c) => {
    const { label, scopes } = await readJson(c, hookKeyInputSchema);
    const key = await createHookKey(c.env.DB, label, scopes);
    c.header("Cache-Control", "no-store");
    return c.json({ key }, 201);
  });

  keys.delete("/:id", async (c) => {
    if (!(await revokeHookKey(c.env.DB, c.req.param("id")))) {
      throw new HTTPException(404, { message: "Clave no encontrada" });
    }
    return c.json({ revoked: true });
  });

  return keys;
}

/**
 * Rutas /api/hook/*: las llaman los Atajos de iOS y la pegatina NFC con `Authorization: Bearer`. Orden de
 * las respuestas de error: clave (401) → permiso (403) → límite por clave (429) → cuerpo (400).
 */
export function hookRoutes(): Hono<HookEnv> {
  const hooks = new Hono<HookEnv>();
  const limitPerKey = rateLimit<HookEnv>({
    bucket: (c) => `hook:${c.get("hookKeyId")}`,
    limit: HOOKS_PER_MINUTE,
    windowSec: 60,
  });

  // Idempotente: marcar un día ya marcado no cambia nada. El cuerpo es opcional: el Atajo puede no enviar nada.
  hooks.post("/creatine", requireHookKey("creatine"), limitPerKey, async (c) => {
    const body = await readOptionalJson(c, creatineHookSchema);
    const settings = await getSettings(c.env.DB);
    const created = await insertCreatineIfAbsent(
      c.env.DB,
      localDate(new Date(), settings.timezone),
      body.grams ?? settings.creatineGrams,
      "nfc",
    );
    const message = created === null ? "Ya estaba marcada" : `Creatina ✓ ${gramsFormat.format(created.grams)} g`;
    return c.json({ message });
  });

  // El último valor enviado del día es el que vale.
  hooks.post("/steps", requireHookKey("steps"), limitPerKey, async (c) => {
    const body = await readJson(c, stepsHookSchema);
    const date = body.date ?? localDate(new Date(), await getTimezone(c.env.DB));
    await upsertSteps(c.env.DB, date, body.steps);
    return c.json({ message: `Pasos: ${formatThousands(body.steps)}` });
  });

  return hooks;
}
