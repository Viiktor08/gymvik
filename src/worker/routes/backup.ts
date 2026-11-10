import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { backupSchema } from "../../shared/schemas";
import { exportBackup, findBackupProblem, importBackup } from "../db/backup";
import type { Env } from "../env";
import { readJson } from "../http";

/** Rutas /api/backup. La puerta de sesión de index.ts ya las protege. */
export function backupRoutes(): Hono<{ Bindings: Env }> {
  const backup = new Hono<{ Bindings: Env }>();

  // Todos los datos del usuario en JSON. Nunca incluye passkeys, sesiones, claves ni suscripciones.
  backup.get("/", async (c) => c.json(await exportBackup(c.env.DB)));

  // Sustituye todos los datos por los de la copia, o no cambia nada: se valida entera antes de escribir.
  backup.post("/import", async (c) => {
    const body = await readJson(c, backupSchema);
    const problem = findBackupProblem(body);
    if (problem !== null) throw new HTTPException(400, { message: problem });
    return c.json({ imported: await importBackup(c.env.DB, body) });
  });

  return backup;
}
