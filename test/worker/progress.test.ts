import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { addDays, localDate, weekStart } from "../../src/shared/dates";
import { ORIGIN, send } from "./helpers";

type Json = Record<string, any>;

type SeedSet = { weightKg?: number | null; reps?: number | null; durationMin?: number | null; distanceKm?: number | null };
type SeedExercise = { exerciseId: string; sets: SeedSet[] };

const TODAY = localDate(new Date(), "Europe/Madrid");
const ago = (days: number) => addDays(TODAY, -days);

/** GET que tiene que responder 200 y no llevar Infinity ni NaN. */
async function get(path: string): Promise<Json> {
  const response = await send("GET", path);
  expect(response.status).toBe(200);
  const text = await response.text();
  expect(text).not.toMatch(/Infinity|NaN/);
  return JSON.parse(text);
}

// --- Datos de partida ---

async function insertExercise(id: string, category = "strength", archived = false): Promise<void> {
  await env.DB.prepare("INSERT INTO exercises (id, name, category, archived) VALUES (?, ?, ?, ?)")
    .bind(id, id, category, archived ? 1 : 0)
    .run();
}

/** Un entreno con la fecha local `date`. `hourUtc` ordena los de un mismo día. */
async function insertWorkout(id: string, date: string, exercises: SeedExercise[] = [], hourUtc = 10): Promise<void> {
  const startedAt = `${date}T${String(hourUtc).padStart(2, "0")}:00:00.000Z`;
  const endedAt = `${date}T${String(hourUtc + 1).padStart(2, "0")}:00:00.000Z`;
  await env.DB.prepare(
    "INSERT INTO workouts (id, routine_id, started_at, ended_at, local_date, source) VALUES (?, NULL, ?, ?, ?, 'live')",
  )
    .bind(id, startedAt, endedAt, date)
    .run();
  for (const [position, exercise] of exercises.entries()) {
    const inserted = await env.DB.prepare(
      "INSERT INTO workout_exercises (workout_id, exercise_id, position) VALUES (?, ?, ?) RETURNING id",
    )
      .bind(id, exercise.exerciseId, position)
      .first<{ id: number }>();
    for (const [setPosition, set] of exercise.sets.entries()) {
      await env.DB.prepare(
        "INSERT INTO sets (workout_exercise_id, position, weight_kg, reps, duration_min, distance_km) VALUES (?, ?, ?, ?, ?, ?)",
      )
        .bind(inserted?.id, setPosition, set.weightKg ?? null, set.reps ?? null, set.durationMin ?? null, set.distanceKm ?? null)
        .run();
    }
  }
}

async function insertWeight(date: string, weightKg: number, bodyFatPct: number | null = null): Promise<void> {
  await env.DB.prepare("INSERT INTO body_metrics (local_date, weight_kg, body_fat_pct) VALUES (?, ?, ?)")
    .bind(date, weightKg, bodyFatPct)
    .run();
}

async function insertSteps(date: string, steps: number): Promise<void> {
  await env.DB.prepare("INSERT INTO daily_steps (local_date, steps) VALUES (?, ?)").bind(date, steps).run();
}

async function insertCreatine(date: string): Promise<void> {
  await env.DB.prepare("INSERT INTO creatine_logs (local_date, grams, source) VALUES (?, 5, 'nfc')").bind(date).run();
}

const strength = (...sets: [number, number][]): SeedSet[] => sets.map(([weightKg, reps]) => ({ weightKg, reps }));

beforeEach(async () => {
  // El almacenamiento D1 no se aísla entre tests del mismo archivo: se vacía en orden de dependencias.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sets"),
    env.DB.prepare("DELETE FROM workout_exercises"),
    env.DB.prepare("DELETE FROM workouts"),
    env.DB.prepare("DELETE FROM exercises"),
    env.DB.prepare("DELETE FROM body_metrics"),
    env.DB.prepare("DELETE FROM daily_steps"),
    env.DB.prepare("DELETE FROM creatine_logs"),
    env.DB.prepare("DELETE FROM settings"),
    env.DB.prepare("INSERT INTO settings (id) VALUES (1)"),
  ]);
  await insertExercise("bench");
  await insertExercise("run", "cardio");
});

describe("acceso", () => {
  it.each([
    "/api/progress/weight",
    "/api/progress/week",
    "/api/progress/exercise/bench",
  ])("GET %s sin sesión responde 401", async (path) => {
    expect((await exports.default.fetch(`${ORIGIN}${path}`)).status).toBe(401);
  });
});

describe("con la base de datos vacía", () => {
  const EMPTY_WEEK = { workouts: 0, volumeKg: 0, cardioMin: 0, cardioKm: 0, avgSteps: null, creatineDays: 0 };

  it("no hay puntos de peso", async () => {
    for (const range of ["4w", "12w", "all"]) {
      expect(await get(`/api/progress/weight?range=${range}`)).toEqual({ points: [] });
    }
  });

  it("la semana está a cero, sin media de pasos y sin racha", async () => {
    expect(await get("/api/progress/week")).toEqual({ current: EMPTY_WEEK, previous: EMPTY_WEEK, streak: 0, goal: 3 });
  });

  it("un ejercicio sin entrenos no tiene sesiones ni récords", async () => {
    expect(await get("/api/progress/exercise/bench")).toEqual({ sessions: [], records: {} });
    expect(await get("/api/progress/exercise/run")).toEqual({ sessions: [], records: {} });
  });
});

describe("GET /api/progress/weight", () => {
  it("devuelve los puntos de menor a mayor fecha, con la grasa y null si no hay", async () => {
    await insertWeight(ago(0), 80, 18.5);
    await insertWeight(ago(2), 82);
    await insertWeight(ago(1), 81);

    const { points } = await get("/api/progress/weight?range=all");
    expect(points).toEqual([
      { localDate: ago(2), weightKg: 82, bodyFatPct: null, avg7: 82 },
      { localDate: ago(1), weightKg: 81, bodyFatPct: null, avg7: 81.5 },
      { localDate: ago(0), weightKg: 80, bodyFatPct: 18.5, avg7: 81 },
    ]);
  });

  it("con menos de 7 puntos avg7 usa los que haya", async () => {
    await insertWeight(ago(2), 80);
    await insertWeight(ago(1), 81);
    await insertWeight(ago(0), 82);

    const { points } = await get("/api/progress/weight?range=all");
    expect(points.map((point: Json) => point.avg7)).toEqual([80, 80.5, 81]);
  });

  it("avg7 es la media de la ventana natural de 7 días que acaba en el punto, con huecos", async () => {
    await insertWeight(ago(10), 70);
    await insertWeight(ago(3), 80);
    await insertWeight(ago(0), 82);

    const { points } = await get("/api/progress/weight?range=all");
    // ago(10) queda fuera de la ventana de ago(3) (ago(9)…ago(3)) y de la de hoy (ago(6)…hoy).
    expect(points.map((point: Json) => point.avg7)).toEqual([70, 80, 81]);
  });

  it("la ventana incluye el día de hace 6 días y excluye el de hace 7", async () => {
    await insertWeight(ago(7), 60);
    await insertWeight(ago(6), 70);
    await insertWeight(ago(0), 80);

    const { points } = await get("/api/progress/weight?range=all");
    // ago(6): ventana ago(12)…ago(6) → 60, 70. Hoy: ago(6)…hoy → 70, 80 (sin el de ago(7)).
    expect(points.map((point: Json) => point.avg7)).toEqual([60, 65, 75]);
  });

  it("con 7 o más puntos en la ventana usa los 7 días y redondea a 2 decimales", async () => {
    const weights = [80.1, 80.2, 80.4, 79.9, 80.0, 80.3, 80.6, 81.1];
    for (const [i, weight] of weights.entries()) await insertWeight(ago(weights.length - 1 - i), weight);

    const { points } = await get("/api/progress/weight?range=all");
    expect(points).toHaveLength(8);
    // Primer punto: solo él. Tercero: (80,1 + 80,2 + 80,4) / 3 = 80,2333…
    expect(points[0].avg7).toBe(80.1);
    expect(points[2].avg7).toBe(80.23);
    // Último: ventana de los últimos 7 días = los 7 últimos pesos.
    expect(points[7].avg7).toBe(80.36);
  });

  it("4w son los últimos 28 días incluido hoy, 12w los últimos 84 y all todo", async () => {
    for (const days of [0, 27, 28, 83, 84, 200]) await insertWeight(ago(days), 80);

    const dates = async (range: string) =>
      (await get(`/api/progress/weight?range=${range}`)).points.map((point: Json) => point.localDate);
    expect(await dates("4w")).toEqual([ago(27), ago(0)]);
    expect(await dates("12w")).toEqual([ago(83), ago(28), ago(27), ago(0)]);
    expect(await dates("all")).toEqual([ago(200), ago(84), ago(83), ago(28), ago(27), ago(0)]);
  });

  it("avg7 del primer punto del rango usa también los pesos anteriores al rango", async () => {
    await insertWeight(ago(29), 82);
    await insertWeight(ago(27), 80);
    await insertWeight(ago(0), 78);

    const { points } = await get("/api/progress/weight?range=4w");
    expect(points).toEqual([
      { localDate: ago(27), weightKg: 80, bodyFatPct: null, avg7: 81 },
      { localDate: ago(0), weightKg: 78, bodyFatPct: null, avg7: 78 },
    ]);
  });

  it("sin range usa 12w", async () => {
    await insertWeight(ago(83), 80);
    await insertWeight(ago(84), 81);
    const { points } = await get("/api/progress/weight");
    expect(points.map((point: Json) => point.localDate)).toEqual([ago(83)]);
  });

  it("el rango se cuenta desde hoy en la zona horaria de los ajustes", async () => {
    await env.DB.prepare("UPDATE settings SET timezone = 'Pacific/Kiritimati'").run();
    const today = localDate(new Date(), "Pacific/Kiritimati");
    await insertWeight(addDays(today, -27), 80);
    await insertWeight(addDays(today, -28), 81);
    const { points } = await get("/api/progress/weight?range=4w");
    expect(points.map((point: Json) => point.localDate)).toEqual([addDays(today, -27)]);
  });

  it.each(["1y", "", "4W", "todo"])("range=%s no válido responde 400", async (range) => {
    const response = await send("GET", `/api/progress/weight?range=${range}`);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: expect.any(String) });
  });
});

describe("GET /api/progress/week", () => {
  async function seedTwoWeeks(): Promise<void> {
    // Semana actual: lunes 2026-11-09 a domingo 15. Anterior: 2 a 8.
    await insertWorkout("c1", "2026-11-09", [
      { exerciseId: "bench", sets: strength([60, 8], [60, 8]) },
      { exerciseId: "run", sets: [{ durationMin: 20, distanceKm: 3.2 }] },
    ]);
    await insertWorkout("c2", "2026-11-11", [
      { exerciseId: "bench", sets: strength([50, 10]) },
      { exerciseId: "run", sets: [{ durationMin: 15.5, distanceKm: 5.1 }] },
    ]);
    await insertWorkout("p1", "2026-11-03", [{ exerciseId: "bench", sets: strength([100, 5]) }]);
    await insertWorkout("p2", "2026-11-08", [{ exerciseId: "bench", sets: strength([20, 10]) }]);
    // Fuera de las dos semanas: no cuentan.
    await insertWorkout("antes", "2026-11-01", [{ exerciseId: "bench", sets: strength([999, 9]) }]);
    await insertWorkout("despues", "2026-11-16", [{ exerciseId: "bench", sets: strength([999, 9]) }]);

    await insertSteps("2026-11-09", 8000);
    await insertSteps("2026-11-10", 6000);
    await insertSteps("2026-11-11", 0);
    await insertSteps("2026-11-08", 10000);
    await insertSteps("2026-11-16", 20000);
    await insertCreatine("2026-11-09");
    await insertCreatine("2026-11-10");
    await insertCreatine("2026-11-16");
  }

  it("resume la semana pedida y la anterior, de lunes a domingo", async () => {
    await seedTwoWeeks();
    const body = await get("/api/progress/week?start=2026-11-09");
    expect(body.current).toEqual({
      workouts: 2,
      volumeKg: 1460,
      cardioMin: 35.5,
      // 3,2 + 5,1 = 8,299999999999999 en coma flotante.
      cardioKm: 8.3,
      // (8000 + 6000 + 0) / 3 = 4666,666…: el día con 0 pasos es un día con datos.
      avgSteps: 4666.67,
      creatineDays: 2,
    });
    expect(body.previous).toEqual({
      workouts: 2,
      volumeKg: 700,
      cardioMin: 0,
      cardioKm: 0,
      avgSteps: 10000,
      creatineDays: 0,
    });
    expect(body.goal).toBe(3);
  });

  it("si start no es lunes usa el lunes de esa semana", async () => {
    await seedTwoWeeks();
    const monday = await get("/api/progress/week?start=2026-11-09");
    for (const start of ["2026-11-12", "2026-11-15"]) {
      const body = await get(`/api/progress/week?start=${start}`);
      expect(body.current).toEqual(monday.current);
      expect(body.previous).toEqual(monday.previous);
    }
  });

  it("sin start usa la semana de hoy en la zona horaria de los ajustes", async () => {
    await insertWorkout("hoy", TODAY, [{ exerciseId: "bench", sets: strength([60, 10]) }]);
    await insertWorkout("pasada", addDays(weekStart(TODAY), -7), [{ exerciseId: "bench", sets: strength([40, 10]) }]);
    const body = await get("/api/progress/week");
    expect(body.current).toMatchObject({ workouts: 1, volumeKg: 600 });
    expect(body.previous).toMatchObject({ workouts: 1, volumeKg: 400 });
  });

  it("goal es el objetivo semanal de los ajustes", async () => {
    await send("PATCH", "/api/settings", { body: { weeklyGoal: 5 } });
    expect((await get("/api/progress/week")).goal).toBe(5);
  });

  it("la racha cuenta las semanas cumplidas hasta hoy, sea cual sea la semana pedida", async () => {
    const monday = weekStart(TODAY);
    for (let i = 0; i < 3; i++) await insertWorkout(`actual${i}`, TODAY, [], 8 + i * 2);
    for (let i = 0; i < 3; i++) await insertWorkout(`pasada${i}`, addDays(monday, -7), [], 8 + i * 2);

    expect((await get("/api/progress/week")).streak).toBe(2);
    expect((await get("/api/progress/week?start=2026-01-05")).streak).toBe(2);
  });

  it("los entrenos sin series no suman volumen", async () => {
    await insertWorkout("vacio", "2026-11-10", [{ exerciseId: "bench", sets: [] }]);
    const body = await get("/api/progress/week?start=2026-11-09");
    expect(body.current).toMatchObject({ workouts: 1, volumeKg: 0 });
  });

  it.each(["2026-02-30", "lunes", "", "09-11-2026"])("start=%s no válido responde 400", async (start) => {
    const response = await send("GET", `/api/progress/week?start=${start}`);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: expect.any(String) });
  });
});

describe("GET /api/progress/exercise/:id", () => {
  it("lista las sesiones de menor a mayor fecha con sus estadísticas y los récords de fuerza", async () => {
    // Insertados en desorden para comprobar la ordenación.
    await insertWorkout("w2", "2026-11-09", [{ exerciseId: "bench", sets: strength([62.5, 5], [50, 12]) }]);
    await insertWorkout("w1", "2026-11-02", [{ exerciseId: "bench", sets: strength([60, 8], [60, 8]) }]);
    await insertWorkout("otro", "2026-11-05", [{ exerciseId: "run", sets: [{ durationMin: 20, distanceKm: 4 }] }]);

    const body = await get("/api/progress/exercise/bench");
    expect(body.sessions).toEqual([
      { localDate: "2026-11-02", maxWeight: 60, best1RM: 76, volume: 960, maxDistance: null, bestPace: null },
      // 62,5 × (1 + 5/30) = 72,9 → 73 (0,5 kg más cercano); 50 × (1 + 12/30) = 70.
      { localDate: "2026-11-09", maxWeight: 62.5, best1RM: 73, volume: 912.5, maxDistance: null, bestPace: null },
    ]);
    expect(body.records).toEqual({
      maxWeight: { value: 62.5, localDate: "2026-11-09" },
      // 60 × 8 (76) supera a 62,5 × 5 (73): el mejor peso y el mejor 1RM son de sesiones distintas.
      best1RM: { value: 76, localDate: "2026-11-02" },
      volume: { value: 960, localDate: "2026-11-02" },
    });
  });

  it("en cardio hay distancia y ritmo, y solo récords de cardio", async () => {
    await insertWorkout("r1", "2026-11-02", [
      {
        exerciseId: "run",
        sets: [
          { durationMin: 20, distanceKm: 4 },
          { durationMin: 10, distanceKm: 2 },
        ],
      },
    ]);
    // Una serie con peso y repeticiones en un ejercicio de cardio no genera récords de fuerza.
    await insertWorkout("r2", "2026-11-09", [
      {
        exerciseId: "run",
        sets: [
          { durationMin: 30, distanceKm: 5 },
          { weightKg: 10, reps: 10 },
        ],
      },
    ]);

    const body = await get("/api/progress/exercise/run");
    expect(body.sessions).toEqual([
      { localDate: "2026-11-02", maxWeight: null, best1RM: null, volume: 0, maxDistance: 4, bestPace: 5 },
      { localDate: "2026-11-09", maxWeight: 10, best1RM: 13.5, volume: 100, maxDistance: 5, bestPace: 6 },
    ]);
    expect(Object.keys(body.records).sort()).toEqual(["bestPace", "maxDistance"]);
    expect(body.records).toEqual({
      maxDistance: { value: 5, localDate: "2026-11-09" },
      bestPace: { value: 5, localDate: "2026-11-02" },
    });
  });

  it("en fuerza no hay récords de cardio aunque haya una serie con distancia", async () => {
    await insertWorkout("w1", "2026-11-02", [
      { exerciseId: "bench", sets: [{ weightKg: 60, reps: 8 }, { durationMin: 10, distanceKm: 2 }] },
    ]);
    const body = await get("/api/progress/exercise/bench");
    expect(Object.keys(body.records).sort()).toEqual(["best1RM", "maxWeight", "volume"]);
  });

  it("si el ejercicio sale dos veces en un entreno junta sus series en una sesión", async () => {
    await insertWorkout("w1", "2026-11-02", [
      { exerciseId: "bench", sets: strength([60, 5]) },
      { exerciseId: "run", sets: [{ durationMin: 10, distanceKm: 2 }] },
      { exerciseId: "bench", sets: strength([60, 5], [70, 3]) },
    ]);
    const body = await get("/api/progress/exercise/bench");
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0]).toMatchObject({ maxWeight: 70, volume: 810 });
  });

  it("dos entrenos el mismo día son dos sesiones, por orden de inicio", async () => {
    await insertWorkout("tarde", "2026-11-02", [{ exerciseId: "bench", sets: strength([70, 5]) }], 17);
    await insertWorkout("manana", "2026-11-02", [{ exerciseId: "bench", sets: strength([60, 5]) }], 8);
    const body = await get("/api/progress/exercise/bench");
    expect(body.sessions.map((session: Json) => session.maxWeight)).toEqual([60, 70]);
  });

  it("omite las sesiones sin ninguna serie con datos", async () => {
    await insertWorkout("sin-series", "2026-11-02", [{ exerciseId: "bench", sets: [] }]);
    await insertWorkout("sin-peso", "2026-11-03", [{ exerciseId: "bench", sets: [{ weightKg: null, reps: 10 }, { weightKg: 0, reps: 10 }] }]);
    await insertWorkout("buena", "2026-11-04", [{ exerciseId: "bench", sets: strength([60, 8]) }]);

    const body = await get("/api/progress/exercise/bench");
    expect(body.sessions.map((session: Json) => session.localDate)).toEqual(["2026-11-04"]);
  });

  it("un ejercicio archivado también tiene progreso", async () => {
    await insertExercise("viejo", "strength", true);
    await insertWorkout("w1", "2026-11-02", [{ exerciseId: "viejo", sets: strength([40, 10]) }]);
    const body = await get("/api/progress/exercise/viejo");
    expect(body.sessions).toHaveLength(1);
  });

  it("un ejercicio que no existe responde 404", async () => {
    const response = await send("GET", "/api/progress/exercise/no-existe");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: expect.any(String) });
  });
});
