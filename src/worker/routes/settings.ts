import { Hono } from "hono";
import { settingsPatchSchema } from "../../shared/schemas";
import { getSettings, updateSettings } from "../db/settings";
import type { Env } from "../env";
import { readJson } from "../http";

/** Rutas /api/settings. La puerta de sesión de index.ts ya las protege. */
export function settingsRoutes(): Hono<{ Bindings: Env }> {
  const settings = new Hono<{ Bindings: Env }>();

  settings.get("/", async (c) => c.json(await getSettings(c.env.DB)));

  // Parche parcial: solo cambia lo que se envía. Responde con los ajustes completos.
  settings.patch("/", async (c) => {
    const patch = await readJson(c, settingsPatchSchema);
    return c.json(await updateSettings(c.env.DB, patch));
  });

  return settings;
}
