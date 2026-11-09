import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
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

// --- Datos de partida (SQL directo: la API de entrenos llega en otra tarea) ---

async function insertExercise(id: string, name = id, archived = 0): Promise<string> {
  await env.DB.prepare("INSERT INTO exercises (id, name, category, archived) VALUES (?, ?, 'strength', ?)")
    .bind(id, name, archived)
    .run();
  return id;
}

type SeedSet = { weightKg?: number | null; reps?: number | null; durationMin?: number | null };

/** Un entreno con un ejercicio y sus series, ya guardado. */
async function insertWorkout(
  id: string,
  localDate: string,
  exercises: { exerciseId: string; sets: SeedSet[] }[],
  startedAt = `${localDate}T10:00:00.000Z`,
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO workouts (id, routine_id, started_at, ended_at, local_date, notes, source) VALUES (?, NULL, ?, ?, ?, '', 'live')",
  )
    .bind(id, startedAt, `${localDate}T11:00:00.000Z`, localDate)
    .run();
  for (const [position, exercise] of exercises.entries()) {
    const inserted = await env.DB.prepare(
      "INSERT INTO workout_exercises (workout_id, exercise_id, position) VALUES (?, ?, ?)",
    )
      .bind(id, exercise.exerciseId, position)
      .run();
    const workoutExerciseId = inserted.meta.last_row_id;
    for (const [setPosition, set] of exercise.sets.entries()) {
      await env.DB.prepare(
        "INSERT INTO sets (workout_exercise_id, position, weight_kg, reps, duration_min) VALUES (?, ?, ?, ?, ?)",
      )
        .bind(workoutExerciseId, setPosition, set.weightKg ?? null, set.reps ?? null, set.durationMin ?? null)
        .run();
    }
  }
}

function item(exerciseId: string, position: number, overrides: Json = {}): Json {
  return { exerciseId, position, sets: 3, repsTarget: "8-10", restSeconds: 90, ...overrides };
}

function routineBody(items: Json[], overrides: Json = {}): Json {
  return { name: "Empuje", inRotation: true, rotationOrder: 0, archived: false, items, ...overrides };
}

async function createRoutine(items: Json[], overrides: Json = {}): Promise<Json> {
  const response = await send("POST", "/api/routines", { body: routineBody(items, overrides) });
  expect(response.status).toBe(201);
  return json(response);
}

async function listRoutineIds(): Promise<string[]> {
  const response = await send("GET", "/api/routines");
  expect(response.status).toBe(200);
  return (await json(response)).map((routine: Json) => routine.id);
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
  ]);
});

describe("acceso", () => {
  it.each([
    ["GET", "/api/exercises"],
    ["POST", "/api/exercises"],
    ["PATCH", "/api/exercises/x"],
    ["DELETE", "/api/exercises/x"],
    ["GET", "/api/exercises/x/history"],
    ["GET", "/api/routines"],
    ["POST", "/api/routines"],
    ["PUT", "/api/routines/x"],
    ["DELETE", "/api/routines/x"],
    ["POST", "/api/routines/reorder"],
  ])("%s %s sin sesión responde 401", async (method, path) => {
    const response = await exports.default.fetch(`${ORIGIN}${path}`, {
      method,
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: method === "GET" || method === "DELETE" ? undefined : "{}",
    });

    expect(response.status).toBe(401);
  });
});

describe("POST /api/exercises", () => {
  it("crea un ejercicio propio con id del servidor y aparece en el listado", async () => {
    const response = await send("POST", "/api/exercises", {
      body: { name: "  Remo con mancuerna ", category: "strength", muscle: "Espalda", mediaUrl: "https://example.com/remo.mp4" },
    });

    expect(response.status).toBe(201);
    const created = await json(response);
    expect(created).toEqual({
      id: expect.any(String),
      name: "Remo con mancuerna",
      category: "strength",
      muscle: "Espalda",
      description: "",
      mediaUrl: "https://example.com/remo.mp4",
      isCustom: true,
      archived: false,
    });
    expect(created.id.length).toBeGreaterThan(0);

    const listed = await json(await send("GET", "/api/exercises"));
    expect(listed).toEqual([created]);
    expect(await count("exercises", "id = ? AND is_custom = 1", created.id)).toBe(1);
  });

  it("ignora el id y el isCustom que mande el cliente", async () => {
    const response = await send("POST", "/api/exercises", {
      body: { id: "mio", isCustom: false, name: "Fondos", category: "strength" },
    });

    const created = await json(response);
    expect(response.status).toBe(201);
    expect(created.id).not.toBe("mio");
    expect(created.isCustom).toBe(true);
    expect(await count("exercises", "id = 'mio'")).toBe(0);
  });

  it.each(["javascript:alert(1)", "http://example.com/a.mp4", "data:text/html,<b>x</b>", "ftp://example.com/a"])(
    "rechaza con 400 el mediaUrl %s",
    async (mediaUrl) => {
      const response = await send("POST", "/api/exercises", {
        body: { name: "Fondos", category: "strength", mediaUrl },
      });

      expect(response.status).toBe(400);
      expect(await count("exercises")).toBe(0);
    },
  );

  it("rechaza con 400 un cuerpo sin nombre, con categoría desconocida o JSON mal formado", async () => {
    expect((await send("POST", "/api/exercises", { body: { category: "strength" } })).status).toBe(400);
    expect((await send("POST", "/api/exercises", { body: { name: "X", category: "yoga" } })).status).toBe(400);
    expect((await send("POST", "/api/exercises", { body: "{no es json" })).status).toBe(400);
    expect(await count("exercises")).toBe(0);
  });
});

describe("GET /api/exercises", () => {
  it("excluye las archivadas salvo con ?archived=1", async () => {
    await insertExercise("a", "Activo");
    await insertExercise("b", "Archivado", 1);

    const normal = await json(await send("GET", "/api/exercises"));
    const withArchived = await json(await send("GET", "/api/exercises?archived=1"));

    expect(normal.map((e: Json) => e.id)).toEqual(["a"]);
    expect(withArchived.map((e: Json) => e.id).sort()).toEqual(["a", "b"]);
    expect(withArchived.find((e: Json) => e.id === "b").archived).toBe(true);
  });

  it("devuelve los ejercicios ordenados por nombre sin distinguir mayúsculas", async () => {
    await insertExercise("1", "sentadilla");
    await insertExercise("2", "Banca");
    await insertExercise("3", "Zancadas");

    const listed = await json(await send("GET", "/api/exercises"));

    expect(listed.map((e: Json) => e.name)).toEqual(["Banca", "sentadilla", "Zancadas"]);
  });

  it("con otro valor de archived no incluye las archivadas", async () => {
    await insertExercise("a", "Activo");
    await insertExercise("b", "Archivado", 1);

    const listed = await json(await send("GET", "/api/exercises?archived=0"));

    expect(listed.map((e: Json) => e.id)).toEqual(["a"]);
  });
});

describe("PATCH /api/exercises/:id", () => {
  it("cambia solo los campos enviados", async () => {
    const created = await json(
      await send("POST", "/api/exercises", {
        body: { name: "Remo", category: "strength", muscle: "Espalda", description: "Tira del codo", mediaUrl: "https://example.com/r.mp4" },
      }),
    );

    const response = await send("PATCH", `/api/exercises/${created.id}`, { body: { name: "Remo con barra" } });

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ ...created, name: "Remo con barra" });
  });

  it("permite quitar el enlace con null y recuperar un ejercicio archivado", async () => {
    await insertExercise("a", "Activo", 1);
    await env.DB.prepare("UPDATE exercises SET media_url = 'https://example.com/a.mp4' WHERE id = 'a'").run();

    const response = await send("PATCH", "/api/exercises/a", { body: { mediaUrl: null, archived: false } });

    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({ id: "a", mediaUrl: null, archived: false });
    expect((await json(await send("GET", "/api/exercises"))).map((e: Json) => e.id)).toEqual(["a"]);
  });

  it("no cambia el id ni isCustom", async () => {
    await insertExercise("a");

    const response = await send("PATCH", "/api/exercises/a", { body: { id: "otro", isCustom: true, name: "Nuevo" } });

    expect(await json(response)).toMatchObject({ id: "a", isCustom: false, name: "Nuevo" });
    expect(await count("exercises", "id = 'otro'")).toBe(0);
  });

  it("rechaza con 400 un enlace que no es https y no toca el ejercicio", async () => {
    await insertExercise("a", "Original");

    const response = await send("PATCH", "/api/exercises/a", {
      body: { name: "Cambiado", mediaUrl: "javascript:alert(1)" },
    });

    expect(response.status).toBe(400);
    const row = await env.DB.prepare("SELECT name, media_url FROM exercises WHERE id = 'a'").first();
    expect(row).toEqual({ name: "Original", media_url: null });
  });

  it("responde 404 si el ejercicio no existe", async () => {
    const response = await send("PATCH", "/api/exercises/no-existe", { body: { name: "X" } });

    expect(response.status).toBe(404);
  });
});

describe("DELETE /api/exercises/:id", () => {
  it("borra el ejercicio que no se ha usado", async () => {
    await insertExercise("a");

    const response = await send("DELETE", "/api/exercises/a");

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ archived: false });
    expect(await count("exercises")).toBe(0);
  });

  it("archiva el ejercicio usado en un entreno, que sigue en /history", async () => {
    await insertExercise("a", "Banca");
    await insertWorkout("w1", "2026-11-02", [{ exerciseId: "a", sets: [{ weightKg: 60, reps: 8 }] }]);

    const response = await send("DELETE", "/api/exercises/a");

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ archived: true });
    expect(await count("exercises", "id = 'a' AND archived = 1")).toBe(1);
    expect(await json(await send("GET", "/api/exercises"))).toEqual([]);
    expect((await json(await send("GET", "/api/exercises?archived=1"))).map((e: Json) => e.id)).toEqual(["a"]);

    const history = await json(await send("GET", "/api/exercises/a/history"));
    expect(history).toEqual([
      { workoutId: "w1", localDate: "2026-11-02", sets: [{ weightKg: 60, reps: 8, rir: null, durationMin: null, distanceKm: null }] },
    ]);
  });

  it("archiva el ejercicio que está en una rutina", async () => {
    await insertExercise("a");
    await createRoutine([item("a", 0)]);

    const response = await send("DELETE", "/api/exercises/a");

    expect(await json(response)).toEqual({ archived: true });
    expect(await count("exercises", "id = 'a' AND archived = 1")).toBe(1);
    expect(await count("routine_items", "exercise_id = 'a'")).toBe(1);
  });

  it("responde 404 si el ejercicio no existe", async () => {
    const response = await send("DELETE", "/api/exercises/no-existe");

    expect(response.status).toBe(404);
  });
});

describe("GET /api/exercises/:id/history", () => {
  it("lista los entrenos del ejercicio del más reciente al más antiguo, con sus series en orden", async () => {
    await insertExercise("a", "Banca");
    await insertExercise("b", "Remo");
    await insertWorkout("antiguo", "2026-10-01", [{ exerciseId: "a", sets: [{ weightKg: 50, reps: 10 }] }]);
    await insertWorkout("reciente", "2026-11-05", [
      { exerciseId: "b", sets: [{ weightKg: 40, reps: 12 }] },
      { exerciseId: "a", sets: [{ weightKg: 62.5, reps: 8 }, { weightKg: 60, reps: 9 }] },
    ]);
    await insertWorkout("medio", "2026-10-20", [{ exerciseId: "a", sets: [{ weightKg: 55, reps: 10 }] }]);
    await insertWorkout("otro-ejercicio", "2026-11-08", [{ exerciseId: "b", sets: [{ weightKg: 40, reps: 12 }] }]);

    const response = await send("GET", "/api/exercises/a/history");

    expect(response.status).toBe(200);
    const history = await json(response);
    expect(history.map((h: Json) => h.workoutId)).toEqual(["reciente", "medio", "antiguo"]);
    expect(history[0]).toEqual({
      workoutId: "reciente",
      localDate: "2026-11-05",
      sets: [
        { weightKg: 62.5, reps: 8, rir: null, durationMin: null, distanceKm: null },
        { weightKg: 60, reps: 9, rir: null, durationMin: null, distanceKm: null },
      ],
    });
  });

  it("desempata por hora de inicio cuando dos entrenos son del mismo día", async () => {
    await insertExercise("a");
    await insertWorkout("por-la-manana", "2026-11-05", [{ exerciseId: "a", sets: [{ reps: 5 }] }], "2026-11-05T07:00:00.000Z");
    await insertWorkout("por-la-tarde", "2026-11-05", [{ exerciseId: "a", sets: [{ reps: 5 }] }], "2026-11-05T17:00:00.000Z");

    const history = await json(await send("GET", "/api/exercises/a/history"));

    expect(history.map((h: Json) => h.workoutId)).toEqual(["por-la-tarde", "por-la-manana"]);
  });

  it("incluye un entreno donde el ejercicio no tiene series, con la lista vacía", async () => {
    await insertExercise("a");
    await insertWorkout("w1", "2026-11-05", [{ exerciseId: "a", sets: [] }]);

    const history = await json(await send("GET", "/api/exercises/a/history"));

    expect(history).toEqual([{ workoutId: "w1", localDate: "2026-11-05", sets: [] }]);
  });

  it("devuelve una lista vacía si el ejercicio existe pero no se ha usado", async () => {
    await insertExercise("a");

    const response = await send("GET", "/api/exercises/a/history");

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual([]);
  });

  it("responde 404 si el ejercicio no existe", async () => {
    const response = await send("GET", "/api/exercises/no-existe/history");

    expect(response.status).toBe(404);
  });
});

describe("POST /api/routines", () => {
  it("crea una rutina con 3 ítems y la devuelve en el mismo orden", async () => {
    await insertExercise("sentadilla");
    await insertExercise("banca");
    await insertExercise("remo");

    const response = await send("POST", "/api/routines", {
      body: routineBody(
        [
          item("banca", 0, { sets: 4, repsTarget: "6-8", restSeconds: 120 }),
          item("remo", 1),
          item("sentadilla", 2, { sets: 5, repsTarget: "5", restSeconds: 180 }),
        ],
        { name: "  Torso  " },
      ),
    });

    expect(response.status).toBe(201);
    const created = await json(response);
    expect(created).toEqual({
      id: expect.any(String),
      name: "Torso",
      inRotation: true,
      rotationOrder: 0,
      archived: false,
      items: [
        { exerciseId: "banca", position: 0, sets: 4, repsTarget: "6-8", restSeconds: 120 },
        { exerciseId: "remo", position: 1, sets: 3, repsTarget: "8-10", restSeconds: 90 },
        { exerciseId: "sentadilla", position: 2, sets: 5, repsTarget: "5", restSeconds: 180 },
      ],
    });

    const listed = await json(await send("GET", "/api/routines"));
    expect(listed).toEqual([created]);
  });

  it("ordena los ítems por position aunque lleguen desordenados", async () => {
    await insertExercise("a");
    await insertExercise("b");
    await insertExercise("c");

    const created = await createRoutine([item("c", 2), item("a", 0), item("b", 1)]);

    expect(created.items.map((i: Json) => i.exerciseId)).toEqual(["a", "b", "c"]);
  });

  it("usa el id del cuerpo si lo trae y responde 409 si ya existe", async () => {
    await insertExercise("a");

    const first = await send("POST", "/api/routines", { body: { ...routineBody([item("a", 0)]), id: "mi-rutina" } });
    const second = await send("POST", "/api/routines", { body: { ...routineBody([item("a", 0)]), id: "mi-rutina" } });

    expect(first.status).toBe(201);
    expect((await json(first)).id).toBe("mi-rutina");
    expect(second.status).toBe(409);
    expect(await count("routines")).toBe(1);
    expect(await count("routine_items")).toBe(1);
  });

  it("genera un id distinto para cada rutina", async () => {
    const one = await createRoutine([]);
    const two = await createRoutine([]);

    expect(one.id).not.toBe(two.id);
    expect(one.items).toEqual([]);
  });

  it("responde 400, no 500, si un ítem referencia un ejercicio que no existe", async () => {
    await insertExercise("a");

    const response = await send("POST", "/api/routines", { body: routineBody([item("a", 0), item("fantasma", 1)]) });

    expect(response.status).toBe(400);
    expect(await count("routines")).toBe(0);
    expect(await count("routine_items")).toBe(0);
  });

  it("acepta el mismo ejercicio dos veces en la rutina", async () => {
    await insertExercise("a");

    const created = await createRoutine([item("a", 0), item("a", 1)]);

    expect(created.items).toHaveLength(2);
  });

  it("acepta un ejercicio archivado que ya estaba en la rutina", async () => {
    await insertExercise("a", "Archivado", 1);

    const created = await createRoutine([item("a", 0)]);

    expect(created.items).toHaveLength(1);
  });

  it.each([
    ["sin nombre", { name: "  " }],
    ["con 0 series", { items: [item("a", 0, { sets: 0 })] }],
    ["con un objetivo de repeticiones vacío", { items: [item("a", 0, { repsTarget: "" })] }],
    ["con un descanso negativo", { items: [item("a", 0, { restSeconds: -1 })] }],
    ["sin inRotation", { inRotation: undefined }],
  ])("responde 400 a una rutina %s", async (_label, overrides) => {
    await insertExercise("a");

    const response = await send("POST", "/api/routines", { body: routineBody([item("a", 0)], overrides) });

    expect(response.status).toBe(400);
    expect(await count("routines")).toBe(0);
  });

  it("responde 400 a JSON mal formado", async () => {
    expect((await send("POST", "/api/routines", { body: "{no es json" })).status).toBe(400);
  });
});

describe("GET /api/routines", () => {
  it("no incluye las archivadas y ordena por rotationOrder", async () => {
    await insertExercise("a");
    const second = await createRoutine([item("a", 0)], { name: "Segunda", rotationOrder: 1 });
    const archived = await createRoutine([item("a", 0)], { name: "Archivada", rotationOrder: 0, archived: true });
    const first = await createRoutine([item("a", 0)], { name: "Primera", rotationOrder: 0 });

    const ids = await listRoutineIds();

    expect(ids).toEqual([first.id, second.id]);
    expect(ids).not.toContain(archived.id);
  });

  it("desempata por orden de creación", async () => {
    const one = await createRoutine([], { name: "Uno" });
    const two = await createRoutine([], { name: "Dos" });
    const three = await createRoutine([], { name: "Tres" });

    expect(await listRoutineIds()).toEqual([one.id, two.id, three.id]);
  });

  it("devuelve cada rutina con sus propios ítems", async () => {
    await insertExercise("a");
    await insertExercise("b");
    const one = await createRoutine([item("a", 0)], { name: "Uno" });
    const two = await createRoutine([item("b", 0), item("a", 1)], { name: "Dos", rotationOrder: 1 });

    const listed = await json(await send("GET", "/api/routines"));

    expect(listed).toEqual([one, two]);
    expect(two.items.map((i: Json) => i.exerciseId)).toEqual(["b", "a"]);
  });
});

describe("PUT /api/routines/:id", () => {
  it("reemplaza la rutina completa: con 2 ítems quedan 2", async () => {
    await insertExercise("a");
    await insertExercise("b");
    await insertExercise("c");
    const created = await createRoutine([item("a", 0), item("b", 1), item("c", 2)]);

    const response = await send("PUT", `/api/routines/${created.id}`, {
      body: routineBody([item("c", 0, { sets: 5 }), item("a", 1)], { name: "Renombrada", inRotation: false, rotationOrder: 4 }),
    });

    expect(response.status).toBe(200);
    const updated = await json(response);
    expect(updated).toEqual({
      id: created.id,
      name: "Renombrada",
      inRotation: false,
      rotationOrder: 4,
      archived: false,
      items: [
        { exerciseId: "c", position: 0, sets: 5, repsTarget: "8-10", restSeconds: 90 },
        { exerciseId: "a", position: 1, sets: 3, repsTarget: "8-10", restSeconds: 90 },
      ],
    });
    expect(await count("routine_items", "routine_id = ?", created.id)).toBe(2);
    expect(await json(await send("GET", "/api/routines"))).toEqual([updated]);
  });

  it("no toca los ítems de otras rutinas", async () => {
    await insertExercise("a");
    const other = await createRoutine([item("a", 0), item("a", 1)], { name: "Otra" });
    const mine = await createRoutine([item("a", 0)], { name: "Mía", rotationOrder: 1 });

    await send("PUT", `/api/routines/${mine.id}`, { body: routineBody([], { name: "Mía", rotationOrder: 1 }) });

    expect(await count("routine_items", "routine_id = ?", other.id)).toBe(2);
    expect(await count("routine_items", "routine_id = ?", mine.id)).toBe(0);
  });

  it("puede archivar y recuperar la rutina con el campo archived", async () => {
    await insertExercise("a");
    const created = await createRoutine([item("a", 0)]);

    await send("PUT", `/api/routines/${created.id}`, { body: routineBody([item("a", 0)], { archived: true }) });
    expect(await listRoutineIds()).toEqual([]);

    await send("PUT", `/api/routines/${created.id}`, { body: routineBody([item("a", 0)], { archived: false }) });
    expect(await listRoutineIds()).toEqual([created.id]);
  });

  it("acepta un cuerpo con el mismo id que la URL", async () => {
    const created = await createRoutine([]);

    const response = await send("PUT", `/api/routines/${created.id}`, { body: { ...routineBody([]), id: created.id } });

    expect(response.status).toBe(200);
  });

  it("responde 400 si el id del cuerpo no coincide con el de la URL", async () => {
    const created = await createRoutine([], { name: "Original" });

    const response = await send("PUT", `/api/routines/${created.id}`, { body: { ...routineBody([], { name: "Otra" }), id: "distinto" } });

    expect(response.status).toBe(400);
    expect((await json(await send("GET", "/api/routines")))[0].name).toBe("Original");
  });

  it("responde 400 y deja la rutina intacta si un ítem referencia un ejercicio que no existe", async () => {
    await insertExercise("a");
    await insertExercise("b");
    const created = await createRoutine([item("a", 0), item("b", 1)], { name: "Original" });

    const response = await send("PUT", `/api/routines/${created.id}`, {
      body: routineBody([item("a", 0), item("fantasma", 1)], { name: "Cambiada" }),
    });

    expect(response.status).toBe(400);
    expect(await json(await send("GET", "/api/routines"))).toEqual([created]);
  });

  it("responde 404 si la rutina no existe", async () => {
    const response = await send("PUT", "/api/routines/no-existe", { body: routineBody([]) });

    expect(response.status).toBe(404);
    expect(await count("routines")).toBe(0);
  });

  it("responde 400 a un cuerpo no válido", async () => {
    const created = await createRoutine([]);

    const response = await send("PUT", `/api/routines/${created.id}`, { body: { name: "Sin más campos" } });

    expect(response.status).toBe(400);
  });
});

describe("DELETE /api/routines/:id", () => {
  it("archiva la rutina: no sale en el listado pero la fila y sus ítems se conservan", async () => {
    await insertExercise("a");
    const created = await createRoutine([item("a", 0)]);
    await insertWorkout("w1", "2026-11-02", [{ exerciseId: "a", sets: [{ reps: 5 }] }]);
    await env.DB.prepare("UPDATE workouts SET routine_id = ? WHERE id = 'w1'").bind(created.id).run();

    const response = await send("DELETE", `/api/routines/${created.id}`);

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ archived: true });
    expect(await listRoutineIds()).toEqual([]);
    expect(await count("routines", "id = ? AND archived = 1", created.id)).toBe(1);
    expect(await count("routine_items", "routine_id = ?", created.id)).toBe(1);
    expect(await count("workouts", "routine_id = ?", created.id)).toBe(1);
  });

  it("es idempotente con una rutina ya archivada", async () => {
    const created = await createRoutine([]);

    await send("DELETE", `/api/routines/${created.id}`);
    const again = await send("DELETE", `/api/routines/${created.id}`);

    expect(again.status).toBe(200);
    expect(await json(again)).toEqual({ archived: true });
  });

  it("responde 404 si la rutina no existe", async () => {
    const response = await send("DELETE", "/api/routines/no-existe");

    expect(response.status).toBe(404);
  });
});

describe("POST /api/routines/reorder", () => {
  it("reescribe rotation_order y cambia el orden que devuelve GET", async () => {
    const one = await createRoutine([], { name: "Uno", rotationOrder: 0 });
    const two = await createRoutine([], { name: "Dos", rotationOrder: 1 });
    const three = await createRoutine([], { name: "Tres", rotationOrder: 2 });
    expect(await listRoutineIds()).toEqual([one.id, two.id, three.id]);

    const response = await send("POST", "/api/routines/reorder", { body: { ids: [three.id, one.id, two.id] } });

    expect(response.status).toBe(200);
    expect(await listRoutineIds()).toEqual([three.id, one.id, two.id]);
    const body = await json(response);
    expect(body.map((r: Json) => [r.id, r.rotationOrder])).toEqual([
      [three.id, 0],
      [one.id, 1],
      [two.id, 2],
    ]);
  });

  it("deja los ítems de las rutinas como estaban", async () => {
    await insertExercise("a");
    const one = await createRoutine([item("a", 0), item("a", 1)], { name: "Uno", rotationOrder: 0 });
    const two = await createRoutine([item("a", 0)], { name: "Dos", rotationOrder: 1 });

    await send("POST", "/api/routines/reorder", { body: { ids: [two.id, one.id] } });

    expect(await count("routine_items", "routine_id = ?", one.id)).toBe(2);
    expect(await count("routine_items", "routine_id = ?", two.id)).toBe(1);
  });

  it("responde 400 y no cambia nada si algún id no existe", async () => {
    const one = await createRoutine([], { name: "Uno", rotationOrder: 0 });
    const two = await createRoutine([], { name: "Dos", rotationOrder: 1 });

    const response = await send("POST", "/api/routines/reorder", { body: { ids: [two.id, "fantasma", one.id] } });

    expect(response.status).toBe(400);
    expect(await listRoutineIds()).toEqual([one.id, two.id]);
  });

  it("responde 400 si hay ids repetidos", async () => {
    const one = await createRoutine([], { rotationOrder: 0 });
    const two = await createRoutine([], { rotationOrder: 1 });

    const response = await send("POST", "/api/routines/reorder", { body: { ids: [two.id, two.id, one.id] } });

    expect(response.status).toBe(400);
    expect(await listRoutineIds()).toEqual([one.id, two.id]);
  });

  it("responde 400 a un cuerpo sin ids", async () => {
    expect((await send("POST", "/api/routines/reorder", { body: {} })).status).toBe(400);
    expect((await send("POST", "/api/routines/reorder", { body: { ids: "uno" } })).status).toBe(400);
  });
});
