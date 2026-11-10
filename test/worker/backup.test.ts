import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { backupSchema } from "../../src/shared/schemas";
import { chunkJson } from "../../src/worker/db/backup";
import { ORIGIN, send } from "./helpers";

type Json = Record<string, any>;

// Tablas del catálogo y los entrenos, que la importación vacía y rellena (las de día se nombran aparte).
const DATA_TABLES = ["exercises", "routines", "routine_items", "workouts", "workout_exercises", "sets"];

async function count(table: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
  return row?.n ?? 0;
}

/** Vacía todos los datos de usuario en orden de claves foráneas y deja los ajustes por defecto. */
async function wipeData(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sets"),
    env.DB.prepare("DELETE FROM workout_exercises"),
    env.DB.prepare("DELETE FROM workouts"),
    env.DB.prepare("DELETE FROM routine_items"),
    env.DB.prepare("DELETE FROM routines"),
    env.DB.prepare("DELETE FROM exercises"),
    env.DB.prepare("DELETE FROM body_metrics"),
    env.DB.prepare("DELETE FROM daily_steps"),
    env.DB.prepare("DELETE FROM creatine_logs"),
    env.DB.prepare("DELETE FROM settings"),
    env.DB.prepare("INSERT INTO settings (id) VALUES (1)"),
  ]);
}

beforeEach(async () => {
  // El almacenamiento D1 no se aísla entre tests del mismo archivo: se vacía todo lo que usan.
  await wipeData();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM passkeys"),
    env.DB.prepare("DELETE FROM hook_keys"),
    env.DB.prepare("DELETE FROM push_subscriptions"),
    env.DB.prepare("DELETE FROM recovery_codes"),
    env.DB.prepare("DELETE FROM notifications_sent"),
  ]);
});

async function exportBackup(): Promise<Json> {
  const response = await send("GET", "/api/backup");
  expect(response.status).toBe(200);
  return response.json();
}

/** La copia sin `exportedAt`, que cambia en cada exportación. */
function withoutTimestamp(backup: Json): Json {
  const { exportedAt: _exportedAt, ...rest } = backup;
  return rest;
}

function importBackup(body: unknown): Promise<Response> {
  return send("POST", "/api/backup/import", { body });
}

// --- Datos de partida ---

/**
 * Un conjunto de datos que ejercita todo: un ejercicio archivado, una rutina archivada, rutinas con ítems,
 * entrenos con series de fuerza y de cardio (también uno manual y sin rutina), peso con y sin grasa, pasos,
 * creatina y ajustes personalizados con avisos distintos de los de por defecto.
 */
async function seedRichData(): Promise<void> {
  const exercise = (id: string, name: string, category: string, extra: Json = {}) =>
    env.DB.prepare(
      "INSERT INTO exercises (id, name, category, muscle, description, media_url, is_custom, archived) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(
      id,
      name,
      category,
      extra.muscle ?? "",
      extra.description ?? "",
      extra.mediaUrl ?? null,
      extra.isCustom ?? 0,
      extra.archived ?? 0,
    );
  const routine = (id: string, name: string, inRotation: number, rotationOrder: number, archived: number) =>
    env.DB.prepare("INSERT INTO routines (id, name, in_rotation, rotation_order, archived) VALUES (?, ?, ?, ?, ?)").bind(
      id,
      name,
      inRotation,
      rotationOrder,
      archived,
    );
  const item = (routineId: string, exerciseId: string, position: number, sets: number, reps: string, rest: number) =>
    env.DB.prepare(
      "INSERT INTO routine_items (routine_id, exercise_id, position, sets, reps_target, rest_seconds) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(routineId, exerciseId, position, sets, reps, rest);
  const workout = (id: string, routineId: string | null, start: string, end: string, date: string, notes: string, source: string) =>
    env.DB.prepare(
      "INSERT INTO workouts (id, routine_id, started_at, ended_at, local_date, notes, source) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(id, routineId, start, end, date, notes, source);

  await env.DB.batch([
    exercise("bench", "Press banca", "strength", { muscle: "Pecho", description: "Tumbado, barra al pecho.", mediaUrl: "https://example.com/bench.mp4" }),
    exercise("squat", "Sentadilla", "strength", { muscle: "Piernas", isCustom: 1 }),
    exercise("run", "Cinta", "cardio"),
    exercise("old", "Ñu café €", "core", { description: "Con acentos y símbolos: ñ, é, €.", isCustom: 1, archived: 1 }),
    routine("push", "Empuje", 1, 1, 0),
    routine("legs", "Pierna", 1, 0, 0),
    routine("retired", "Antigua", 0, 0, 1),
    item("push", "bench", 0, 4, "6-8", 120),
    item("push", "run", 1, 1, "20 min", 0),
    item("legs", "squat", 0, 5, "5", 180),
    item("retired", "old", 0, 3, "10", 60),
    workout("w-1", "push", "2026-11-02T10:00:00.000Z", "2026-11-02T11:05:00.000Z", "2026-11-02", "Buen día\ncon salto de línea", "live"),
    workout("w-2", "legs", "2026-11-04T17:30:00.000Z", "2026-11-04T18:20:00.000Z", "2026-11-04", "", "live"),
    workout("w-3", null, "2026-11-06T08:00:00.000Z", "2026-11-06T08:40:00.000Z", "2026-11-06", "Libre", "manual"),
    workout("w-4", "retired", "2026-10-30T09:00:00.000Z", "2026-10-30T09:50:00.000Z", "2026-10-30", "", "live"),
    // w-5 es de fuerza y cardio a la vez; w-6 no tiene ejercicios.
    workout("w-5", "push", "2026-11-08T10:00:00.000Z", "2026-11-08T11:00:00.000Z", "2026-11-08", "", "live"),
    workout("w-6", null, "2026-11-09T10:00:00.000Z", "2026-11-09T10:05:00.000Z", "2026-11-09", "", "manual"),
  ]);

  // Los ejercicios de los entrenos y sus series llevan ids autoincrementales: se insertan en orden.
  const workoutExercise = async (workoutId: string, exerciseId: string, position: number) => {
    const row = await env.DB.prepare(
      "INSERT INTO workout_exercises (workout_id, exercise_id, position) VALUES (?, ?, ?) RETURNING id",
    )
      .bind(workoutId, exerciseId, position)
      .first<{ id: number }>();
    return row!.id;
  };
  const sets = (id: number, rows: (number | null)[][]) =>
    env.DB.batch(
      rows.map((row, position) =>
        env.DB.prepare(
          "INSERT INTO sets (workout_exercise_id, position, weight_kg, reps, rir, duration_min, distance_km) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ).bind(id, position, ...row),
      ),
    );

  await sets(await workoutExercise("w-1", "bench", 0), [
    [62.5, 8, 2, null, null],
    [62.5, 7, 1, null, null],
    [60, 8, null, null, null],
  ]);
  await sets(await workoutExercise("w-1", "squat", 1), [[100.25, 5, 0, null, null]]);
  await sets(await workoutExercise("w-2", "squat", 0), [
    [102.5, 5, null, null, null],
    [102.5, 5, null, null, null],
  ]);
  await sets(await workoutExercise("w-3", "run", 0), [[null, null, null, 32.5, 5.25]]);
  await sets(await workoutExercise("w-4", "old", 0), [[0, 0, null, null, null]]);
  await sets(await workoutExercise("w-5", "bench", 0), [[65, 6, 1, null, null]]);
  await sets(await workoutExercise("w-5", "run", 1), [[null, null, null, 10, 1.5]]);
  // Un ejercicio sin ninguna serie guardada.
  await workoutExercise("w-5", "squat", 2);

  await env.DB.batch([
    env.DB.prepare("INSERT INTO body_metrics (local_date, weight_kg, body_fat_pct) VALUES ('2026-11-01', 82.35, 18.5)"),
    env.DB.prepare("INSERT INTO body_metrics (local_date, weight_kg, body_fat_pct) VALUES ('2026-11-08', 81.9, NULL)"),
    env.DB.prepare("INSERT INTO daily_steps (local_date, steps) VALUES ('2026-11-08', 9120)"),
    env.DB.prepare("INSERT INTO daily_steps (local_date, steps) VALUES ('2026-11-09', 0)"),
    env.DB.prepare("INSERT INTO creatine_logs (local_date, grams, source) VALUES ('2026-11-08', 5, 'nfc')"),
    env.DB.prepare("INSERT INTO creatine_logs (local_date, grams, source) VALUES ('2026-11-09', 3.5, 'manual')"),
    env.DB.prepare(
      `UPDATE settings SET display_name = 'Marta', theme = 'purple', timezone = 'Atlantic/Canary', weekly_goal = 5,
         steps_goal = 12000, creatine_grams = 3.5, shortcut_name = 'Mis pasos',
         notify_today_enabled = 0, notify_today_time = '07:30',
         notify_creatine_enabled = 1, notify_creatine_time = '11:15',
         notify_steps_enabled = 0, notify_steps_time = '21:45',
         notify_streak_enabled = 1, notify_streak_time = '18:05',
         notify_weight_enabled = 0, notify_weight_time = '06:00'
       WHERE id = 1`,
    ),
  ]);
}

/** Una copia mínima y válida, distinta de `seedRichData`. */
function smallBackup(): Json {
  return {
    version: 1,
    exportedAt: "2026-11-10T08:00:00.000Z",
    exercises: [
      { id: "ex-a", name: "Dominadas", category: "strength", muscle: "Espalda", description: "", mediaUrl: null, isCustom: false, archived: false },
      { id: "ex-b", name: "Plancha", category: "core", muscle: "", description: "", mediaUrl: null, isCustom: true, archived: true },
    ],
    routines: [
      {
        id: "r-a",
        name: "Tirón",
        inRotation: true,
        rotationOrder: 0,
        archived: false,
        items: [{ exerciseId: "ex-a", position: 0, sets: 3, repsTarget: "8", restSeconds: 90 }],
      },
    ],
    workouts: [
      {
        id: "wk-a",
        routineId: "r-a",
        startedAt: "2026-11-05T10:00:00.000Z",
        endedAt: "2026-11-05T11:00:00.000Z",
        localDate: "2026-11-05",
        notes: "",
        source: "live",
        exercises: [
          { exerciseId: "ex-a", sets: [{ weightKg: 10, reps: 6, rir: null, durationMin: null, distanceKm: null }] },
        ],
      },
    ],
    bodyMetrics: [{ localDate: "2026-11-05", weightKg: 70, bodyFatPct: null }],
    dailySteps: [{ localDate: "2026-11-05", steps: 5000 }],
    creatineLogs: [{ localDate: "2026-11-05", grams: 5, source: "manual" }],
    settings: {
      displayName: "Victor",
      theme: "green",
      timezone: "Europe/Madrid",
      weeklyGoal: 3,
      stepsGoal: 8000,
      creatineGrams: 5,
      shortcutName: "Gymvik Pasos",
      notifications: {
        today: { enabled: true, time: "09:00" },
        creatine: { enabled: true, time: "10:00" },
        steps: { enabled: true, time: "20:00" },
        streak: { enabled: true, time: "19:00" },
        weight: { enabled: true, time: "09:00" },
      },
    },
  };
}

// --- Acceso ---

describe("acceso", () => {
  it.each([
    ["GET", "/api/backup"],
    ["POST", "/api/backup/import"],
  ])("%s %s sin sesión responde 401", async (method, path) => {
    const response = await exports.default.fetch(`${ORIGIN}${path}`, {
      method,
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: method === "POST" ? JSON.stringify(smallBackup()) : undefined,
    });
    expect(response.status).toBe(401);
  });

  it("POST /api/backup/import con sesión pero con un Origin ajeno responde 403 y no toca nada", async () => {
    await seedRichData();
    const before = withoutTimestamp(await exportBackup());
    const response = await send("POST", "/api/backup/import", {
      body: smallBackup(),
      headers: { Origin: "https://evil.example" },
    });
    expect(response.status).toBe(403);
    expect(withoutTimestamp(await exportBackup())).toEqual(before);
  });
});

// --- Exportar ---

describe("GET /api/backup", () => {
  it("con la base vacía devuelve listas vacías y los ajustes", async () => {
    const backup = await exportBackup();
    expect(backup).toMatchObject({
      version: 1,
      exercises: [],
      routines: [],
      workouts: [],
      bodyMetrics: [],
      dailySteps: [],
      creatineLogs: [],
      settings: { displayName: "Victor", theme: "green", timezone: "Europe/Madrid", weeklyGoal: 3 },
    });
    expect(new Date(backup.exportedAt).toISOString()).toBe(backup.exportedAt);
    expect(backupSchema.safeParse(backup).success).toBe(true);
  });

  it("tiene exactamente las claves de la copia y cumple backupSchema", async () => {
    await seedRichData();
    const backup = await exportBackup();
    expect(Object.keys(backup).sort()).toEqual(
      ["bodyMetrics", "creatineLogs", "dailySteps", "exercises", "exportedAt", "routines", "settings", "version", "workouts"].sort(),
    );
    expect(backupSchema.safeParse(backup).success).toBe(true);
  });

  it("incluye los ejercicios y las rutinas archivados", async () => {
    await seedRichData();
    const backup = await exportBackup();
    const archivedExercise = backup.exercises.find((e: Json) => e.id === "old");
    expect(archivedExercise).toMatchObject({ archived: true, isCustom: true, name: "Ñu café €" });
    const archivedRoutine = backup.routines.find((r: Json) => r.id === "retired");
    expect(archivedRoutine).toMatchObject({ archived: true, items: [{ exerciseId: "old" }] });
    expect(backup.workouts).toHaveLength(6);
  });

  it("exporta los datos tal como están en las tablas", async () => {
    await seedRichData();
    const backup = await exportBackup();
    expect(backup.bodyMetrics).toEqual([
      { localDate: "2026-11-01", weightKg: 82.35, bodyFatPct: 18.5 },
      { localDate: "2026-11-08", weightKg: 81.9, bodyFatPct: null },
    ]);
    expect(backup.dailySteps).toEqual([
      { localDate: "2026-11-08", steps: 9120 },
      { localDate: "2026-11-09", steps: 0 },
    ]);
    expect(backup.creatineLogs).toEqual([
      { localDate: "2026-11-08", grams: 5, source: "nfc" },
      { localDate: "2026-11-09", grams: 3.5, source: "manual" },
    ]);
    expect(backup.settings.notifications.today).toEqual({ enabled: false, time: "07:30" });
    const w1 = backup.workouts.find((w: Json) => w.id === "w-1");
    expect(w1.exercises.map((e: Json) => e.exerciseId)).toEqual(["bench", "squat"]);
    expect(w1.exercises[0].sets).toHaveLength(3);
  });

  it("no incluye passkeys, sesiones, claves, suscripciones ni códigos de recuperación", async () => {
    await seedRichData();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO passkeys (credential_id, public_key, counter, transports, label) VALUES ('cred-secreta-123', 'pk-secreta-456', 7, '[\"internal\"]', 'iPhone')",
      ),
      env.DB.prepare(
        "INSERT INTO hook_keys (id, label, key_hash, scopes) VALUES ('hk-1', 'Atajo', 'hash-de-clave-789', '[\"steps\"]')",
      ),
      env.DB.prepare(
        "INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES ('https://push.example/endpoint-abc', 'p256dh-def', 'auth-ghi')",
      ),
      env.DB.prepare("INSERT INTO recovery_codes (code_hash) VALUES ('hash-recuperacion-jkl')"),
    ]);

    const response = await send("GET", "/api/backup");
    expect(response.status).toBe(200);
    const text = await response.text();
    for (const forbidden of [
      "passkeys",
      "passkey",
      "key_hash",
      "keyHash",
      "hash-de-clave-789",
      "cred-secreta-123",
      "pk-secreta-456",
      "push.example",
      "hash-recuperacion-jkl",
      "token_hash",
      "sessions",
      "hookKeys",
      "recovery",
    ]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });
});

// --- Importar ---

describe("POST /api/backup/import", () => {
  it("exportar, vaciar, importar y volver a exportar da lo mismo", async () => {
    await seedRichData();
    const first = await exportBackup();
    // Que el test mida algo: hay de todo y no es trivial.
    expect(first.exercises).toHaveLength(4);
    expect(first.routines).toHaveLength(3);
    expect(first.workouts).toHaveLength(6);
    expect(first.workouts.flatMap((w: Json) => w.exercises.flatMap((e: Json) => e.sets))).toHaveLength(10);

    await wipeData();
    expect((await exportBackup()).workouts).toEqual([]);

    const response = await importBackup(first);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      imported: { exercises: 4, routines: 3, workouts: 6, bodyMetrics: 2, dailySteps: 2, creatineLogs: 2 },
    });

    const second = await exportBackup();
    expect(withoutTimestamp(second)).toEqual(withoutTimestamp(first));
    expect(second.settings.notifications.today).toEqual({ enabled: false, time: "07:30" });
  });

  it("es idempotente: importar dos veces la misma copia deja lo mismo", async () => {
    await seedRichData();
    const first = await exportBackup();
    expect((await importBackup(first)).status).toBe(200);
    expect((await importBackup(first)).status).toBe(200);
    expect(withoutTimestamp(await exportBackup())).toEqual(withoutTimestamp(first));
    expect(await count("workouts")).toBe(6);
    expect(await count("sets")).toBe(10);
  });

  it("sustituye lo que había: lo que no está en la copia desaparece", async () => {
    await seedRichData();
    const response = await importBackup(smallBackup());
    expect(response.status).toBe(200);

    const after = await exportBackup();
    expect(withoutTimestamp(after)).toEqual(withoutTimestamp(smallBackup()));
    expect(await count("exercises")).toBe(2);
    expect(await count("routines")).toBe(1);
    expect(await count("routine_items")).toBe(1);
    expect(await count("workouts")).toBe(1);
    expect(await count("workout_exercises")).toBe(1);
    expect(await count("sets")).toBe(1);
    expect(await count("body_metrics")).toBe(1);
    expect(await count("daily_steps")).toBe(1);
    expect(await count("creatine_logs")).toBe(1);
  });

  it("una copia con listas vacías borra los datos y aplica los ajustes", async () => {
    await seedRichData();
    const empty = {
      ...smallBackup(),
      exercises: [],
      routines: [],
      workouts: [],
      bodyMetrics: [],
      dailySteps: [],
      creatineLogs: [],
    };
    expect((await importBackup(empty)).status).toBe(200);
    for (const table of [...DATA_TABLES, "body_metrics", "daily_steps", "creatine_logs"]) {
      expect(await count(table), table).toBe(0);
    }
    expect((await (await send("GET", "/api/settings")).json()) as Json).toMatchObject({ displayName: "Victor" });
  });

  it("no borra la fila de ajustes: la actualiza, y /api/settings la lee", async () => {
    const backup = smallBackup();
    backup.settings = {
      ...backup.settings,
      displayName: "Lucía",
      theme: "teal",
      timezone: "Europe/London",
      weeklyGoal: 6,
      notifications: {
        ...backup.settings.notifications,
        weight: { enabled: false, time: "07:05" },
      },
    };
    expect((await importBackup(backup)).status).toBe(200);
    expect(await count("settings")).toBe(1);
    const settings = await (await send("GET", "/api/settings")).json();
    expect(settings).toEqual(backup.settings);
  });

  it("no toca passkeys, sesiones, claves, suscripciones, códigos ni los avisos ya enviados", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO passkeys (credential_id, public_key) VALUES ('cred-1', 'pk-1')"),
      env.DB.prepare("INSERT INTO hook_keys (id, label, key_hash) VALUES ('hk-1', 'Atajo', 'hash-1')"),
      env.DB.prepare("INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES ('https://push.example/e', 'p', 'a')"),
      env.DB.prepare("INSERT INTO recovery_codes (code_hash) VALUES ('rc-1')"),
      env.DB.prepare("INSERT INTO notifications_sent (type, local_date) VALUES ('today', '2026-11-09')"),
    ]);
    await env.DB.prepare("INSERT OR REPLACE INTO sessions (token_hash, expires_at) VALUES ('sesion-previa', '2099-01-01T00:00:00.000Z')").run();

    expect((await importBackup(smallBackup())).status).toBe(200);

    expect(await count("passkeys")).toBe(1);
    expect(await count("hook_keys")).toBe(1);
    expect(await count("push_subscriptions")).toBe(1);
    expect(await count("recovery_codes")).toBe(1);
    expect(await count("notifications_sent")).toBe(1);
    const session = await env.DB.prepare("SELECT 1 AS found FROM sessions WHERE token_hash = 'sesion-previa'").first();
    expect(session).not.toBeNull();
  });

  it("conserva el orden de las rutinas y de sus ítems", async () => {
    const backup = smallBackup();
    const item = (exerciseId: string, position: number) => ({ exerciseId, position, sets: 3, repsTarget: "10", restSeconds: 60 });
    backup.routines = [
      { id: "r-3", name: "Tercera", inRotation: true, rotationOrder: 2, archived: false, items: [item("ex-a", 0)] },
      { id: "r-1", name: "Primera", inRotation: true, rotationOrder: 0, archived: false, items: [item("ex-b", 0), item("ex-a", 1), item("ex-b", 2)] },
      { id: "r-2", name: "Segunda", inRotation: false, rotationOrder: 0, archived: true, items: [] },
    ];
    backup.workouts = [];
    expect((await importBackup(backup)).status).toBe(200);
    const first = await exportBackup();
    expect(first.routines.map((r: Json) => r.id)).toEqual(["r-1", "r-2", "r-3"]);
    expect(first.routines[0].items.map((i: Json) => i.exerciseId)).toEqual(["ex-b", "ex-a", "ex-b"]);

    // Y vuelve a dar lo mismo al reimportar lo exportado.
    expect((await importBackup(first)).status).toBe(200);
    expect(withoutTimestamp(await exportBackup())).toEqual(withoutTimestamp(first));
  });

  it("acepta una copia mayor de 1 MB repartida en varios fragmentos sin mezclar series entre entrenos", async () => {
    const backup = smallBackup();
    const workouts: Json[] = [];
    // 250 entrenos de 100 series: unos 1,9 MB de JSON, dos fragmentos como mínimo.
    for (let i = 0; i < 250; i++) {
      const day = String(1 + (i % 28)).padStart(2, "0");
      workouts.push({
        id: `big-${String(i).padStart(3, "0")}`,
        routineId: i % 2 === 0 ? "r-a" : null,
        startedAt: `2026-10-${day}T${String(i % 24).padStart(2, "0")}:00:00.000Z`,
        endedAt: `2026-10-${day}T${String(i % 24).padStart(2, "0")}:30:00.000Z`,
        localDate: `2026-10-${day}`,
        notes: "",
        source: "live",
        exercises: [
          {
            exerciseId: i % 3 === 0 ? "ex-a" : "ex-b",
            sets: Array.from({ length: 100 }, (_, j) => ({ weightKg: i + j / 100, reps: j, rir: null, durationMin: null, distanceKm: null })),
          },
        ],
      });
    }
    backup.workouts = workouts;
    expect(JSON.stringify(backup).length).toBeGreaterThan(1_500_000);

    const response = await importBackup(backup);
    expect(response.status).toBe(200);
    expect(await count("workouts")).toBe(250);
    expect(await count("workout_exercises")).toBe(250);
    expect(await count("sets")).toBe(25_000);

    const byId = (list: Json[]) => [...list].sort((a, b) => a.id.localeCompare(b.id));
    const after = await exportBackup();
    expect(byId(after.workouts)).toEqual(byId(workouts));
  });
});

describe("POST /api/backup/import no válido", () => {
  type Mutate = (backup: Json) => unknown;

  const cases: [string, Mutate][] = [
    ["versión desconocida", (b) => ({ ...b, version: 2 })],
    ["sin ajustes", ({ settings: _settings, ...rest }) => rest],
    ["sin entrenos", ({ workouts: _workouts, ...rest }) => rest],
    ["ejercicio sin nombre", (b) => ({ ...b, exercises: [{ ...b.exercises[0], name: "  " }] })],
    ["categoría desconocida", (b) => ({ ...b, exercises: [{ ...b.exercises[0], category: "yoga" }] })],
    ["enlace que no es https", (b) => ({ ...b, exercises: [{ ...b.exercises[0], mediaUrl: "http://example.com/a.mp4" }] })],
    ["fecha imposible", (b) => ({ ...b, bodyMetrics: [{ localDate: "2026-02-30", weightKg: 70, bodyFatPct: null }] })],
    ["pasos negativos", (b) => ({ ...b, dailySteps: [{ localDate: "2026-11-05", steps: -1 }] })],
    ["hora de aviso no válida", (b) => ({ ...b, settings: { ...b.settings, notifications: { ...b.settings.notifications, today: { enabled: true, time: "25:00" } } } })],
    ["aviso que falta", (b) => {
      const { weight: _weight, ...notifications } = b.settings.notifications;
      return { ...b, settings: { ...b.settings, notifications } };
    }],
    ["zona horaria desconocida", (b) => ({ ...b, settings: { ...b.settings, timezone: "Marte/Olympus" } })],
    ["ítem de rutina con un ejercicio que no existe", (b) => ({
      ...b,
      routines: [{ ...b.routines[0], items: [{ ...b.routines[0].items[0], exerciseId: "fantasma" }] }],
    })],
    ["entreno con un ejercicio que no existe", (b) => ({
      ...b,
      workouts: [{ ...b.workouts[0], exercises: [{ exerciseId: "fantasma", sets: [] }] }],
    })],
    ["entreno de una rutina que no existe", (b) => ({ ...b, workouts: [{ ...b.workouts[0], routineId: "fantasma" }] })],
    ["ids de ejercicio repetidos", (b) => ({ ...b, exercises: [b.exercises[0], { ...b.exercises[1], id: "ex-a" }] })],
    ["ids de rutina repetidos", (b) => ({ ...b, routines: [b.routines[0], b.routines[0]] })],
    ["ids de entreno repetidos", (b) => ({ ...b, workouts: [b.workouts[0], b.workouts[0]] })],
    ["dos pesos el mismo día", (b) => ({ ...b, bodyMetrics: [b.bodyMetrics[0], b.bodyMetrics[0]] })],
    ["dos registros de pasos el mismo día", (b) => ({ ...b, dailySteps: [b.dailySteps[0], b.dailySteps[0]] })],
    ["dos tomas de creatina el mismo día", (b) => ({ ...b, creatineLogs: [b.creatineLogs[0], b.creatineLogs[0]] })],
    ["una lista que no es lista", (b) => ({ ...b, exercises: "nada" })],
    ["un array en vez de la copia", () => []],
    ["null", () => null],
    ["un objeto vacío", () => ({})],
  ];

  it.each(cases)("%s: responde 400 y deja los datos intactos", async (_name, mutate) => {
    await seedRichData();
    const before = withoutTimestamp(await exportBackup());

    const response = await importBackup(mutate(smallBackup()));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: expect.any(String) });

    expect(withoutTimestamp(await exportBackup())).toEqual(before);
  });

  it.each([
    ["JSON mal formado", "{ no es json"],
    ["cuerpo vacío", ""],
  ])("%s: responde 400 y deja los datos intactos", async (_name, body) => {
    await seedRichData();
    const before = withoutTimestamp(await exportBackup());

    const response = await send("POST", "/api/backup/import", { body, headers: { "Content-Type": "application/json" } });
    expect(response.status).toBe(400);

    expect(withoutTimestamp(await exportBackup())).toEqual(before);
  });

  it("el error de una referencia rota dice qué pasa", async () => {
    const backup = smallBackup();
    backup.workouts[0].exercises[0].exerciseId = "fantasma";
    const response = await importBackup(backup);
    expect(response.status).toBe(400);
    expect(((await response.json()) as Json).error).toMatch(/ejercicio/i);
  });
});

// --- Fragmentos ---

describe("chunkJson", () => {
  it("sin elementos no devuelve fragmentos", () => {
    expect(chunkJson([], 100)).toEqual([]);
  });

  it("cabe todo en un fragmento si no pasa del límite", () => {
    const items = [{ a: 1 }, { a: 2 }, { a: 3 }];
    expect(chunkJson(items, 1000)).toEqual([JSON.stringify(items)]);
  });

  it("reparte en fragmentos que no pasan del límite en bytes UTF-8, sin perder ni reordenar elementos", () => {
    // Cada elemento mide unos 40 bytes; "€" son 3 bytes y "ñ", 2: contar caracteres no bastaría.
    const items = Array.from({ length: 50 }, (_, i) => ({ i, text: i % 2 === 0 ? "€€€€€€€€€€" : "ñññññññññññññ" }));
    const max = 200;
    const chunks = chunkJson(items, max);
    expect(chunks.length).toBeGreaterThan(5);
    for (const chunk of chunks) {
      expect(new TextEncoder().encode(chunk).length).toBeLessThanOrEqual(max);
      expect(Array.isArray(JSON.parse(chunk))).toBe(true);
    }
    expect(chunks.flatMap((chunk) => JSON.parse(chunk))).toEqual(items);
  });

  it("un elemento que él solo pasa del límite va en su propio fragmento", () => {
    const big = { text: "x".repeat(300) };
    const chunks = chunkJson([{ n: 1 }, big, { n: 2 }], 100);
    expect(chunks.map((chunk) => JSON.parse(chunk))).toEqual([[{ n: 1 }], [big], [{ n: 2 }]]);
  });
});
