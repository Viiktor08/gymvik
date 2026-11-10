import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { ORIGIN, send } from "./helpers";

type Json = Record<string, any>;

async function json(response: Response): Promise<any> {
  return response.json();
}

async function rows(table: string): Promise<Json[]> {
  const { results } = await env.DB.prepare(`SELECT * FROM ${table} ORDER BY local_date`).all<Json>();
  return results;
}

const DEFAULT_SETTINGS = {
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
};

beforeEach(async () => {
  // El almacenamiento D1 no se aísla entre tests del mismo archivo: se vacía y se restauran los ajustes.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM body_metrics"),
    env.DB.prepare("DELETE FROM creatine_logs"),
    env.DB.prepare("DELETE FROM settings"),
    env.DB.prepare("INSERT INTO settings (id) VALUES (1)"),
  ]);
});

describe("acceso", () => {
  it.each([
    ["PUT", "/api/body-metrics/2026-11-09"],
    ["DELETE", "/api/body-metrics/2026-11-09"],
    ["PUT", "/api/creatine/2026-11-09"],
    ["DELETE", "/api/creatine/2026-11-09"],
    ["GET", "/api/settings"],
    ["PATCH", "/api/settings"],
  ])("%s %s sin sesión responde 401", async (method, path) => {
    const response = await exports.default.fetch(`${ORIGIN}${path}`, {
      method,
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: method === "PUT" || method === "PATCH" ? "{}" : undefined,
    });
    expect(response.status).toBe(401);
  });
});

describe("PUT /api/body-metrics/:date", () => {
  const url = "/api/body-metrics/2026-11-09";

  it("guarda peso y grasa y devuelve lo guardado", async () => {
    const response = await send("PUT", url, { body: { weightKg: 78.5, bodyFatPct: 18.2 } });
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ localDate: "2026-11-09", weightKg: 78.5, bodyFatPct: 18.2 });
    expect(await rows("body_metrics")).toEqual([
      { local_date: "2026-11-09", weight_kg: 78.5, body_fat_pct: 18.2 },
    ]);
  });

  it("sin grasa (o con null) guarda null", async () => {
    expect(await json(await send("PUT", url, { body: { weightKg: 78 } }))).toEqual({
      localDate: "2026-11-09",
      weightKg: 78,
      bodyFatPct: null,
    });
    expect((await send("PUT", "/api/body-metrics/2026-11-10", { body: { weightKg: 77, bodyFatPct: null } })).status).toBe(
      200,
    );
    expect((await rows("body_metrics")).map((row) => row.body_fat_pct)).toEqual([null, null]);
  });

  it("es idempotente y reemplaza el registro del día, grasa incluida", async () => {
    await send("PUT", url, { body: { weightKg: 78.5, bodyFatPct: 18.2 } });
    await send("PUT", url, { body: { weightKg: 78.5, bodyFatPct: 18.2 } });
    expect(await rows("body_metrics")).toHaveLength(1);

    const response = await send("PUT", url, { body: { weightKg: 77.9 } });
    expect(await json(response)).toEqual({ localDate: "2026-11-09", weightKg: 77.9, bodyFatPct: null });
    expect(await rows("body_metrics")).toEqual([
      { local_date: "2026-11-09", weight_kg: 77.9, body_fat_pct: null },
    ]);
  });

  it.each([
    ["peso cero", { weightKg: 0 }],
    ["peso negativo", { weightKg: -70 }],
    ["peso como texto", { weightKg: "78,5" }],
    ["peso ausente", { bodyFatPct: 18 }],
    ["peso infinito", "{\"weightKg\": 1e999}"],
    ["grasa mayor que 100", { weightKg: 78, bodyFatPct: 100.5 }],
    ["grasa negativa", { weightKg: 78, bodyFatPct: -1 }],
    ["JSON mal formado", "{\"weightKg\":"],
    ["cuerpo que no es un objeto", "[]"],
  ])("%s responde 400 y no guarda nada", async (_name, body) => {
    const response = await send("PUT", url, { body });
    expect(response.status).toBe(400);
    expect(await json(response)).toEqual({ error: expect.any(String) });
    expect(await rows("body_metrics")).toEqual([]);
  });

  it("sin cuerpo responde 400", async () => {
    expect((await send("PUT", url)).status).toBe(400);
  });

  it.each(["2026-02-30", "09-11-2026", "hoy", "2026-13-01"])("la fecha %s no válida responde 400", async (date) => {
    const response = await send("PUT", `/api/body-metrics/${date}`, { body: { weightKg: 78 } });
    expect(response.status).toBe(400);
    expect(await rows("body_metrics")).toEqual([]);
  });
});

describe("DELETE /api/body-metrics/:date", () => {
  it("borra el registro del día y deja los demás", async () => {
    await send("PUT", "/api/body-metrics/2026-11-09", { body: { weightKg: 78 } });
    await send("PUT", "/api/body-metrics/2026-11-10", { body: { weightKg: 77 } });

    const response = await send("DELETE", "/api/body-metrics/2026-11-09");
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ deleted: true });
    expect((await rows("body_metrics")).map((row) => row.local_date)).toEqual(["2026-11-10"]);
  });

  it("un día sin registro responde 404 (así que un segundo borrado también)", async () => {
    await send("PUT", "/api/body-metrics/2026-11-09", { body: { weightKg: 78 } });
    expect((await send("DELETE", "/api/body-metrics/2026-11-09")).status).toBe(200);
    expect((await send("DELETE", "/api/body-metrics/2026-11-09")).status).toBe(404);
  });

  it("una fecha no válida responde 400", async () => {
    expect((await send("DELETE", "/api/body-metrics/2026-02-30")).status).toBe(400);
  });
});

describe("PUT /api/creatine/:date", () => {
  const url = "/api/creatine/2026-11-09";

  it("marca el día con los gramos de los ajustes y source manual", async () => {
    const response = await send("PUT", url);
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ localDate: "2026-11-09", grams: 5, source: "manual" });
    expect(await rows("creatine_logs")).toEqual([{ local_date: "2026-11-09", grams: 5, source: "manual" }]);
  });

  it("usa los gramos que haya en ajustes en ese momento", async () => {
    await send("PATCH", "/api/settings", { body: { creatineGrams: 7.5 } });
    expect(await json(await send("PUT", url))).toEqual({ localDate: "2026-11-09", grams: 7.5, source: "manual" });
  });

  it("es idempotente: dos PUT dejan una sola fila", async () => {
    await send("PUT", url);
    expect((await send("PUT", url)).status).toBe(200);
    expect(await rows("creatine_logs")).toHaveLength(1);
  });

  it("sobre una toma del NFC deja una sola fila manual", async () => {
    await env.DB.prepare("INSERT INTO creatine_logs (local_date, grams, source) VALUES ('2026-11-09', 3, 'nfc')").run();
    await send("PUT", url);
    expect(await rows("creatine_logs")).toEqual([{ local_date: "2026-11-09", grams: 5, source: "manual" }]);
  });

  it("no exige cuerpo, y si lo hay lo ignora", async () => {
    expect((await send("PUT", "/api/creatine/2026-11-10", { body: { grams: 99 } })).status).toBe(200);
    expect((await rows("creatine_logs"))[0]?.grams).toBe(5);
  });

  it.each(["2026-02-30", "hoy", "2026-11-9"])("la fecha %s no válida responde 400", async (date) => {
    expect((await send("PUT", `/api/creatine/${date}`)).status).toBe(400);
    expect(await rows("creatine_logs")).toEqual([]);
  });
});

describe("DELETE /api/creatine/:date", () => {
  it("desmarca el día, venga la toma del NFC o de la app", async () => {
    await env.DB.prepare("INSERT INTO creatine_logs (local_date, grams, source) VALUES ('2026-11-09', 5, 'nfc')").run();
    await send("PUT", "/api/creatine/2026-11-10");

    const response = await send("DELETE", "/api/creatine/2026-11-09");
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ deleted: true });
    expect((await rows("creatine_logs")).map((row) => row.local_date)).toEqual(["2026-11-10"]);
  });

  it("un día sin toma responde 404", async () => {
    expect((await send("DELETE", "/api/creatine/2026-11-09")).status).toBe(404);
  });

  it("una fecha no válida responde 400", async () => {
    expect((await send("DELETE", "/api/creatine/mañana")).status).toBe(400);
  });
});

describe("GET /api/settings", () => {
  it("devuelve los ajustes por defecto con los avisos agrupados en notifications", async () => {
    const response = await send("GET", "/api/settings");
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual(DEFAULT_SETTINGS);
  });

  it("refleja lo que haya en las columnas notify_*", async () => {
    await env.DB.prepare(
      "UPDATE settings SET notify_steps_enabled = 0, notify_steps_time = '21:30', notify_weight_time = '08:15'",
    ).run();
    const body = await json(await send("GET", "/api/settings"));
    expect(body.notifications.steps).toEqual({ enabled: false, time: "21:30" });
    expect(body.notifications.weight).toEqual({ enabled: true, time: "08:15" });
    expect(body.notifications.today).toEqual({ enabled: true, time: "09:00" });
  });
});

describe("PATCH /api/settings", () => {
  it("cambia solo los campos enviados y devuelve los ajustes completos", async () => {
    const response = await send("PATCH", "/api/settings", {
      body: { displayName: "  Ana  ", theme: "blue", weeklyGoal: 4, stepsGoal: 10000, creatineGrams: 3.5 },
    });
    expect(response.status).toBe(200);
    const expected = {
      ...DEFAULT_SETTINGS,
      displayName: "Ana",
      theme: "blue",
      weeklyGoal: 4,
      stepsGoal: 10000,
      creatineGrams: 3.5,
    };
    expect(await json(response)).toEqual(expected);
    expect(await json(await send("GET", "/api/settings"))).toEqual(expected);
  });

  it("cambia la zona horaria y el nombre del Atajo", async () => {
    const body = await json(
      await send("PATCH", "/api/settings", { body: { timezone: "America/Mexico_City", shortcutName: "Mis pasos" } }),
    );
    expect(body.timezone).toBe("America/Mexico_City");
    expect(body.shortcutName).toBe("Mis pasos");
    const row = await env.DB.prepare("SELECT timezone, shortcut_name FROM settings").first<Json>();
    expect(row).toEqual({ timezone: "America/Mexico_City", shortcut_name: "Mis pasos" });
  });

  it("en notifications basta con el aviso y el campo que cambian", async () => {
    const body = await json(
      await send("PATCH", "/api/settings", {
        body: { notifications: { today: { enabled: false }, steps: { time: "21:15" } } },
      }),
    );
    expect(body.notifications).toEqual({
      ...DEFAULT_SETTINGS.notifications,
      today: { enabled: false, time: "09:00" },
      steps: { enabled: true, time: "21:15" },
    });
    const row = await env.DB.prepare(
      "SELECT notify_today_enabled, notify_today_time, notify_steps_enabled, notify_steps_time, notify_streak_time FROM settings",
    ).first<Json>();
    expect(row).toEqual({
      notify_today_enabled: 0,
      notify_today_time: "09:00",
      notify_steps_enabled: 1,
      notify_steps_time: "21:15",
      notify_streak_time: "19:00",
    });
  });

  it("volver a activar un aviso lo deja a 1", async () => {
    await send("PATCH", "/api/settings", { body: { notifications: { weight: { enabled: false } } } });
    const body = await json(await send("PATCH", "/api/settings", { body: { notifications: { weight: { enabled: true } } } }));
    expect(body.notifications.weight).toEqual({ enabled: true, time: "09:00" });
  });

  it("un parche vacío no cambia nada", async () => {
    const response = await send("PATCH", "/api/settings", { body: {} });
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual(DEFAULT_SETTINGS);
  });

  it("dos parches seguidos se acumulan", async () => {
    await send("PATCH", "/api/settings", { body: { weeklyGoal: 5 } });
    await send("PATCH", "/api/settings", { body: { theme: "teal" } });
    const body = await json(await send("GET", "/api/settings"));
    expect(body.weeklyGoal).toBe(5);
    expect(body.theme).toBe("teal");
  });

  it.each([
    ["clave desconocida", { favoriteColor: "red" }],
    ["objetivo semanal 0", { weeklyGoal: 0 }],
    ["objetivo semanal 8", { weeklyGoal: 8 }],
    ["objetivo semanal decimal", { weeklyGoal: 3.5 }],
    ["pasos negativos", { stepsGoal: -1 }],
    ["gramos cero", { creatineGrams: 0 }],
    ["tema que no existe", { theme: "amarillo" }],
    ["nombre en blanco", { displayName: "   " }],
    ["zona horaria que no existe", { timezone: "Mars/Phobos" }],
    ["hora de aviso mal formada", { notifications: { today: { time: "25:00" } } }],
    ["tipo de aviso desconocido", { notifications: { lunch: { enabled: true } } }],
    ["campo de aviso desconocido", { notifications: { today: { sound: true } } }],
    ["enabled que no es booleano", { notifications: { today: { enabled: "yes" } } }],
    ["JSON mal formado", "{\"weeklyGoal\":"],
  ])("%s responde 400 y no cambia nada", async (_name, body) => {
    const response = await send("PATCH", "/api/settings", { body });
    expect(response.status).toBe(400);
    expect(await json(response)).toEqual({ error: expect.any(String) });
    expect(await json(await send("GET", "/api/settings"))).toEqual(DEFAULT_SETTINGS);
  });

  it("un parche con un campo válido y otro no válido no aplica ninguno", async () => {
    expect((await send("PATCH", "/api/settings", { body: { theme: "blue", weeklyGoal: 0 } })).status).toBe(400);
    expect((await json(await send("GET", "/api/settings"))).theme).toBe("green");
  });
});
