import type { z } from "zod";
import type { backupSchema } from "../../shared/schemas";
import { listExercises } from "./exercises";
import { listAllSteps, listBodyMetrics, listCreatineLogs } from "./metrics";
import { listRoutines } from "./routines";
import { getSettings, replaceSettingsStatement } from "./settings";
import { listAllWorkouts } from "./workouts";

/** La copia de seguridad: lo que exporta GET /api/backup y acepta POST /api/backup/import. */
export type Backup = z.output<typeof backupSchema>;

/** Cuántas filas se importaron de cada tabla. */
export type ImportCounts = {
  exercises: number;
  routines: number;
  workouts: number;
  bodyMetrics: number;
  dailySteps: number;
  creatineLogs: number;
};

// D1 limita cada valor a 2 MB. Cada tabla viaja como un parámetro JSON que `json_each` expande, así que
// se parte en fragmentos de como mucho 1 MB para quedar lejos del límite.
const MAX_CHUNK_BYTES = 1_000_000;

/**
 * Exporta todos los datos del usuario: ejercicios y rutinas también archivados, entrenos con sus series,
 * peso, pasos, creatina y ajustes. No incluye nada de acceso (passkeys, sesiones, claves, suscripciones
 * ni códigos de recuperación) ni los avisos ya enviados.
 */
export async function exportBackup(db: D1Database): Promise<Backup> {
  const [exercises, routines, workouts, bodyMetrics, dailySteps, creatineLogs, settings] = await Promise.all([
    listExercises(db, true),
    listRoutines(db, true),
    listAllWorkouts(db),
    listBodyMetrics(db),
    listAllSteps(db),
    listCreatineLogs(db),
    getSettings(db),
  ]);
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    exercises,
    routines,
    workouts,
    bodyMetrics,
    dailySteps,
    creatineLogs,
    settings,
  };
}

/**
 * Comprueba lo que el esquema no puede: ids o fechas repetidos y referencias a filas que no vienen en la
 * propia copia (ítems de rutina y entrenos que apuntan a ejercicios o rutinas inexistentes). Devuelve el
 * motivo del primer problema, o null si la copia es coherente. Se llama antes de escribir nada, para
 * responder un 400 limpio en vez de un fallo de clave primaria o foránea a mitad del lote.
 */
export function findBackupProblem(backup: Backup): string | null {
  const exerciseIds = new Set(backup.exercises.map((exercise) => exercise.id));
  const routineIds = new Set(backup.routines.map((routine) => routine.id));

  if (exerciseIds.size !== backup.exercises.length) return "Hay ejercicios con el mismo id";
  if (routineIds.size !== backup.routines.length) return "Hay rutinas con el mismo id";
  if (new Set(backup.workouts.map((workout) => workout.id)).size !== backup.workouts.length) {
    return "Hay entrenos con el mismo id";
  }
  if (hasRepeats(backup.bodyMetrics.map((metric) => metric.localDate))) return "Hay dos pesos del mismo día";
  if (hasRepeats(backup.dailySteps.map((day) => day.localDate))) return "Hay dos registros de pasos del mismo día";
  if (hasRepeats(backup.creatineLogs.map((log) => log.localDate))) return "Hay dos tomas de creatina del mismo día";

  for (const routine of backup.routines) {
    if (routine.items.some((item) => !exerciseIds.has(item.exerciseId))) {
      return "Una rutina usa un ejercicio que no está en la copia";
    }
  }
  for (const workout of backup.workouts) {
    if (workout.exercises.some((exercise) => !exerciseIds.has(exercise.exerciseId))) {
      return "Un entreno usa un ejercicio que no está en la copia";
    }
    if (workout.routineId !== null && !routineIds.has(workout.routineId)) {
      return "Un entreno viene de una rutina que no está en la copia";
    }
  }
  return null;
}

function hasRepeats(values: string[]): boolean {
  return new Set(values).size !== values.length;
}

/**
 * Parte `items` en listas JSON, en orden, de como mucho `maxBytes` bytes UTF-8 cada una (los límites de D1
 * se miden en bytes, no en caracteres). Un elemento que él solo pasa del límite va en su propia lista.
 * Sin elementos no hay listas.
 */
export function chunkJson(items: readonly unknown[], maxBytes = MAX_CHUNK_BYTES): string[] {
  const encoder = new TextEncoder();
  const chunks: string[] = [];
  let parts: string[] = [];
  // Los corchetes de la lista.
  let size = 2;
  for (const item of items) {
    const json = JSON.stringify(item);
    // Más la coma que lo separa del anterior.
    const bytes = encoder.encode(json).length + 1;
    if (parts.length > 0 && size + bytes > maxBytes) {
      chunks.push(`[${parts.join(",")}]`);
      parts = [];
      size = 2;
    }
    parts.push(json);
    size += bytes;
  }
  if (parts.length > 0) chunks.push(`[${parts.join(",")}]`);
  return chunks;
}

// json_extract devuelve 1 o 0 para true y false, y NULL para null: sirve para las columnas INTEGER 0/1.
const INSERT_EXERCISES = `
  INSERT INTO exercises (id, name, category, muscle, description, media_url, is_custom, archived)
  SELECT json_extract(e.value, '$.id'), json_extract(e.value, '$.name'), json_extract(e.value, '$.category'),
         json_extract(e.value, '$.muscle'), json_extract(e.value, '$.description'),
         json_extract(e.value, '$.mediaUrl'), json_extract(e.value, '$.isCustom'), json_extract(e.value, '$.archived')
    FROM json_each(?1) AS e`;

const INSERT_ROUTINES = `
  INSERT INTO routines (id, name, in_rotation, rotation_order, archived)
  SELECT json_extract(r.value, '$.id'), json_extract(r.value, '$.name'), json_extract(r.value, '$.inRotation'),
         json_extract(r.value, '$.rotationOrder'), json_extract(r.value, '$.archived')
    FROM json_each(?1) AS r`;

const INSERT_ROUTINE_ITEMS = `
  INSERT INTO routine_items (routine_id, exercise_id, position, sets, reps_target, rest_seconds)
  SELECT json_extract(r.value, '$.id'), json_extract(i.value, '$.exerciseId'), json_extract(i.value, '$.position'),
         json_extract(i.value, '$.sets'), json_extract(i.value, '$.repsTarget'), json_extract(i.value, '$.restSeconds')
    FROM json_each(?1) AS r
    JOIN json_each(r.value, '$.items') AS i`;

const INSERT_WORKOUTS = `
  INSERT INTO workouts (id, routine_id, started_at, ended_at, local_date, notes, source)
  SELECT json_extract(w.value, '$.id'), json_extract(w.value, '$.routineId'), json_extract(w.value, '$.startedAt'),
         json_extract(w.value, '$.endedAt'), json_extract(w.value, '$.localDate'), json_extract(w.value, '$.notes'),
         json_extract(w.value, '$.source')
    FROM json_each(?1) AS w`;

// Como en replaceWorkout (db/workouts.ts): los ejercicios se numeran por su posición en la lista y las series
// se asocian a su ejercicio por workout_id y esa posición, porque el id de workout_exercises lo asigna la base.
const INSERT_WORKOUT_EXERCISES = `
  INSERT INTO workout_exercises (workout_id, exercise_id, position)
  SELECT json_extract(w.value, '$.id'), json_extract(e.value, '$.exerciseId'), e.key
    FROM json_each(?1) AS w
    JOIN json_each(w.value, '$.exercises') AS e`;

const INSERT_SETS = `
  INSERT INTO sets (workout_exercise_id, position, weight_kg, reps, rir, duration_min, distance_km)
  SELECT we.id, s.key,
         json_extract(s.value, '$.weightKg'), json_extract(s.value, '$.reps'), json_extract(s.value, '$.rir'),
         json_extract(s.value, '$.durationMin'), json_extract(s.value, '$.distanceKm')
    FROM json_each(?1) AS w
    JOIN json_each(w.value, '$.exercises') AS e
    JOIN workout_exercises we ON we.workout_id = json_extract(w.value, '$.id') AND we.position = e.key
    JOIN json_each(e.value, '$.sets') AS s`;

const INSERT_BODY_METRICS = `
  INSERT INTO body_metrics (local_date, weight_kg, body_fat_pct)
  SELECT json_extract(m.value, '$.localDate'), json_extract(m.value, '$.weightKg'), json_extract(m.value, '$.bodyFatPct')
    FROM json_each(?1) AS m`;

const INSERT_DAILY_STEPS = `
  INSERT INTO daily_steps (local_date, steps)
  SELECT json_extract(d.value, '$.localDate'), json_extract(d.value, '$.steps')
    FROM json_each(?1) AS d`;

const INSERT_CREATINE_LOGS = `
  INSERT INTO creatine_logs (local_date, grams, source)
  SELECT json_extract(c.value, '$.localDate'), json_extract(c.value, '$.grams'), json_extract(c.value, '$.source')
    FROM json_each(?1) AS c`;

// Borrado en orden de claves foráneas: primero lo que depende de otra tabla.
const DELETE_ALL = [
  "DELETE FROM sets",
  "DELETE FROM workout_exercises",
  "DELETE FROM workouts",
  "DELETE FROM routine_items",
  "DELETE FROM routines",
  "DELETE FROM exercises",
  "DELETE FROM body_metrics",
  "DELETE FROM daily_steps",
  "DELETE FROM creatine_logs",
];

/**
 * Sustituye todos los datos del usuario por los de la copia en un único `db.batch`, que D1 ejecuta como una
 * transacción: o queda la copia entera o no cambia nada. La copia ya debe haber pasado `backupSchema` y
 * `findBackupProblem`. No toca passkeys, sesiones, claves, suscripciones, códigos ni avisos enviados.
 * Los ajustes se actualizan en su fila única, que nunca se borra.
 */
export async function importBackup(db: D1Database, backup: Backup): Promise<ImportCounts> {
  const statements: D1PreparedStatement[] = [...DELETE_ALL.map((sql) => db.prepare(sql))];
  statements.push(replaceSettingsStatement(db, backup.settings));

  // Cada tabla, de padres a hijos, en fragmentos que respetan el límite de valor de D1.
  for (const chunk of chunkJson(backup.exercises)) {
    statements.push(db.prepare(INSERT_EXERCISES).bind(chunk));
  }
  for (const chunk of chunkJson(backup.routines)) {
    statements.push(db.prepare(INSERT_ROUTINES).bind(chunk), db.prepare(INSERT_ROUTINE_ITEMS).bind(chunk));
  }
  for (const chunk of chunkJson(backup.workouts)) {
    statements.push(
      db.prepare(INSERT_WORKOUTS).bind(chunk),
      db.prepare(INSERT_WORKOUT_EXERCISES).bind(chunk),
      db.prepare(INSERT_SETS).bind(chunk),
    );
  }
  for (const chunk of chunkJson(backup.bodyMetrics)) statements.push(db.prepare(INSERT_BODY_METRICS).bind(chunk));
  for (const chunk of chunkJson(backup.dailySteps)) statements.push(db.prepare(INSERT_DAILY_STEPS).bind(chunk));
  for (const chunk of chunkJson(backup.creatineLogs)) statements.push(db.prepare(INSERT_CREATINE_LOGS).bind(chunk));

  await db.batch(statements);

  return {
    exercises: backup.exercises.length,
    routines: backup.routines.length,
    workouts: backup.workouts.length,
    bodyMetrics: backup.bodyMetrics.length,
    dailySteps: backup.dailySteps.length,
    creatineLogs: backup.creatineLogs.length,
  };
}
