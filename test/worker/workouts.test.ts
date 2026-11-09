import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { Workout } from "../../src/shared/types";
import { ORIGIN, authed } from "./helpers";

type Json = Record<string, any>;

type SendOptions = { body?: unknown; headers?: Record<string, string> };

/** Petición con sesión iniciada. Un string en `body` se envía tal cual, para probar JSON mal formado. */
async function send(method: string, path: string, options: SendOptions = {}): Promise<Response> {
  const { body, headers = {} } = options;
  const hasBody = body !== undefined;
  return exports.default.fetch(`${ORIGIN}${path}`, {
    method,
    headers: await authed(hasBody ? { "Content-Type": "application/json", ...headers } : headers),
    body: !hasBody ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function json(response: Response): Promise<any> {
  return response.json();
}

async function count(table: string, where = "1 = 1", ...values: unknown[]): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`)
    .bind(...values)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

// --- Datos de partida ---

async function insertExercise(id: string, category = "strength"): Promise<string> {
  await env.DB.prepare("INSERT INTO exercises (id, name, category) VALUES (?, ?, ?)").bind(id, id, category).run();
  return id;
}

async function insertRoutine(
  id: string,
  items: { exerciseId: string; sets: number; repsTarget: string; restSeconds: number }[],
): Promise<void> {
  await env.DB.prepare("INSERT INTO routines (id, name, in_rotation, rotation_order) VALUES (?, 'Empuje', 1, 0)")
    .bind(id)
    .run();
  for (const [position, item] of items.entries()) {
    await env.DB.prepare(
      "INSERT INTO routine_items (routine_id, exercise_id, position, sets, reps_target, rest_seconds) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(id, item.exerciseId, position, item.sets, item.repsTarget, item.restSeconds)
      .run();
  }
}

function set(weightKg: number | null, reps: number | null, extra: Json = {}): Json {
  return { weightKg, reps, rir: null, durationMin: null, distanceKm: null, ...extra };
}

/** Cuerpo de un PUT: el entreno sin id (va en la URL) ni localDate (lo calcula el servidor). */
function workoutBody(overrides: Json = {}): Json {
  return {
    routineId: null,
    startedAt: "2026-11-09T10:00:00.000Z",
    endedAt: "2026-11-09T11:00:00.000Z",
    notes: "",
    source: "live",
    exercises: [{ exerciseId: "bench", sets: [set(60, 8), set(60, 8)] }],
    ...overrides,
  };
}

async function put(id: string, overrides: Json = {}): Promise<Response> {
  return send("PUT", `/api/workouts/${id}`, { body: workoutBody(overrides) });
}

async function putOk(id: string, overrides: Json = {}): Promise<Json> {
  const response = await put(id, overrides);
  expect(response.status).toBe(200);
  return json(response);
}

async function listWorkouts(query = ""): Promise<Json[]> {
  const response = await send("GET", `/api/workouts${query}`);
  expect(response.status).toBe(200);
  return json(response);
}

async function listRoutines(): Promise<Json[]> {
  return json(await send("GET", "/api/routines"));
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
    env.DB.prepare("UPDATE settings SET timezone = 'Europe/Madrid' WHERE id = 1"),
  ]);
  await insertExercise("bench");
  await insertExercise("squat");
  await insertExercise("run", "cardio");
});

describe("acceso", () => {
  it.each([
    ["GET", "/api/workouts"],
    ["GET", "/api/workouts/x"],
    ["PUT", "/api/workouts/x"],
    ["DELETE", "/api/workouts/x"],
    ["POST", "/api/workouts/x/apply-to-routine"],
  ])("%s %s sin sesión responde 401", async (method, path) => {
    const response = await exports.default.fetch(`${ORIGIN}${path}`, {
      method,
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: method === "PUT" ? "{}" : undefined,
    });

    expect(response.status).toBe(401);
  });
});

describe("PUT /api/workouts/:id", () => {
  it("guarda un entreno nuevo y lo devuelve con localDate y sin récords la primera vez", async () => {
    const body = workoutBody({
      routineId: null,
      notes: "Buen día",
      exercises: [
        { exerciseId: "squat", sets: [set(100, 5, { rir: 2 })] },
        { exerciseId: "bench", sets: [set(57.5, 10), set(null, 12)] },
        { exerciseId: "run", sets: [set(null, null, { durationMin: 30, distanceKm: 5.2 })] },
      ],
    });

    const response = await send("PUT", "/api/workouts/w1", { body });

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({
      workout: { id: "w1", ...body, localDate: "2026-11-09" },
      newRecords: [],
    });
    expect(await json(await send("GET", "/api/workouts/w1"))).toEqual({ id: "w1", ...body, localDate: "2026-11-09" });
  });

  it("el mismo PUT enviado dos veces deja un solo entreno y no duplica filas", async () => {
    await putOk("w0", {
      startedAt: "2026-11-02T10:00:00.000Z",
      endedAt: "2026-11-02T11:00:00.000Z",
      exercises: [{ exerciseId: "bench", sets: [set(60, 8)] }],
    });
    const overrides = {
      exercises: [
        { exerciseId: "bench", sets: [set(62.5, 8), set(62.5, 6)] },
        { exerciseId: "squat", sets: [set(100, 5)] },
      ],
    };

    const first = await putOk("w1", overrides);
    const rowsAfterFirst = [await count("workout_exercises", "workout_id = 'w1'"), await count("sets")];
    const second = await putOk("w1", overrides);

    expect(first.newRecords.length).toBeGreaterThan(0);
    expect(second).toEqual(first);
    expect(await listWorkouts()).toHaveLength(2);
    expect(await count("workouts", "id = 'w1'")).toBe(1);
    expect([await count("workout_exercises", "workout_id = 'w1'"), await count("sets")]).toEqual(rowsAfterFirst);
    expect(rowsAfterFirst).toEqual([2, 4]);
  });

  it("reemplaza el contenido anterior del entreno", async () => {
    await putOk("w1", {
      routineId: null,
      notes: "antes",
      exercises: [
        { exerciseId: "bench", sets: [set(60, 8), set(60, 8), set(60, 8)] },
        { exerciseId: "squat", sets: [set(100, 5)] },
      ],
    });

    const replaced = await putOk("w1", {
      notes: "después",
      startedAt: "2026-11-10T09:00:00.000Z",
      endedAt: "2026-11-10T09:45:00.000Z",
      exercises: [{ exerciseId: "run", sets: [set(null, null, { durationMin: 20, distanceKm: 3 })] }],
    });

    expect(replaced.workout).toMatchObject({
      id: "w1",
      notes: "después",
      localDate: "2026-11-10",
      exercises: [{ exerciseId: "run", sets: [set(null, null, { durationMin: 20, distanceKm: 3 })] }],
    });
    expect(await json(await send("GET", "/api/workouts/w1"))).toEqual(replaced.workout);
    expect(await count("workout_exercises")).toBe(1);
    expect(await count("sets")).toBe(1);
  });

  it("calcula localDate desde startedAt con la zona horaria de los ajustes", async () => {
    // 23:30 UTC del 9 de noviembre ya es el día 10 en Madrid (UTC+1).
    const madrid = await putOk("w1", { startedAt: "2026-11-09T23:30:00Z", endedAt: "2026-11-10T00:30:00Z" });
    expect(madrid.workout.localDate).toBe("2026-11-10");
    expect(madrid.workout.startedAt).toBe("2026-11-09T23:30:00Z");

    // En verano Madrid es UTC+2: 22:30 UTC ya es el día siguiente.
    const summer = await putOk("w2", { startedAt: "2026-07-09T22:30:00.000Z", endedAt: "2026-07-09T23:30:00.000Z" });
    expect(summer.workout.localDate).toBe("2026-07-10");

    // Con otra zona en los ajustes, el mismo instante cae en otro día (Nueva York es UTC-5).
    await env.DB.prepare("UPDATE settings SET timezone = 'America/New_York' WHERE id = 1").run();
    const newYork = await putOk("w3", { startedAt: "2026-11-09T23:30:00Z", endedAt: "2026-11-10T00:30:00Z" });
    expect(newYork.workout.localDate).toBe("2026-11-09");
    expect((await json(await send("GET", "/api/workouts/w3"))).localDate).toBe("2026-11-09");
  });

  it("ignora el localDate que mande el cliente", async () => {
    const response = await send("PUT", "/api/workouts/w1", { body: { ...workoutBody(), localDate: "2020-01-01" } });

    expect(response.status).toBe(200);
    expect((await json(response)).workout.localDate).toBe("2026-11-09");
    expect(await count("workouts", "local_date = '2020-01-01'")).toBe(0);
  });

  it("acepta el id del cuerpo si coincide con el de la URL y rechaza con 400 si no", async () => {
    const same = await send("PUT", "/api/workouts/w1", { body: { ...workoutBody(), id: "w1" } });
    expect(same.status).toBe(200);

    const other = await send("PUT", "/api/workouts/w2", { body: { ...workoutBody(), id: "w1" } });
    expect(other.status).toBe(400);
    expect(await count("workouts", "id = 'w2'")).toBe(0);
  });

  it("guarda el routineId y el orden de los ejercicios, incluso repetidos", async () => {
    await insertRoutine("r1", [{ exerciseId: "bench", sets: 3, repsTarget: "8", restSeconds: 90 }]);

    const saved = await putOk("w1", {
      routineId: "r1",
      exercises: [
        { exerciseId: "squat", sets: [set(100, 5)] },
        { exerciseId: "bench", sets: [set(60, 8)] },
        { exerciseId: "squat", sets: [set(90, 8), set(90, 7)] },
      ],
    });

    expect(saved.workout.routineId).toBe("r1");
    expect(saved.workout.exercises.map((e: Json) => [e.exerciseId, e.sets.length])).toEqual([
      ["squat", 1],
      ["bench", 1],
      ["squat", 2],
    ]);
  });

  it("guarda un ejercicio sin series y un entreno sin ejercicios", async () => {
    const withEmpty = await putOk("w1", { exercises: [{ exerciseId: "bench", sets: [] }] });
    const empty = await putOk("w2", { exercises: [] });

    expect(withEmpty.workout.exercises).toEqual([{ exerciseId: "bench", sets: [] }]);
    expect(empty.workout.exercises).toEqual([]);
  });

  it("rechaza con 400 una serie con reps negativas y no guarda nada", async () => {
    const response = await put("w1", { exercises: [{ exerciseId: "bench", sets: [set(60, -1)] }] });

    expect(response.status).toBe(400);
    expect(await count("workouts")).toBe(0);
    expect(await count("workout_exercises")).toBe(0);
  });

  it("un PUT inválido sobre un entreno existente no lo modifica", async () => {
    const original = await putOk("w1");

    const response = await put("w1", { notes: "roto", exercises: [{ exerciseId: "bench", sets: [set(-5, 8)] }] });

    expect(response.status).toBe(400);
    expect(await json(await send("GET", "/api/workouts/w1"))).toEqual(original.workout);
  });

  it.each([
    ["peso negativo", { exercises: [{ exerciseId: "bench", sets: [set(-5, 8)] }] }],
    ["reps no enteras", { exercises: [{ exerciseId: "bench", sets: [set(60, 8.5)] }] }],
    ["fecha de inicio no válida", { startedAt: "ayer" }],
    ["origen desconocido", { source: "otro" }],
    ["sin ejercicios", { exercises: undefined }],
  ])("rechaza con 400: %s", async (_name, overrides) => {
    const response = await put("w1", overrides);

    expect(response.status).toBe(400);
    expect(await count("workouts")).toBe(0);
  });

  it("rechaza con 400 un JSON mal formado", async () => {
    const response = await send("PUT", "/api/workouts/w1", { body: "{ no es json" });

    expect(response.status).toBe(400);
  });

  it("rechaza con 400 un ejercicio inexistente y no guarda nada", async () => {
    const response = await put("w1", {
      exercises: [
        { exerciseId: "bench", sets: [] },
        { exerciseId: "no-existe", sets: [] },
      ],
    });

    expect(response.status).toBe(400);
    expect(await count("workouts")).toBe(0);
    expect(await count("workout_exercises")).toBe(0);
  });

  it("rechaza con 400 una rutina inexistente y no guarda nada", async () => {
    const response = await put("w1", { routineId: "no-existe" });

    expect(response.status).toBe(400);
    expect(await count("workouts")).toBe(0);
  });

  it("acepta un ejercicio archivado y una rutina archivada", async () => {
    await insertRoutine("r1", []);
    await env.DB.batch([
      env.DB.prepare("UPDATE routines SET archived = 1 WHERE id = 'r1'"),
      env.DB.prepare("UPDATE exercises SET archived = 1 WHERE id = 'bench'"),
    ]);

    const response = await put("w1", { routineId: "r1" });

    expect(response.status).toBe(200);
  });

  it("replaceWorkout es atómico: si falla a mitad, el entreno anterior queda intacto", async () => {
    const original = await putOk("w1");
    const { replaceWorkout } = await import("../../src/worker/db/workouts");
    // Pasa el borrado y el alta del entreno, y falla en el ejercicio inexistente (clave foránea).
    const broken: Workout = {
      ...original.workout,
      notes: "roto",
      exercises: [{ exerciseId: "no-existe", sets: [] }],
    };

    await expect(replaceWorkout(env.DB, broken)).rejects.toThrow();

    expect(await json(await send("GET", "/api/workouts/w1"))).toEqual(original.workout);
    expect(await count("workout_exercises", "workout_id = 'w1'")).toBe(1);
    expect(await count("sets")).toBe(2);
  });
});

describe("newRecords en PUT /api/workouts/:id", () => {
  it("devuelve los récords que supera frente a entrenos anteriores", async () => {
    await putOk("old", {
      startedAt: "2026-11-02T10:00:00.000Z",
      endedAt: "2026-11-02T11:00:00.000Z",
      exercises: [{ exerciseId: "bench", sets: [set(60, 8)] }],
    });

    const saved = await putOk("new", { exercises: [{ exerciseId: "bench", sets: [set(62.5, 8)] }] });

    expect(saved.newRecords).toEqual([
      { exerciseId: "bench", kind: "maxWeight", value: 62.5 },
      { exerciseId: "bench", kind: "best1RM", value: 79 },
      { exerciseId: "bench", kind: "volume", value: 500 },
    ]);
  });

  it("la primera vez que se hace un ejercicio no hay récords", async () => {
    const saved = await putOk("w1", { exercises: [{ exerciseId: "bench", sets: [set(200, 10)] }] });

    expect(saved.newRecords).toEqual([]);
  });

  it("no compara con entrenos posteriores ni consigo mismo", async () => {
    await putOk("later", {
      startedAt: "2026-11-20T10:00:00.000Z",
      endedAt: "2026-11-20T11:00:00.000Z",
      exercises: [{ exerciseId: "bench", sets: [set(40, 8)] }],
    });

    const saved = await putOk("w1", { exercises: [{ exerciseId: "bench", sets: [set(100, 8)] }] });
    const resent = await putOk("w1", { exercises: [{ exerciseId: "bench", sets: [set(100, 8)] }] });

    expect(saved.newRecords).toEqual([]);
    expect(resent.newRecords).toEqual([]);
  });

  it("no cuenta como anterior un entreno que ya no existe tras reemplazarlo", async () => {
    await putOk("old", {
      startedAt: "2026-11-02T10:00:00.000Z",
      endedAt: "2026-11-02T11:00:00.000Z",
      exercises: [{ exerciseId: "bench", sets: [set(100, 8)] }],
    });
    // El entreno "old" se corrige a un peso menor: el récord a batir baja con él.
    await putOk("old", {
      startedAt: "2026-11-02T10:00:00.000Z",
      endedAt: "2026-11-02T11:00:00.000Z",
      exercises: [{ exerciseId: "bench", sets: [set(50, 8)] }],
    });

    const saved = await putOk("new", { exercises: [{ exerciseId: "bench", sets: [set(60, 8)] }] });

    expect(saved.newRecords.map((r: Json) => r.kind)).toEqual(["maxWeight", "best1RM", "volume"]);
  });

  it("distingue los récords de cardio", async () => {
    await putOk("old", {
      startedAt: "2026-11-02T10:00:00.000Z",
      endedAt: "2026-11-02T11:00:00.000Z",
      exercises: [{ exerciseId: "run", sets: [set(null, null, { durationMin: 30, distanceKm: 5 })] }],
    });

    const saved = await putOk("new", {
      exercises: [{ exerciseId: "run", sets: [set(null, null, { durationMin: 30, distanceKm: 6 })] }],
    });

    expect(saved.newRecords).toEqual([
      { exerciseId: "run", kind: "maxDistance", value: 6 },
      { exerciseId: "run", kind: "bestPace", value: 5 },
    ]);
  });
});

describe("GET /api/workouts", () => {
  it("sin entrenos devuelve una lista vacía", async () => {
    expect(await listWorkouts()).toEqual([]);
  });

  it("devuelve resúmenes con nombre de rutina, fecha, duración y volumen, del más reciente al más antiguo", async () => {
    await insertRoutine("r1", []);
    await putOk("old", {
      routineId: "r1",
      startedAt: "2026-11-02T10:00:00.000Z",
      endedAt: "2026-11-02T11:15:00.000Z",
      exercises: [{ exerciseId: "bench", sets: [set(60, 8), set(57.5, 10)] }],
    });
    await putOk("free", {
      startedAt: "2026-11-09T17:00:00.000Z",
      endedAt: "2026-11-09T17:40:00.000Z",
      exercises: [{ exerciseId: "run", sets: [set(null, null, { durationMin: 40, distanceKm: 6 })] }],
    });
    await putOk("mid", {
      startedAt: "2026-11-05T10:00:00.000Z",
      endedAt: "2026-11-05T10:50:00.000Z",
      exercises: [],
    });

    const listed = await listWorkouts();

    expect(listed).toEqual([
      { id: "free", routineName: null, localDate: "2026-11-09", durationMin: 40, volumeKg: 0 },
      { id: "mid", routineName: null, localDate: "2026-11-05", durationMin: 50, volumeKg: 0 },
      { id: "old", routineName: "Empuje", localDate: "2026-11-02", durationMin: 75, volumeKg: 1055 },
    ]);
  });

  it("el volumen solo suma series con peso y repeticiones > 0 de ejercicios que no son cardio", async () => {
    await putOk("w1", {
      exercises: [
        { exerciseId: "bench", sets: [set(80, 5), set(0, 15), set(null, 12), set(50, null), set(50, 0)] },
        // Una serie de cardio con peso y repeticiones tampoco cuenta.
        { exerciseId: "run", sets: [set(10, 10, { durationMin: 20, distanceKm: 3 })] },
      ],
    });

    const [summary] = await listWorkouts();

    expect(summary?.volumeKg).toBe(400);
  });

  it("redondea el volumen a dos decimales", async () => {
    await putOk("w1", { exercises: [{ exerciseId: "bench", sets: [set(0.1, 3), set(0.2, 3)] }] });

    const [summary] = await listWorkouts();

    expect(summary?.volumeKg).toBe(0.9);
  });

  it("la duración es en minutos y nunca es negativa ni NaN", async () => {
    await putOk("w1", { startedAt: "2026-11-09T10:00:00.000Z", endedAt: "2026-11-09T10:00:00.000Z" });
    await putOk("w2", { startedAt: "2026-11-09T11:00:00.000Z", endedAt: "2026-11-09T10:30:00.000Z" });
    await putOk("w3", { startedAt: "2026-11-09T12:00:00.000Z", endedAt: "2026-11-09T12:59:31.000Z" });

    const byId = Object.fromEntries((await listWorkouts()).map((w) => [w.id, w.durationMin]));

    expect(byId).toEqual({ w1: 0, w2: 0, w3: 60 });
  });

  it("desempata el mismo día por hora de inicio, el más tardío primero", async () => {
    await putOk("am", { startedAt: "2026-11-09T08:00:00.000Z", endedAt: "2026-11-09T09:00:00.000Z" });
    await putOk("pm", { startedAt: "2026-11-09T18:00:00.000Z", endedAt: "2026-11-09T19:00:00.000Z" });

    expect((await listWorkouts()).map((w) => w.id)).toEqual(["pm", "am"]);
  });

  it("filtra por from y to, ambos incluidos", async () => {
    for (const day of ["02", "05", "09", "12"]) {
      await putOk(`d${day}`, {
        startedAt: `2026-11-${day}T10:00:00.000Z`,
        endedAt: `2026-11-${day}T11:00:00.000Z`,
      });
    }

    const ids = async (query: string) => (await listWorkouts(query)).map((w) => w.id);

    expect(await ids("?from=2026-11-05")).toEqual(["d12", "d09", "d05"]);
    expect(await ids("?to=2026-11-09")).toEqual(["d09", "d05", "d02"]);
    expect(await ids("?from=2026-11-05&to=2026-11-09")).toEqual(["d09", "d05"]);
    expect(await ids("?from=2026-11-10&to=2026-11-11")).toEqual([]);
    expect(await ids("?from=2026-11-09&to=2026-11-05")).toEqual([]);
  });

  it.each(["?from=hoy", "?to=2026-02-30", "?from=2026-11-9", "?from=", "?from=2026-11-01&to=mañana"])(
    "responde 400 con las fechas %s",
    async (query) => {
      const response = await send("GET", `/api/workouts${query}`);

      expect(response.status).toBe(400);
    },
  );
});

describe("GET /api/workouts/:id", () => {
  it("devuelve el entreno completo con sus series en orden", async () => {
    const saved = await putOk("w1", {
      exercises: [
        { exerciseId: "squat", sets: [set(100, 5), set(90, 8), set(80, 12)] },
        { exerciseId: "bench", sets: [set(60, 8)] },
      ],
    });

    const response = await send("GET", "/api/workouts/w1");
    const workout = await json(response);

    expect(response.status).toBe(200);
    expect(workout).toEqual(saved.workout);
    expect(workout.exercises[0].sets.map((s: Json) => s.reps)).toEqual([5, 8, 12]);
  });

  it("responde 404 si no existe", async () => {
    const response = await send("GET", "/api/workouts/no-existe");

    expect(response.status).toBe(404);
  });
});

describe("DELETE /api/workouts/:id", () => {
  it("borra el entreno y, en cascada, sus ejercicios y series", async () => {
    await putOk("keep", { exercises: [{ exerciseId: "bench", sets: [set(60, 8)] }] });
    await putOk("gone", {
      exercises: [
        { exerciseId: "bench", sets: [set(60, 8), set(60, 8)] },
        { exerciseId: "squat", sets: [set(100, 5)] },
      ],
    });
    expect(await count("sets")).toBe(4);

    const response = await send("DELETE", "/api/workouts/gone");

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ deleted: true });
    expect((await send("GET", "/api/workouts/gone")).status).toBe(404);
    expect((await listWorkouts()).map((w) => w.id)).toEqual(["keep"]);
    expect(await count("workout_exercises", "workout_id = 'gone'")).toBe(0);
    expect(await count("workout_exercises")).toBe(1);
    expect(await count("sets")).toBe(1);
  });

  it("no borra la rutina ni los ejercicios", async () => {
    await insertRoutine("r1", [{ exerciseId: "bench", sets: 3, repsTarget: "8", restSeconds: 90 }]);
    await putOk("w1", { routineId: "r1" });

    await send("DELETE", "/api/workouts/w1");

    expect(await count("routines")).toBe(1);
    expect(await count("routine_items")).toBe(1);
    expect(await count("exercises")).toBe(3);
  });

  it("responde 404 si no existe", async () => {
    const response = await send("DELETE", "/api/workouts/no-existe");

    expect(response.status).toBe(404);
  });

  it("borrar dos veces: la segunda responde 404", async () => {
    await putOk("w1");

    expect((await send("DELETE", "/api/workouts/w1")).status).toBe(200);
    expect((await send("DELETE", "/api/workouts/w1")).status).toBe(404);
  });
});

describe("POST /api/workouts/:id/apply-to-routine", () => {
  async function seedRoutineWorkout(): Promise<void> {
    await insertExercise("ohp");
    await insertExercise("row");
    await insertRoutine("r1", [
      { exerciseId: "bench", sets: 3, repsTarget: "6-8", restSeconds: 120 },
      { exerciseId: "squat", sets: 4, repsTarget: "8-10", restSeconds: 150 },
    ]);
  }

  it("actualiza los ítems de la rutina con la estructura de la sesión", async () => {
    await seedRoutineWorkout();
    await putOk("w1", {
      routineId: "r1",
      exercises: [
        { exerciseId: "squat", sets: [set(100, 5), set(100, 5)] },
        { exerciseId: "bench", sets: [set(60, 8), set(60, 8), set(60, 8), set(60, 8)] },
        { exerciseId: "ohp", sets: [set(30, 10), set(30, 10), set(30, 10)] },
      ],
    });

    const response = await send("POST", "/api/workouts/w1/apply-to-routine");

    expect(response.status).toBe(200);
    const expected = {
      id: "r1",
      name: "Empuje",
      inRotation: true,
      rotationOrder: 0,
      archived: false,
      items: [
        { exerciseId: "squat", position: 0, sets: 2, repsTarget: "8-10", restSeconds: 150 },
        { exerciseId: "bench", position: 1, sets: 4, repsTarget: "6-8", restSeconds: 120 },
        { exerciseId: "ohp", position: 2, sets: 3, repsTarget: "10", restSeconds: 90 },
      ],
    };
    expect(await json(response)).toEqual(expected);
    expect(await listRoutines()).toEqual([expected]);
    expect(await count("routine_items", "routine_id = 'r1'")).toBe(3);
  });

  it("un ejercicio guardado sin series no pasa a la rutina", async () => {
    await seedRoutineWorkout();
    await putOk("w1", {
      routineId: "r1",
      exercises: [
        { exerciseId: "bench", sets: [set(60, 8)] },
        { exerciseId: "row", sets: [] },
        { exerciseId: "squat", sets: [set(100, 5), set(100, 5)] },
      ],
    });

    const routine = await json(await send("POST", "/api/workouts/w1/apply-to-routine"));

    expect(routine.items).toEqual([
      { exerciseId: "bench", position: 0, sets: 1, repsTarget: "6-8", restSeconds: 120 },
      { exerciseId: "squat", position: 1, sets: 2, repsTarget: "8-10", restSeconds: 150 },
    ]);
  });

  it("es idempotente y no modifica el entreno", async () => {
    await seedRoutineWorkout();
    const saved = await putOk("w1", {
      routineId: "r1",
      exercises: [{ exerciseId: "ohp", sets: [set(30, 10), set(30, 10)] }],
    });

    const first = await json(await send("POST", "/api/workouts/w1/apply-to-routine"));
    const second = await json(await send("POST", "/api/workouts/w1/apply-to-routine"));

    expect(second).toEqual(first);
    expect(first.items).toEqual([{ exerciseId: "ohp", position: 0, sets: 2, repsTarget: "10", restSeconds: 90 }]);
    expect(await json(await send("GET", "/api/workouts/w1"))).toEqual(saved.workout);
  });

  it("responde 409 si el entreno no tiene rutina y no toca ninguna", async () => {
    await seedRoutineWorkout();
    await putOk("w1", { routineId: null });

    const response = await send("POST", "/api/workouts/w1/apply-to-routine");

    expect(response.status).toBe(409);
    expect(await count("routine_items", "routine_id = 'r1'")).toBe(2);
  });

  it("responde 404 si el entreno no existe", async () => {
    const response = await send("POST", "/api/workouts/no-existe/apply-to-routine");

    expect(response.status).toBe(404);
  });

  it("aplica también a una rutina archivada, sin desarchivarla", async () => {
    await seedRoutineWorkout();
    await putOk("w1", { routineId: "r1", exercises: [{ exerciseId: "bench", sets: [set(60, 8)] }] });
    await env.DB.prepare("UPDATE routines SET archived = 1 WHERE id = 'r1'").run();

    const response = await send("POST", "/api/workouts/w1/apply-to-routine");

    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({ id: "r1", archived: true, items: [{ exerciseId: "bench", sets: 1 }] });
  });
});
