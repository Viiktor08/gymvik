import type { Category, Exercise, SetEntry } from "../../shared/types";

type ExerciseRow = {
  id: string;
  name: string;
  category: Category;
  muscle: string;
  description: string;
  media_url: string | null;
  is_custom: number;
  archived: number;
};

const COLUMNS = "id, name, category, muscle, description, media_url, is_custom, archived";

/** Campos que se pueden cambiar de un ejercicio. El id y `isCustom` no. */
export type ExercisePatch = Partial<Pick<Exercise, "name" | "category" | "muscle" | "description" | "mediaUrl" | "archived">>;

/** Un entreno donde aparece el ejercicio, con las series de ese ejercicio. */
export type ExerciseHistoryEntry = { workoutId: string; localDate: string; sets: SetEntry[] };

function toExercise(row: ExerciseRow): Exercise {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    muscle: row.muscle,
    description: row.description,
    mediaUrl: row.media_url,
    isCustom: row.is_custom === 1,
    archived: row.archived === 1,
  };
}

/** Ejercicios ordenados por nombre (sin distinguir mayúsculas). Las archivadas solo si se piden. */
export async function listExercises(db: D1Database, includeArchived: boolean): Promise<Exercise[]> {
  const where = includeArchived ? "" : "WHERE archived = 0";
  const { results } = await db
    .prepare(`SELECT ${COLUMNS} FROM exercises ${where} ORDER BY name COLLATE NOCASE, id`)
    .all<ExerciseRow>();
  return results.map(toExercise);
}

/** El ejercicio, archivado o no, o null si no existe. */
export async function findExercise(db: D1Database, id: string): Promise<Exercise | null> {
  const row = await db.prepare(`SELECT ${COLUMNS} FROM exercises WHERE id = ?`).bind(id).first<ExerciseRow>();
  return row === null ? null : toExercise(row);
}

export async function insertExercise(db: D1Database, exercise: Exercise): Promise<void> {
  await db
    .prepare(`INSERT INTO exercises (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      exercise.id,
      exercise.name,
      exercise.category,
      exercise.muscle,
      exercise.description,
      exercise.mediaUrl,
      exercise.isCustom ? 1 : 0,
      exercise.archived ? 1 : 0,
    )
    .run();
}

/** Aplica el parche sobre el ejercicio y devuelve el resultado, o null si el ejercicio no existe. */
export async function updateExercise(db: D1Database, id: string, patch: ExercisePatch): Promise<Exercise | null> {
  const current = await findExercise(db, id);
  if (current === null) return null;
  const updated: Exercise = { ...current };
  if (patch.name !== undefined) updated.name = patch.name;
  if (patch.category !== undefined) updated.category = patch.category;
  if (patch.muscle !== undefined) updated.muscle = patch.muscle;
  if (patch.description !== undefined) updated.description = patch.description;
  if (patch.mediaUrl !== undefined) updated.mediaUrl = patch.mediaUrl;
  if (patch.archived !== undefined) updated.archived = patch.archived;

  await db
    .prepare(
      "UPDATE exercises SET name = ?, category = ?, muscle = ?, description = ?, media_url = ?, archived = ? WHERE id = ?",
    )
    .bind(
      updated.name,
      updated.category,
      updated.muscle,
      updated.description,
      updated.mediaUrl,
      updated.archived ? 1 : 0,
      id,
    )
    .run();
  return updated;
}

/**
 * Quita un ejercicio de la biblioteca. Si algún entreno o rutina lo usa se archiva (el historial lo
 * necesita); si no, se borra. El borrado condicional es una sola sentencia, así que no hay hueco entre
 * comprobar el uso y borrar.
 */
export async function removeExercise(db: D1Database, id: string): Promise<"deleted" | "archived" | "missing"> {
  const deleted = await db
    .prepare(
      `DELETE FROM exercises WHERE id = ?1
         AND NOT EXISTS (SELECT 1 FROM workout_exercises WHERE exercise_id = ?1)
         AND NOT EXISTS (SELECT 1 FROM routine_items WHERE exercise_id = ?1)`,
    )
    .bind(id)
    .run();
  if (deleted.meta.changes === 1) return "deleted";

  const archived = await db.prepare("UPDATE exercises SET archived = 1 WHERE id = ?").bind(id).run();
  return archived.meta.changes === 1 ? "archived" : "missing";
}

/** Si existen todos los ejercicios (archivados o no). `ids` no debe llevar repetidos. */
export async function exercisesExist(db: D1Database, ids: string[]): Promise<boolean> {
  if (ids.length === 0) return true;
  // Una sola lista JSON como parámetro: evita el límite de parámetros de D1 por sentencia.
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM exercises WHERE id IN (SELECT value FROM json_each(?))")
    .bind(JSON.stringify(ids))
    .first<{ n: number }>();
  return row?.n === ids.length;
}

type HistoryRow = {
  workout_id: string;
  local_date: string;
  set_id: number | null;
  weight_kg: number | null;
  reps: number | null;
  rir: number | null;
  duration_min: number | null;
  distance_km: number | null;
};

/**
 * Entrenos donde aparece el ejercicio, del más reciente al más antiguo, con las series de ese ejercicio
 * en su orden. Cuenta también si el ejercicio está archivado. Si aparece dos veces en un entreno, sus
 * series van juntas en una sola entrada.
 */
export async function exerciseHistory(db: D1Database, exerciseId: string): Promise<ExerciseHistoryEntry[]> {
  const { results } = await db
    .prepare(
      `SELECT w.id AS workout_id, w.local_date, s.id AS set_id,
              s.weight_kg, s.reps, s.rir, s.duration_min, s.distance_km
         FROM workout_exercises we
         JOIN workouts w ON w.id = we.workout_id
         LEFT JOIN sets s ON s.workout_exercise_id = we.id
        WHERE we.exercise_id = ?
        ORDER BY w.local_date DESC, w.started_at DESC, w.id DESC, we.position, we.id, s.position, s.id`,
    )
    .bind(exerciseId)
    .all<HistoryRow>();

  const entries = new Map<string, ExerciseHistoryEntry>();
  for (const row of results) {
    let entry = entries.get(row.workout_id);
    if (entry === undefined) {
      entry = { workoutId: row.workout_id, localDate: row.local_date, sets: [] };
      entries.set(row.workout_id, entry);
    }
    // Sin serie (LEFT JOIN vacío): el ejercicio estuvo en el entreno pero no guardó ninguna.
    if (row.set_id !== null) {
      entry.sets.push({
        weightKg: row.weight_kg,
        reps: row.reps,
        rir: row.rir,
        durationMin: row.duration_min,
        distanceKm: row.distance_km,
      });
    }
  }
  return [...entries.values()];
}
