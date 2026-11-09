import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { SEED_EXERCISES, seedExercises } from "../../src/worker/seed/exercises";

const CATEGORIES = ["strength", "cardio", "core", "power", "mobility", "feet"];
const NOTIFICATION_TYPES = ["today", "creatine", "steps", "streak", "weight"];

// Columnas de la spec §4 (más las de avisos de §6), en el orden de la migración.
const EXPECTED_COLUMNS: Record<string, string[]> = {
  exercises: ["id", "name", "category", "muscle", "description", "media_url", "is_custom", "archived"],
  routines: ["id", "name", "in_rotation", "rotation_order", "archived", "created_at"],
  routine_items: ["id", "routine_id", "exercise_id", "position", "sets", "reps_target", "rest_seconds"],
  workouts: ["id", "routine_id", "started_at", "ended_at", "local_date", "notes", "source"],
  workout_exercises: ["id", "workout_id", "exercise_id", "position"],
  sets: ["id", "workout_exercise_id", "position", "weight_kg", "reps", "rir", "duration_min", "distance_km"],
  body_metrics: ["local_date", "weight_kg", "body_fat_pct"],
  daily_steps: ["local_date", "steps", "updated_at"],
  creatine_logs: ["local_date", "grams", "source"],
  settings: [
    "id",
    "display_name",
    "theme",
    "timezone",
    "weekly_goal",
    "steps_goal",
    "creatine_grams",
    "shortcut_name",
    ...NOTIFICATION_TYPES.flatMap((type) => [`notify_${type}_enabled`, `notify_${type}_time`]),
  ],
  passkeys: ["credential_id", "public_key", "counter", "transports", "created_at", "label"],
  auth_challenges: ["challenge", "purpose", "expires_at"],
  sessions: ["token_hash", "created_at", "last_seen_at", "expires_at"],
  recovery_codes: ["code_hash", "used_at"],
  hook_keys: ["id", "label", "key_hash", "scopes", "created_at", "last_used_at", "revoked_at"],
  push_subscriptions: ["endpoint", "p256dh", "auth", "created_at"],
  notifications_sent: ["type", "local_date"],
  rate_limits: ["bucket", "window_start", "count"],
};

async function columnsOf(table: string): Promise<string[]> {
  const { results } = await env.DB.prepare("SELECT name FROM pragma_table_info(?) ORDER BY cid")
    .bind(table)
    .all<{ name: string }>();
  return results.map((row) => row.name);
}

async function indexedColumns(table: string): Promise<string[][]> {
  const { results: indexes } = await env.DB.prepare("SELECT name FROM pragma_index_list(?)")
    .bind(table)
    .all<{ name: string }>();
  return Promise.all(
    indexes.map(async ({ name }) => {
      const { results } = await env.DB.prepare("SELECT name FROM pragma_index_info(?) ORDER BY seqno")
        .bind(name)
        .all<{ name: string }>();
      return results.map((row) => row.name);
    }),
  );
}

async function countRows(table: string, where = "1 = 1"): Promise<number> {
  const row = await env.DB.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}`).first<{ n: number }>();
  return row?.n ?? -1;
}

// Los tests de claves foráneas necesitan los ejercicios sembrados. Se siembra dos veces a propósito.
beforeAll(async () => {
  await seedExercises(env.DB);
  await seedExercises(env.DB);
});

describe("esquema de D1", () => {
  it.each(Object.entries(EXPECTED_COLUMNS))("la tabla %s tiene las columnas de la spec", async (table, columns) => {
    expect(await columnsOf(table)).toEqual(columns);
  });

  it("no crea tablas de datos que no estén en la spec", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations' ORDER BY name",
    ).all<{ name: string }>();

    expect(results.map((row) => row.name)).toEqual(Object.keys(EXPECTED_COLUMNS).sort());
  });

  it("indexa workouts(local_date) y workout_exercises(exercise_id)", async () => {
    expect(await indexedColumns("workouts")).toContainEqual(["local_date"]);
    expect(await indexedColumns("workout_exercises")).toContainEqual(["exercise_id"]);
  });

  it("indexa las claves foráneas de las tablas hijas con nombres estables", async () => {
    const expected = ["idx_workout_exercises_workout_id", "idx_sets_workout_exercise_id", "idx_routine_items_routine_id"];
    const { results } = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'").all<{
      name: string;
    }>();

    expect(results.map((row) => row.name)).toEqual(expect.arrayContaining(expected));
    expect(await indexedColumns("workout_exercises")).toContainEqual(["workout_id"]);
    expect(await indexedColumns("sets")).toContainEqual(["workout_exercise_id"]);
    expect(await indexedColumns("routine_items")).toContainEqual(["routine_id"]);
  });

  it("inserta la configuración por defecto en una única fila", async () => {
    const { results } = await env.DB.prepare("SELECT * FROM settings").all();

    expect(results).toEqual([
      {
        id: 1,
        display_name: "Victor",
        theme: "green",
        timezone: "Europe/Madrid",
        weekly_goal: 3,
        steps_goal: 8000,
        creatine_grams: 5,
        shortcut_name: "Gymvik Pasos",
        notify_today_enabled: 1,
        notify_today_time: "09:00",
        notify_creatine_enabled: 1,
        notify_creatine_time: "10:00",
        notify_steps_enabled: 1,
        notify_steps_time: "20:00",
        notify_streak_enabled: 1,
        notify_streak_time: "19:00",
        notify_weight_enabled: 1,
        notify_weight_time: "09:00",
      },
    ]);
  });

  it("no admite una segunda fila de settings", async () => {
    await expect(env.DB.prepare("INSERT INTO settings (id) VALUES (2)").run()).rejects.toThrow(/constraint/i);
    expect(await countRows("settings")).toBe(1);
  });

  it("rechaza categorías de ejercicio desconocidas", async () => {
    await expect(
      env.DB.prepare("INSERT INTO exercises (id, name, category) VALUES ('bad_category', 'Mal', 'swimming')").run(),
    ).rejects.toThrow(/constraint/i);
  });

  it("al borrar una rutina se borran sus ejercicios y los entrenos conservan el historial", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO routines (id, name) VALUES ('r-cascade', 'Pierna')"),
      env.DB.prepare(
        "INSERT INTO routine_items (routine_id, exercise_id, position) VALUES ('r-cascade', 'back_squat', 0), ('r-cascade', 'leg_press', 1)",
      ),
      env.DB.prepare(
        "INSERT INTO workouts (id, routine_id, started_at, ended_at, local_date) VALUES ('w-from-routine', 'r-cascade', '2026-11-09T18:00:00.000Z', '2026-11-09T19:00:00.000Z', '2026-11-09')",
      ),
    ]);

    await env.DB.prepare("DELETE FROM routines WHERE id = 'r-cascade'").run();

    expect(await countRows("routine_items", "routine_id = 'r-cascade'")).toBe(0);
    const workout = await env.DB.prepare("SELECT routine_id FROM workouts WHERE id = 'w-from-routine'").first<{
      routine_id: string | null;
    }>();
    expect(workout).toEqual({ routine_id: null });
    await env.DB.prepare("DELETE FROM workouts WHERE id = 'w-from-routine'").run();
  });

  it("al borrar un entreno se borran sus ejercicios y sus series", async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO workouts (id, started_at, ended_at, local_date) VALUES ('w-cascade', '2026-11-09T18:00:00.000Z', '2026-11-09T19:00:00.000Z', '2026-11-09')",
      ),
      env.DB.prepare(
        "INSERT INTO workout_exercises (id, workout_id, exercise_id, position) VALUES (9001, 'w-cascade', 'back_squat', 0)",
      ),
      env.DB.prepare(
        "INSERT INTO sets (workout_exercise_id, position, weight_kg, reps) VALUES (9001, 0, 60, 10), (9001, 1, 57.5, 8)",
      ),
    ]);
    expect(await countRows("sets", "workout_exercise_id = 9001")).toBe(2);

    await env.DB.prepare("DELETE FROM workouts WHERE id = 'w-cascade'").run();

    expect(await countRows("workout_exercises", "workout_id = 'w-cascade'")).toBe(0);
    expect(await countRows("sets", "workout_exercise_id = 9001")).toBe(0);
  });

  it("no deja borrar un ejercicio que aparece en el historial (se archiva)", async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO workouts (id, started_at, ended_at, local_date) VALUES ('w-history', '2026-11-09T18:00:00.000Z', '2026-11-09T19:00:00.000Z', '2026-11-09')",
      ),
      env.DB.prepare(
        "INSERT INTO workout_exercises (workout_id, exercise_id, position) VALUES ('w-history', 'back_squat', 0)",
      ),
    ]);

    await expect(env.DB.prepare("DELETE FROM exercises WHERE id = 'back_squat'").run()).rejects.toThrow(/constraint/i);
    expect(await countRows("exercises", "id = 'back_squat'")).toBe(1);
    await env.DB.prepare("DELETE FROM workouts WHERE id = 'w-history'").run();
  });
});

describe("semilla de ejercicios", () => {
  it("ejecutarla dos veces no duplica y deja la configuración por defecto", async () => {
    expect(SEED_EXERCISES.length).toBeGreaterThanOrEqual(55);
    expect(await countRows("exercises")).toBe(SEED_EXERCISES.length);

    const settings = await env.DB.prepare("SELECT weekly_goal FROM settings").first<{ weekly_goal: number }>();
    expect(settings?.weekly_goal).toBe(3);
  });

  it("cubre las 6 categorías", async () => {
    expect(new Set(SEED_EXERCISES.map((exercise) => exercise.category))).toEqual(new Set(CATEGORIES));

    const { results } = await env.DB.prepare("SELECT DISTINCT category FROM exercises").all<{ category: string }>();
    expect(results.map((row) => row.category).sort()).toEqual([...CATEGORIES].sort());
  });

  it("usa ids y nombres únicos, con ids tipo slug", () => {
    const ids = SEED_EXERCISES.map((exercise) => exercise.id);
    const names = SEED_EXERCISES.map((exercise) => exercise.name.toLowerCase());

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/);
    expect(ids).toContain("back_squat");
  });

  it("guarda los ejercicios de la semilla como no personalizados y no archivados", async () => {
    expect(await countRows("exercises", "is_custom = 0 AND archived = 0")).toBe(SEED_EXERCISES.length);
  });

  it("incluye los cardios básicos", () => {
    const cardio = SEED_EXERCISES.filter((exercise) => exercise.category === "cardio").map((exercise) => exercise.name);

    expect(cardio).toEqual(
      expect.arrayContaining(["Correr", "Bici estática", "Elíptica", "Remo", "Comba", "Caminar rápido", "Zona 2"]),
    );
  });

  it("describe cada ejercicio con una sola frase", () => {
    for (const exercise of SEED_EXERCISES) {
      expect(exercise.name.trim(), exercise.id).not.toBe("");
      expect(exercise.muscle.trim(), exercise.id).not.toBe("");
      expect(exercise.description, exercise.id).toMatch(/^[^.]+\.$/);
      expect(exercise.description.length, exercise.id).toBeLessThanOrEqual(220);
    }
  });

  it("volver a ejecutarla no pisa lo que el usuario haya editado o archivado", async () => {
    await env.DB.prepare("UPDATE exercises SET name = 'Sentadilla mía', archived = 1 WHERE id = 'back_squat'").run();

    await seedExercises(env.DB);

    const row = await env.DB.prepare("SELECT name, archived FROM exercises WHERE id = 'back_squat'").first();
    expect(row).toEqual({ name: "Sentadilla mía", archived: 1 });
    expect(await countRows("exercises")).toBe(SEED_EXERCISES.length);
  });
});
