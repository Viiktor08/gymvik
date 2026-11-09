import type { SetEntry, Workout, WorkoutExercise } from "../../shared/types";

/** Una fila del historial: lo justo para listar los entrenos sin cargar sus series. */
export type WorkoutSummary = {
  id: string;
  // null en un entreno libre.
  routineName: string | null;
  localDate: string;
  // Minutos enteros entre el inicio y el fin (0 si el fin no es posterior al inicio).
  durationMin: number;
  // Misma regla que weeklySummary: Σ peso × repeticiones de las series con ambos > 0 que no son de cardio.
  volumeKg: number;
};

type WorkoutRow = {
  id: string;
  routine_id: string | null;
  started_at: string;
  ended_at: string;
  local_date: string;
  notes: string;
  source: "live" | "manual";
};

type WorkoutExerciseRow = {
  id: number;
  workout_id: string;
  exercise_id: string;
};

type SetRow = {
  workout_exercise_id: number;
  weight_kg: number | null;
  reps: number | null;
  rir: number | null;
  duration_min: number | null;
  distance_km: number | null;
};

type SummaryRow = {
  id: string;
  routine_name: string | null;
  local_date: string;
  started_at: string;
  ended_at: string;
  volume_kg: number;
};

const WORKOUT_COLUMNS = "id, routine_id, started_at, ended_at, local_date, notes, source";

// Del más reciente al más antiguo; a igualdad de día, el que empezó más tarde primero.
const NEWEST_FIRST = "ORDER BY local_date DESC, started_at DESC, id DESC";

const DEFAULT_TIMEZONE = "Europe/Madrid";

/** La zona horaria de los ajustes (fila única). */
export async function getTimezone(db: D1Database): Promise<string> {
  const row = await db.prepare("SELECT timezone FROM settings WHERE id = 1").first<{ timezone: string }>();
  return row?.timezone ?? DEFAULT_TIMEZONE;
}

/** Une cada entreno con sus ejercicios y series. Las filas ya vienen ordenadas por posición. */
function assemble(workouts: WorkoutRow[], exercises: WorkoutExerciseRow[], sets: SetRow[]): Workout[] {
  const setsByExercise = new Map<number, SetEntry[]>();
  for (const row of sets) {
    const list = setsByExercise.get(row.workout_exercise_id) ?? [];
    list.push({
      weightKg: row.weight_kg,
      reps: row.reps,
      rir: row.rir,
      durationMin: row.duration_min,
      distanceKm: row.distance_km,
    });
    setsByExercise.set(row.workout_exercise_id, list);
  }

  const exercisesByWorkout = new Map<string, WorkoutExercise[]>();
  for (const row of exercises) {
    const list = exercisesByWorkout.get(row.workout_id) ?? [];
    list.push({ exerciseId: row.exercise_id, sets: setsByExercise.get(row.id) ?? [] });
    exercisesByWorkout.set(row.workout_id, list);
  }

  return workouts.map((row) => ({
    id: row.id,
    routineId: row.routine_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    localDate: row.local_date,
    notes: row.notes,
    source: row.source,
    exercises: exercisesByWorkout.get(row.id) ?? [],
  }));
}

/**
 * Carga los entrenos que cumplen `where` (una condición sobre `workouts` escrita en el código, nunca
 * texto del usuario; sus valores van en `params` como ?1, ?2…) con sus ejercicios y series, en un lote.
 */
async function loadWorkouts(db: D1Database, where: string, params: unknown[]): Promise<Workout[]> {
  const matching = `SELECT id FROM workouts WHERE ${where}`;
  const [workouts, exercises, sets] = await db.batch([
    db.prepare(`SELECT ${WORKOUT_COLUMNS} FROM workouts WHERE ${where} ${NEWEST_FIRST}`).bind(...params),
    db
      .prepare(
        `SELECT id, workout_id, exercise_id FROM workout_exercises
          WHERE workout_id IN (${matching})
          ORDER BY workout_id, position, id`,
      )
      .bind(...params),
    db
      .prepare(
        `SELECT workout_exercise_id, weight_kg, reps, rir, duration_min, distance_km FROM sets
          WHERE workout_exercise_id IN (SELECT id FROM workout_exercises WHERE workout_id IN (${matching}))
          ORDER BY workout_exercise_id, position, id`,
      )
      .bind(...params),
  ]);
  return assemble(
    (workouts?.results ?? []) as WorkoutRow[],
    (exercises?.results ?? []) as WorkoutExerciseRow[],
    (sets?.results ?? []) as SetRow[],
  );
}

/** El entreno con todas sus series, o null si no existe. */
export async function findWorkout(db: D1Database, id: string): Promise<Workout | null> {
  return (await loadWorkouts(db, "id = ?1", [id]))[0] ?? null;
}

/**
 * Los entrenos, distintos de `excludeId`, donde aparece alguno de `exerciseIds`: contra ellos se comparan
 * los récords. Un entreno sin ninguno de esos ejercicios no puede aportar récords, así que no se carga.
 */
export async function listWorkoutsWithExercises(
  db: D1Database,
  exerciseIds: string[],
  excludeId: string,
): Promise<Workout[]> {
  if (exerciseIds.length === 0) return [];
  return loadWorkouts(
    db,
    `id <> ?1 AND id IN (
       SELECT workout_id FROM workout_exercises WHERE exercise_id IN (SELECT value FROM json_each(?2)))`,
    [excludeId, JSON.stringify(exerciseIds)],
  );
}

function durationMinutes(startedAt: string, endedAt: string): number {
  const ms = Date.parse(endedAt) - Date.parse(startedAt);
  return Number.isFinite(ms) && ms > 0 ? Math.round(ms / 60_000) : 0;
}

/**
 * Resúmenes del historial, del más reciente al más antiguo. `from` y `to` (YYYY-MM-DD, ambos incluidos)
 * son opcionales. El volumen se calcula en SQL con la regla de weeklySummary y se redondea a 2 decimales
 * (como sessionStats) para que el orden de la suma no deje ruido de coma flotante.
 */
export async function listWorkoutSummaries(
  db: D1Database,
  range: { from?: string; to?: string },
): Promise<WorkoutSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT w.id, r.name AS routine_name, w.local_date, w.started_at, w.ended_at,
              COALESCE((
                SELECT SUM(s.weight_kg * s.reps)
                  FROM workout_exercises we
                  JOIN exercises e ON e.id = we.exercise_id
                  JOIN sets s ON s.workout_exercise_id = we.id
                 WHERE we.workout_id = w.id AND e.category <> 'cardio' AND s.weight_kg > 0 AND s.reps > 0
              ), 0) AS volume_kg
         FROM workouts w
         LEFT JOIN routines r ON r.id = w.routine_id
        WHERE (?1 IS NULL OR w.local_date >= ?1) AND (?2 IS NULL OR w.local_date <= ?2)
        ORDER BY w.local_date DESC, w.started_at DESC, w.id DESC`,
    )
    .bind(range.from ?? null, range.to ?? null)
    .all<SummaryRow>();
  return results.map((row) => ({
    id: row.id,
    routineName: row.routine_name,
    localDate: row.local_date,
    durationMin: durationMinutes(row.started_at, row.ended_at),
    volumeKg: Math.round(row.volume_kg * 100) / 100,
  }));
}

/**
 * Guarda el entreno reemplazando el que tuviera el mismo id, en un único lote atómico: o queda el nuevo
 * entero o no cambia nada. Es lo que hace idempotente el PUT.
 *
 * Son pocas sentencias aunque el entreno tenga muchas series (D1 limita las consultas por invocación y
 * los parámetros por sentencia): los ejercicios y las series viajan como un único parámetro JSON que
 * `json_each` expande. Borrar el entreno anterior arrastra sus ejercicios y series (ON DELETE CASCADE).
 * Los ejercicios se numeran por su posición en la lista, y las series se asocian a su ejercicio por
 * `workout_id` y esa posición, porque el id de `workout_exercises` lo asigna la base de datos.
 */
export async function replaceWorkout(db: D1Database, workout: Workout): Promise<void> {
  const exercises = JSON.stringify(workout.exercises);
  await db.batch([
    db.prepare("DELETE FROM workouts WHERE id = ?").bind(workout.id),
    db
      .prepare(`INSERT INTO workouts (${WORKOUT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        workout.id,
        workout.routineId,
        workout.startedAt,
        workout.endedAt,
        workout.localDate,
        workout.notes,
        workout.source,
      ),
    db
      .prepare(
        `INSERT INTO workout_exercises (workout_id, exercise_id, position)
         SELECT ?1, json_extract(e.value, '$.exerciseId'), e.key FROM json_each(?2) AS e`,
      )
      .bind(workout.id, exercises),
    db
      .prepare(
        `INSERT INTO sets (workout_exercise_id, position, weight_kg, reps, rir, duration_min, distance_km)
         SELECT we.id, s.key,
                json_extract(s.value, '$.weightKg'), json_extract(s.value, '$.reps'),
                json_extract(s.value, '$.rir'), json_extract(s.value, '$.durationMin'),
                json_extract(s.value, '$.distanceKm')
           FROM json_each(?2) AS e
           JOIN workout_exercises we ON we.workout_id = ?1 AND we.position = e.key
           JOIN json_each(e.value, '$.sets') AS s`,
      )
      .bind(workout.id, exercises),
  ]);
}

/** Borra el entreno y, en cascada, sus ejercicios y series. False si no existe. */
export async function deleteWorkout(db: D1Database, id: string): Promise<boolean> {
  // RETURNING en vez de meta.changes: no hay que depender de si D1 cuenta también las filas borradas en cascada.
  const { results } = await db.prepare("DELETE FROM workouts WHERE id = ? RETURNING id").bind(id).all();
  return results.length === 1;
}
