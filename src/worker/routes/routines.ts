import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { routineSchema } from "../../shared/schemas";
import type { Routine } from "../../shared/types";
import { exercisesExist } from "../db/exercises";
import {
  archiveRoutine,
  findRoutine,
  insertRoutine,
  listRoutines,
  reorderRoutines,
  replaceRoutine,
  routineExists,
  routinesExist,
} from "../db/routines";
import type { Env } from "../env";
import { readJson } from "../http";

// El cuerpo de POST y PUT es la rutina entera. El id es opcional: en POST lo genera el servidor si falta
// y en PUT manda el de la URL.
const routineBodySchema = routineSchema.partial({ id: true });

const reorderSchema = z.object({
  ids: z
    .array(routineSchema.shape.id)
    .refine((ids) => new Set(ids).size === ids.length, "Hay ids repetidos"),
});

const NOT_FOUND = "Rutina no encontrada";

/** Una rutina que referencia un ejercicio inexistente es un cuerpo no válido (400), no un error interno. */
async function requireExercises(db: D1Database, routine: Pick<Routine, "items">): Promise<void> {
  const ids = [...new Set(routine.items.map((item) => item.exerciseId))];
  if (!(await exercisesExist(db, ids))) {
    throw new HTTPException(400, { message: "La rutina usa un ejercicio que no existe" });
  }
}

/** Relee la rutina para responder exactamente lo que devolvería GET. */
async function reread(db: D1Database, id: string): Promise<Routine> {
  const routine = await findRoutine(db, id);
  if (routine === null) throw new Error(`La rutina ${id} desapareció tras guardarla`);
  return routine;
}

/** Rutas /api/routines. La puerta de sesión de index.ts ya las protege. */
export function routineRoutes(): Hono<{ Bindings: Env }> {
  const routines = new Hono<{ Bindings: Env }>();

  // Sin las archivadas, en orden de rotación.
  routines.get("/", async (c) => c.json(await listRoutines(c.env.DB)));

  routines.post("/", async (c) => {
    const db = c.env.DB;
    const body = await readJson(c, routineBodySchema);
    const routine: Routine = { ...body, id: body.id ?? crypto.randomUUID() };

    if (body.id !== undefined && (await routineExists(db, routine.id))) {
      throw new HTTPException(409, { message: "Ya existe una rutina con ese id" });
    }
    await requireExercises(db, routine);
    await insertRoutine(db, routine);
    return c.json(await reread(db, routine.id), 201);
  });

  // Va antes que las rutas con `:id`, para que "reorder" nunca se tome por un id.
  routines.post("/reorder", async (c) => {
    const db = c.env.DB;
    const { ids } = await readJson(c, reorderSchema);
    if (!(await routinesExist(db, ids))) {
      throw new HTTPException(400, { message: "Alguna rutina no existe" });
    }
    await reorderRoutines(db, ids);
    return c.json(await listRoutines(db));
  });

  routines.put("/:id", async (c) => {
    const db = c.env.DB;
    const id = c.req.param("id");
    const body = await readJson(c, routineBodySchema);
    if (body.id !== undefined && body.id !== id) {
      throw new HTTPException(400, { message: "El id del cuerpo no coincide con el de la URL" });
    }

    if (!(await routineExists(db, id))) throw new HTTPException(404, { message: NOT_FOUND });
    const routine: Routine = { ...body, id };
    await requireExercises(db, routine);
    await replaceRoutine(db, routine);
    return c.json(await reread(db, id));
  });

  // Archivar, no borrar: los entrenos hechos con la rutina la siguen necesitando.
  routines.delete("/:id", async (c) => {
    if (!(await archiveRoutine(c.env.DB, c.req.param("id")))) {
      throw new HTTPException(404, { message: NOT_FOUND });
    }
    return c.json({ archived: true });
  });

  return routines;
}
