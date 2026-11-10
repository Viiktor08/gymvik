import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { localDate } from "../../src/shared/dates";
import { ORIGIN, send } from "./helpers";

type Json = Record<string, any>;

async function json(response: Response): Promise<any> {
  return response.json();
}

/** GET /api/today, que tiene que responder 200 y no llevar Infinity ni NaN. */
async function today(query = ""): Promise<Json> {
  const response = await send("GET", `/api/today${query}`);
  expect(response.status).toBe(200);
  const text = await response.text();
  expect(text).not.toMatch(/Infinity|NaN/);
  return JSON.parse(text);
}

// --- Datos de partida ---

async function insertExercise(id: string, category = "strength"): Promise<void> {
  await env.DB.prepare("INSERT INTO exercises (id, name, category) VALUES (?, ?, ?)").bind(id, id, category).run();
}

/** Rutina con un ejercicio de `sets` series y `restSeconds` de descanso, en la rotación si `rotation` no es null. */
async function insertRoutine(
  id: string,
  options: { rotation?: number | null; archived?: boolean; sets?: number; restSeconds?: number } = {},
): Promise<void> {
  const { rotation = null, archived = false, sets = 3, restSeconds = 90 } = options;
  await env.DB.prepare(
    "INSERT INTO routines (id, name, in_rotation, rotation_order, archived) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(id, `Rutina ${id}`, rotation === null ? 0 : 1, rotation ?? 0, archived ? 1 : 0)
    .run();
  await env.DB.prepare(
    "INSERT INTO routine_items (routine_id, exercise_id, position, sets, reps_target, rest_seconds) VALUES (?, 'bench', 0, ?, '8-10', ?)",
  )
    .bind(id, sets, restSeconds)
    .run();
}

/** Un entreno con la misma fecha local que `date` (10:00 UTC cae el mismo día en Europa/Madrid). */
async function insertWorkout(id: string, date: string, routineId: string | null = null, hourUtc = 10): Promise<void> {
  const startedAt = `${date}T${String(hourUtc).padStart(2, "0")}:00:00.000Z`;
  await env.DB.prepare(
    "INSERT INTO workouts (id, routine_id, started_at, ended_at, local_date, source) VALUES (?, ?, ?, ?, ?, 'live')",
  )
    .bind(id, routineId, startedAt, `${date}T${String(hourUtc + 1).padStart(2, "0")}:00:00.000Z`, date)
    .run();
}

async function insertWeight(date: string, weightKg: number, bodyFatPct: number | null = null): Promise<void> {
  await env.DB.prepare("INSERT INTO body_metrics (local_date, weight_kg, body_fat_pct) VALUES (?, ?, ?)")
    .bind(date, weightKg, bodyFatPct)
    .run();
}

beforeEach(async () => {
  // El almacenamiento D1 no se aísla entre tests del mismo archivo: se vacía en orden de dependencias.
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
  await insertExercise("bench");
  await insertExercise("run", "cardio");
});

describe("acceso", () => {
  it("GET /api/today sin sesión responde 401", async () => {
    const response = await exports.default.fetch(`${ORIGIN}/api/today`);
    expect(response.status).toBe(401);
  });
});

describe("GET /api/today con la base de datos vacía", () => {
  it("no tiene rutina, peso ni pasos, y la racha es 0", async () => {
    const body = await today("?date=2026-11-12");
    expect(body).toEqual({
      date: "2026-11-12",
      displayName: "Victor",
      streak: 0,
      next: null,
      steps: null,
      stepsGoal: 8000,
      lastWeight: null,
      weekWeightDelta: null,
      creatineToday: false,
      week: { count: 0, goal: 3, days: [false, false, false, false, false, false, false] },
    });
  });

  it("sin rutinas en rotación next es null aunque haya rutinas", async () => {
    await insertRoutine("libre", { rotation: null });
    await insertRoutine("vieja", { rotation: 0, archived: true });
    expect((await today("?date=2026-11-12")).next).toBeNull();
  });
});

describe("la fecha", () => {
  it("por defecto es hoy en la zona horaria de los ajustes", async () => {
    expect((await today()).date).toBe(localDate(new Date(), "Europe/Madrid"));

    await env.DB.prepare("UPDATE settings SET timezone = 'Pacific/Kiritimati'").run();
    expect((await today()).date).toBe(localDate(new Date(), "Pacific/Kiritimati"));
    await env.DB.prepare("UPDATE settings SET timezone = 'Pacific/Pago_Pago'").run();
    expect((await today()).date).toBe(localDate(new Date(), "Pacific/Pago_Pago"));
  });

  it("se puede pedir otra con ?date=", async () => {
    expect((await today("?date=2026-01-31")).date).toBe("2026-01-31");
  });

  it.each(["2026-02-30", "hoy", "09-11-2026", "", "2026-11-9"])("?date=%s no válida responde 400", async (date) => {
    const response = await send("GET", `/api/today?date=${date}`);
    expect(response.status).toBe(400);
    expect(await json(response)).toEqual({ error: expect.any(String) });
  });
});

describe("la semana y la racha", () => {
  it("4 entrenos con objetivo 3 cuentan 4, la semana está cumplida y la racha es al menos 1", async () => {
    // Semana del lunes 2026-11-09 al domingo 2026-11-15.
    await insertWorkout("w1", "2026-11-09");
    await insertWorkout("w2", "2026-11-10");
    await insertWorkout("w3", "2026-11-11");
    await insertWorkout("w4", "2026-11-12");

    const body = await today("?date=2026-11-12");
    expect(body.week).toEqual({ count: 4, goal: 3, days: [true, true, true, true, false, false, false] });
    expect(body.streak).toBeGreaterThanOrEqual(1);
    expect(body.streak).toBe(1);
  });

  it("dos entrenos el mismo día cuentan 2 pero marcan un solo día", async () => {
    await insertWorkout("w1", "2026-11-10", null, 8);
    await insertWorkout("w2", "2026-11-10", null, 17);
    const { week } = await today("?date=2026-11-12");
    expect(week.count).toBe(2);
    expect(week.days).toEqual([false, true, false, false, false, false, false]);
  });

  it("los entrenos de otras semanas no cuentan en la semana", async () => {
    await insertWorkout("antes", "2026-11-08");
    await insertWorkout("despues", "2026-11-16");
    const { week } = await today("?date=2026-11-12");
    expect(week.count).toBe(0);
    expect(week.days).toEqual([false, false, false, false, false, false, false]);
  });

  it("el domingo es el último día de la semana y el lunes empieza otra", async () => {
    await insertWorkout("w1", "2026-11-15");
    expect((await today("?date=2026-11-15")).week.days).toEqual([false, false, false, false, false, false, true]);
    expect((await today("?date=2026-11-16")).week).toEqual({
      count: 0,
      goal: 3,
      days: [false, false, false, false, false, false, false],
    });
  });

  it("semanas cumplidas seguidas suman a la racha y la semana en curso sin cumplir no la rompe", async () => {
    // Cada una de las dos semanas anteriores con 3 entrenos; la actual, con 1.
    for (const [i, date] of ["2026-10-26", "2026-10-28", "2026-10-30", "2026-11-02", "2026-11-04", "2026-11-06"].entries()) {
      await insertWorkout(`prev${i}`, date);
    }
    await insertWorkout("actual", "2026-11-10");

    const body = await today("?date=2026-11-12");
    expect(body.week.count).toBe(1);
    expect(body.streak).toBe(2);
  });

  it("cuando la semana en curso se cumple suma una más a la racha", async () => {
    for (const [i, date] of ["2026-11-02", "2026-11-04", "2026-11-06", "2026-11-09", "2026-11-10", "2026-11-11"].entries()) {
      await insertWorkout(`w${i}`, date);
    }
    expect((await today("?date=2026-11-12")).streak).toBe(2);
  });

  it("una semana sin cumplir corta la racha", async () => {
    // Semana del 2 de noviembre con solo 2 entrenos; la anterior y la actual, cumplidas.
    for (const [i, date] of [
      "2026-10-26", "2026-10-27", "2026-10-28",
      "2026-11-02", "2026-11-03",
      "2026-11-09", "2026-11-10", "2026-11-11",
    ].entries()) {
      await insertWorkout(`w${i}`, date);
    }
    expect((await today("?date=2026-11-12")).streak).toBe(1);
  });

  it("usa el objetivo semanal de los ajustes", async () => {
    await insertWorkout("w1", "2026-11-09");
    await insertWorkout("w2", "2026-11-10");
    expect((await today("?date=2026-11-12")).streak).toBe(0);

    await send("PATCH", "/api/settings", { body: { weeklyGoal: 2 } });
    const body = await today("?date=2026-11-12");
    expect(body.week.goal).toBe(2);
    expect(body.streak).toBe(1);
  });
});

describe("te toca hoy", () => {
  it("sin historial toca la primera rutina de la rotación, con su duración estimada", async () => {
    await insertRoutine("b", { rotation: 1, sets: 4, restSeconds: 135 });
    await insertRoutine("a", { rotation: 0, sets: 8, restSeconds: 135 });

    const { next } = await today("?date=2026-11-12");
    // 8 series × (45 s + 135 s) = 24 min, redondeados al múltiplo de 5 más cercano.
    expect(next.estimatedMin).toBe(25);
    expect(next.routine).toEqual({
      id: "a",
      name: "Rutina a",
      inRotation: true,
      rotationOrder: 0,
      archived: false,
      items: [{ exerciseId: "bench", position: 0, sets: 8, repsTarget: "8-10", restSeconds: 135 }],
    });
  });

  it("toca la siguiente a la última rutina de la rotación que se hizo, de forma circular", async () => {
    await insertRoutine("a", { rotation: 0 });
    await insertRoutine("b", { rotation: 1, sets: 4, restSeconds: 135 });
    await insertRoutine("c", { rotation: 2 });

    await insertWorkout("w1", "2026-11-09", "b");
    expect((await today("?date=2026-11-12")).next.routine.id).toBe("c");

    await insertWorkout("w2", "2026-11-10", "c");
    const { next } = await today("?date=2026-11-12");
    expect(next.routine.id).toBe("a");
    // 3 series × (45 + 90) s = 6,75 min → 5.
    expect(next.estimatedMin).toBe(5);
  });

  it("un entreno libre o de una rutina fuera de la rotación no la rompe", async () => {
    await insertRoutine("a", { rotation: 0 });
    await insertRoutine("b", { rotation: 1 });
    await insertRoutine("extra", { rotation: null });
    await insertWorkout("w1", "2026-11-09", "a");
    await insertWorkout("w2", "2026-11-10", "extra");
    await insertWorkout("w3", "2026-11-11", null);
    expect((await today("?date=2026-11-12")).next.routine.id).toBe("b");
  });

  it("una rutina archivada no sale", async () => {
    await insertRoutine("a", { rotation: 0, archived: true });
    await insertRoutine("b", { rotation: 1 });
    expect((await today("?date=2026-11-12")).next.routine.id).toBe("b");
  });

  it("cuenta el cardio por los minutos del objetivo", async () => {
    await env.DB.prepare("INSERT INTO routines (id, name, in_rotation, rotation_order) VALUES ('cardio', 'Cardio', 1, 0)").run();
    await env.DB.prepare(
      "INSERT INTO routine_items (routine_id, exercise_id, position, sets, reps_target, rest_seconds) VALUES ('cardio', 'run', 0, 1, '30 min', 0)",
    ).run();
    expect((await today("?date=2026-11-12")).next.estimatedMin).toBe(30);
  });
});

describe("pasos", () => {
  it("devuelve los pasos de la fecha y el objetivo de los ajustes", async () => {
    await env.DB.prepare("INSERT INTO daily_steps (local_date, steps) VALUES ('2026-11-12', 4210), ('2026-11-11', 9000)").run();
    await env.DB.prepare("UPDATE settings SET steps_goal = 10000").run();

    const body = await today("?date=2026-11-12");
    expect(body.steps).toBe(4210);
    expect(body.stepsGoal).toBe(10000);
    expect((await today("?date=2026-11-13")).steps).toBeNull();
  });

  it("0 pasos es un dato, no la ausencia de datos", async () => {
    await env.DB.prepare("INSERT INTO daily_steps (local_date, steps) VALUES ('2026-11-12', 0)").run();
    expect((await today("?date=2026-11-12")).steps).toBe(0);
  });
});

describe("peso", () => {
  it("lastWeight es el último registro hasta la fecha y weekWeightDelta lo compara con el de hace 7 días", async () => {
    await insertWeight("2026-11-04", 81);
    await insertWeight("2026-11-05", 80.5);
    await insertWeight("2026-11-10", 79.85);
    await insertWeight("2026-11-12", 79.7, 18.2);
    await insertWeight("2026-11-13", 70);

    const body = await today("?date=2026-11-12");
    expect(body.lastWeight).toEqual({ localDate: "2026-11-12", weightKg: 79.7, bodyFatPct: 18.2 });
    // 79,7 − 80,5 = −0,8 (en coma flotante −0,7999999999999972): redondeado a 2 decimales.
    expect(body.weekWeightDelta).toBe(-0.8);
  });

  it("para comparar usa el último peso con fecha igual o anterior a hace 7 días", async () => {
    await insertWeight("2026-11-01", 82);
    await insertWeight("2026-11-06", 80);
    await insertWeight("2026-11-12", 80.25);
    // Hace 7 días es el 5 de noviembre: el último hasta entonces es el del 1.
    expect((await today("?date=2026-11-12")).weekWeightDelta).toBe(-1.75);
    // Hace 7 días es el 6: el del 6 cuenta.
    expect((await today("?date=2026-11-13")).weekWeightDelta).toBe(0.25);
  });

  it("sin peso hace 7 días o antes la tendencia es null, pero el último peso sale", async () => {
    await insertWeight("2026-11-10", 79);
    await insertWeight("2026-11-12", 78.5);
    const body = await today("?date=2026-11-12");
    expect(body.lastWeight).toEqual({ localDate: "2026-11-12", weightKg: 78.5, bodyFatPct: null });
    expect(body.weekWeightDelta).toBeNull();
  });

  it("sin ningún peso hasta la fecha, ambos son null", async () => {
    await insertWeight("2026-11-20", 78);
    const body = await today("?date=2026-11-12");
    expect(body.lastWeight).toBeNull();
    expect(body.weekWeightDelta).toBeNull();
  });

  it("una tendencia sin cambios es 0", async () => {
    await insertWeight("2026-11-05", 80);
    await insertWeight("2026-11-12", 80);
    expect((await today("?date=2026-11-12")).weekWeightDelta).toBe(0);
  });
});

describe("creatina", () => {
  it("creatineToday es true solo si hay toma en la fecha", async () => {
    await env.DB.prepare("INSERT INTO creatine_logs (local_date, grams, source) VALUES ('2026-11-12', 5, 'nfc')").run();
    expect((await today("?date=2026-11-12")).creatineToday).toBe(true);
    expect((await today("?date=2026-11-11")).creatineToday).toBe(false);
  });

  it("marcarla desde la API se refleja en Hoy, y desmarcarla también", async () => {
    await send("PUT", "/api/creatine/2026-11-12");
    expect((await today("?date=2026-11-12")).creatineToday).toBe(true);
    await send("DELETE", "/api/creatine/2026-11-12");
    expect((await today("?date=2026-11-12")).creatineToday).toBe(false);
  });
});

describe("saludo", () => {
  it("usa el nombre de los ajustes", async () => {
    await send("PATCH", "/api/settings", { body: { displayName: "Ana" } });
    expect((await today("?date=2026-11-12")).displayName).toBe("Ana");
  });
});
