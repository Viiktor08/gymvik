import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { localDate as localDateOf, isValidLocalDate } from "../../shared/dates";
import { newRecords } from "../../shared/records";
import { applyWorkoutToRoutine } from "../../shared/routineDiff";
import { workoutSchema } from "../../shared/schemas";
import type { Routine, Workout } from "../../shared/types";
import { listExercises } from "../db/exercises";
import { findRoutine, replaceRoutine, routineExists } from "../db/routines";
import { getTimezone } from "../db/settings";
import {
  deleteWorkout,
  findWorkout,
  listWorkoutSummaries,
  listWorkoutsWithExercises,
  replaceWorkout,
} from "../db/workouts";
import type { Env } from "../env";
import { readJson } from "../http";

// El cuerpo es el entreno sin `localDate`, que calcula el servidor (lo que mande el cliente se descarta).
// El id es opcional: manda el de la URL y, si el cuerpo lo trae, tiene que coincidir.
const workoutBodySchema = workoutSchema.omit({ localDate: true }).partial({ id: true });

const dateSchema = z.string().refine(isValidLocalDate);
const rangeSchema = z.object({ from: dateSchema.optional(), to: dateSchema.optional() });

const NOT_FOUND = "Entreno no encontrado";

/** Relee el entreno para responder exactamente lo que devolvería GET. */
async function reread(db: D1Database, id: string): Promise<Workout> {
  const workout = await findWorkout(db, id);
  if (workout === null) throw new Error(`El entreno ${id} desapareció tras guardarlo`);
  return workout;
}

/** Rutas /api/workouts. La puerta de sesión de index.ts ya las protege. */
export function workoutRoutes(): Hono<{ Bindings: Env }> {
  const workouts = new Hono<{ Bindings: Env }>();

  // Resúmenes del historial, del más reciente al más antiguo. `from` y `to` (YYYY-MM-DD) son opcionales.
  workouts.get("/", async (c) => {
    const range = rangeSchema.safeParse({ from: c.req.query("from"), to: c.req.query("to") });
    if (!range.success) throw new HTTPException(400, { message: "Fecha no válida (se espera YYYY-MM-DD)" });
    return c.json(await listWorkoutSummaries(c.env.DB, range.data));
  });

  workouts.get("/:id", async (c) => {
    const workout = await findWorkout(c.env.DB, c.req.param("id"));
    if (workout === null) throw new HTTPException(404, { message: NOT_FOUND });
    return c.json(workout);
  });

  // Guardado idempotente: reenviar el mismo entreno lo reemplaza por sí mismo y devuelve lo mismo.
  workouts.put("/:id", async (c) => {
    const db = c.env.DB;
    const id = c.req.param("id");
    if (!workoutSchema.shape.id.safeParse(id).success) {
      throw new HTTPException(400, { message: "Id no válido" });
    }
    const body = await readJson(c, workoutBodySchema);
    if (body.id !== undefined && body.id !== id) {
      throw new HTTPException(400, { message: "El id del cuerpo no coincide con el de la URL" });
    }

    // Todo ejercicio y la rutina tienen que existir (archivados valen): un 400 limpio en vez de un fallo
    // de clave foránea a mitad del lote. Las tablas se necesitan igualmente para calcular los récords.
    const exercises = new Map((await listExercises(db, true)).map((exercise) => [exercise.id, exercise]));
    if (body.exercises.some((exercise) => !exercises.has(exercise.exerciseId))) {
      throw new HTTPException(400, { message: "El entreno usa un ejercicio que no existe" });
    }
    if (body.routineId !== null && !(await routineExists(db, body.routineId))) {
      throw new HTTPException(400, { message: "La rutina del entreno no existe" });
    }

    const workout: Workout = {
      ...body,
      id,
      localDate: localDateOf(new Date(body.startedAt), await getTimezone(db)),
    };
    await replaceWorkout(db, workout);

    const saved = await reread(db, id);
    const exerciseIds = [...new Set(saved.exercises.map((exercise) => exercise.exerciseId))];
    const previous = await listWorkoutsWithExercises(db, exerciseIds, id);
    return c.json({ workout: saved, newRecords: newRecords(saved, previous, exercises) });
  });

  workouts.delete("/:id", async (c) => {
    if (!(await deleteWorkout(c.env.DB, c.req.param("id")))) {
      throw new HTTPException(404, { message: NOT_FOUND });
    }
    return c.json({ deleted: true });
  });

  // Lleva a la rutina la estructura de la sesión: ejercicios, orden y número de series.
  workouts.post("/:id/apply-to-routine", async (c) => {
    const db = c.env.DB;
    const workout = await findWorkout(db, c.req.param("id"));
    if (workout === null) throw new HTTPException(404, { message: NOT_FOUND });
    if (workout.routineId === null) {
      throw new HTTPException(409, { message: "El entreno no viene de ninguna rutina" });
    }
    const routine = await findRoutine(db, workout.routineId);
    if (routine === null) throw new HTTPException(404, { message: "Rutina no encontrada" });

    // Cuentan las series guardadas: un ejercicio sin ninguna no pasa a la rutina.
    const performed = workout.exercises.filter((exercise) => exercise.sets.length > 0);
    const updated: Routine = { ...routine, items: applyWorkoutToRoutine(routine, performed) };
    await replaceRoutine(db, updated);

    const reloaded = await findRoutine(db, routine.id);
    if (reloaded === null) throw new Error(`La rutina ${routine.id} desapareció tras guardarla`);
    return c.json(reloaded);
  });

  return workouts;
}
