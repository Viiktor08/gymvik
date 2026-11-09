import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { exerciseInputSchema } from "../../shared/schemas";
import type { Exercise } from "../../shared/types";
import {
  exerciseHistory,
  findExercise,
  insertExercise,
  listExercises,
  removeExercise,
  updateExercise,
} from "../db/exercises";
import type { Env } from "../env";
import { readJson } from "../http";

// PATCH usa las mismas reglas que exerciseInputSchema, pero con todo opcional. No vale `.partial()`:
// en zod 4 los `default` siguen aplicándose a las claves que faltan y un PATCH con solo `name` dejaría
// `muscle`, `description` y `mediaUrl` en blanco. Por eso se quitan los defaults antes de hacerlos opcionales.
const input = exerciseInputSchema.shape;
const exercisePatchSchema = z.object({
  name: input.name.optional(),
  category: input.category.optional(),
  muscle: input.muscle.removeDefault().optional(),
  description: input.description.removeDefault().optional(),
  mediaUrl: input.mediaUrl.removeDefault().optional(),
  archived: input.archived,
});

const NOT_FOUND = "Ejercicio no encontrado";

/** Rutas /api/exercises. La puerta de sesión de index.ts ya las protege. */
export function exerciseRoutes(): Hono<{ Bindings: Env }> {
  const exercises = new Hono<{ Bindings: Env }>();

  // Las archivadas solo salen con `?archived=1`.
  exercises.get("/", async (c) => c.json(await listExercises(c.env.DB, c.req.query("archived") === "1")));

  exercises.post("/", async (c) => {
    const body = await readJson(c, exerciseInputSchema);
    // El id y `isCustom` los pone el servidor: lo que mande el cliente se ignora.
    const exercise: Exercise = {
      id: crypto.randomUUID(),
      name: body.name,
      category: body.category,
      muscle: body.muscle,
      description: body.description,
      mediaUrl: body.mediaUrl,
      isCustom: true,
      archived: body.archived ?? false,
    };
    await insertExercise(c.env.DB, exercise);
    return c.json(exercise, 201);
  });

  exercises.patch("/:id", async (c) => {
    const patch = await readJson(c, exercisePatchSchema);
    const updated = await updateExercise(c.env.DB, c.req.param("id"), patch);
    if (updated === null) throw new HTTPException(404, { message: NOT_FOUND });
    return c.json(updated);
  });

  // Archiva si algún entreno o rutina usa el ejercicio; si no, lo borra.
  exercises.delete("/:id", async (c) => {
    const outcome = await removeExercise(c.env.DB, c.req.param("id"));
    if (outcome === "missing") throw new HTTPException(404, { message: NOT_FOUND });
    return c.json({ archived: outcome === "archived" });
  });

  exercises.get("/:id/history", async (c) => {
    const id = c.req.param("id");
    if ((await findExercise(c.env.DB, id)) === null) throw new HTTPException(404, { message: NOT_FOUND });
    return c.json(await exerciseHistory(c.env.DB, id));
  });

  return exercises;
}
