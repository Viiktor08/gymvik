import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PushMessage } from "../../src/shared/notifications";
import { runNotifications } from "../../src/worker/push/cron";
import type { sendPush } from "../../src/worker/push/webpush";

type Json = Record<string, any>;
type Send = typeof sendPush;

// Lunes 2026-11-09 y martes 2026-11-10; en noviembre Madrid va una hora por delante de UTC.
const TUESDAY = "2026-11-10";
const AT_0900 = new Date("2026-11-10T08:00:00Z"); // 09:00 en Madrid
const AT_0915 = new Date("2026-11-10T08:15:00Z");
const AT_0845 = new Date("2026-11-10T07:45:00Z");
const AT_2000 = new Date("2026-11-10T19:00:00Z");

const SUB_A = { endpoint: "https://push.example.test/a", p256dh: "p256dh-a", auth: "auth-a" };
const SUB_B = { endpoint: "https://push.example.test/b", p256dh: "p256dh-b", auth: "auth-b" };

/** Un `send` simulado: nunca toca la red. Por defecto entrega. */
function fakeSend(impl: Send = async () => ({ gone: false })) {
  return vi.fn<Send>(impl);
}

/** Tipos de los mensajes enviados, en orden y sin repetir los de varias suscripciones. */
function sentTypes(send: ReturnType<typeof fakeSend>): string[] {
  return [...new Set(send.mock.calls.map(([, message]) => message.type))];
}

async function all(table: string, order: string): Promise<Json[]> {
  const { results } = await env.DB.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all<Json>();
  return results;
}

const recorded = () => all("notifications_sent", "type, local_date");
const subscriptions = async () => (await all("push_subscriptions", "endpoint")).map((row) => row.endpoint);

async function subscribe(...subs: (typeof SUB_A)[]): Promise<void> {
  for (const sub of subs) {
    await env.DB.prepare("INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES (?, ?, ?)")
      .bind(sub.endpoint, sub.p256dh, sub.auth)
      .run();
  }
}

/** Una rutina en la rotación con `exercises` ejercicios: sin ella `today` no se envía (no hay `next`). */
async function insertRoutine(id: string, name: string, exercises: number): Promise<void> {
  await env.DB.prepare("INSERT INTO routines (id, name, in_rotation, rotation_order) VALUES (?, ?, 1, 0)")
    .bind(id, name)
    .run();
  for (let position = 0; position < exercises; position++) {
    await env.DB.prepare("INSERT OR IGNORE INTO exercises (id, name, category) VALUES (?, ?, 'strength')")
      .bind(`ex${position}`, `Ejercicio ${position}`)
      .run();
    await env.DB.prepare("INSERT INTO routine_items (routine_id, exercise_id, position) VALUES (?, ?, ?)")
      .bind(id, `ex${position}`, position)
      .run();
  }
}

beforeEach(async () => {
  // El almacenamiento D1 no se aísla entre tests del mismo archivo: se vacía todo lo que usa la tarea.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM push_subscriptions"),
    env.DB.prepare("DELETE FROM notifications_sent"),
    env.DB.prepare("DELETE FROM workouts"),
    env.DB.prepare("DELETE FROM routine_items"),
    env.DB.prepare("DELETE FROM routines"),
    env.DB.prepare("DELETE FROM exercises"),
    env.DB.prepare("DELETE FROM body_metrics"),
    env.DB.prepare("DELETE FROM creatine_logs"),
    env.DB.prepare("DELETE FROM daily_steps"),
    env.DB.prepare("DELETE FROM settings"),
    env.DB.prepare("INSERT INTO settings (id) VALUES (1)"),
  ]);
});

describe("runNotifications", () => {
  it("a las 09:00 de Madrid envía today y weight, y no los repite a las 09:15", async () => {
    await insertRoutine("pecho", "Pecho", 2);
    await subscribe(SUB_A);
    const send = fakeSend();

    expect(await runNotifications(env, AT_0900, send)).toEqual(["today", "weight"]);

    expect(send).toHaveBeenCalledTimes(2);
    expect(sentTypes(send)).toEqual(["today", "weight"]);
    const [sub, today, passedEnv] = send.mock.calls[0]!;
    expect(sub).toEqual(SUB_A);
    expect(today).toEqual({ type: "today", title: "Gymvik", body: "Hoy toca Pecho (2 ejercicios)", url: "/" });
    expect(passedEnv).toBe(env);
    expect(await recorded()).toEqual([
      { type: "today", local_date: TUESDAY },
      { type: "weight", local_date: TUESDAY },
    ]);

    send.mockClear();
    expect(await runNotifications(env, AT_0915, send)).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it("no envía antes de la hora configurada", async () => {
    await insertRoutine("pecho", "Pecho", 2);
    await subscribe(SUB_A);
    const send = fakeSend();

    expect(await runNotifications(env, AT_0845, send)).toEqual([]);

    expect(send).not.toHaveBeenCalled();
    expect(await recorded()).toEqual([]);
  });

  it("sin rutina en rotación no envía today", async () => {
    await subscribe(SUB_A);
    const send = fakeSend();

    expect(await runNotifications(env, AT_0900, send)).toEqual(["weight"]);
  });

  it("si send devuelve gone, borra esa suscripción y no registra el aviso", async () => {
    await insertRoutine("pecho", "Pecho", 2);
    await subscribe(SUB_A, SUB_B);
    const send = fakeSend(async (sub) => ({ gone: sub.endpoint === SUB_A.endpoint }));

    // La otra suscripción sí lo recibió: se registra.
    expect(await runNotifications(env, AT_0900, send)).toEqual(["today", "weight"]);
    expect(await subscriptions()).toEqual([SUB_B.endpoint]);

    // Si la única suscripción está gone, el aviso no llegó a nadie: no se registra.
    await env.DB.prepare("DELETE FROM notifications_sent").run();
    send.mockImplementation(async () => ({ gone: true }));
    expect(await runNotifications(env, AT_0900, send)).toEqual([]);
    expect(await subscriptions()).toEqual([]);
    expect(await recorded()).toEqual([]);
  });

  it("sin suscripciones no falla, no envía ni registra nada", async () => {
    await insertRoutine("pecho", "Pecho", 2);
    const send = fakeSend();

    expect(await runNotifications(env, AT_0900, send)).toEqual([]);

    expect(send).not.toHaveBeenCalled();
    expect(await recorded()).toEqual([]);
  });

  it("envía cada aviso a todas las suscripciones", async () => {
    await subscribe(SUB_A, SUB_B);
    const send = fakeSend();

    expect(await runNotifications(env, AT_0900, send)).toEqual(["weight"]);

    expect(send.mock.calls.map(([sub]) => sub.endpoint).sort()).toEqual([SUB_A.endpoint, SUB_B.endpoint]);
  });

  it("el fallo de una suscripción no impide las demás ni tumba la tarea", async () => {
    await subscribe(SUB_A, SUB_B);
    const send = fakeSend(async (sub) => {
      if (sub.endpoint === SUB_A.endpoint) throw new Error("El servicio de push respondió 500");
      return { gone: false };
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await runNotifications(env, AT_0900, send)).toEqual(["weight"]);

    expect(send).toHaveBeenCalledTimes(2);
    // La suscripción que falló se conserva: puede ser un fallo pasajero.
    expect(await subscriptions()).toEqual([SUB_A.endpoint, SUB_B.endpoint]);
    expect(await recorded()).toEqual([{ type: "weight", local_date: TUESDAY }]);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("si el aviso no llegó a ninguna suscripción, no se registra y se reintenta en la siguiente pasada", async () => {
    await subscribe(SUB_A);
    const failing = fakeSend(async () => {
      throw new Error("Sin red");
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await runNotifications(env, AT_0900, failing)).toEqual([]);
    expect(await recorded()).toEqual([]);
    error.mockRestore();

    const working = fakeSend();
    expect(await runNotifications(env, AT_0915, working)).toEqual(["weight"]);
    expect(await recorded()).toEqual([{ type: "weight", local_date: TUESDAY }]);
  });

  it("construye el estado con los datos de hoy: entreno, creatina, pasos y peso", async () => {
    await insertRoutine("pecho", "Pecho", 2);
    await subscribe(SUB_A);
    // Entreno hoy: today no toca. Creatina marcada: creatine no toca. Peso de ayer: weight no toca.
    await env.DB.prepare(
      "INSERT INTO workouts (id, routine_id, started_at, ended_at, local_date) VALUES ('w1', 'pecho', ?, ?, ?)",
    )
      .bind("2026-11-10T07:00:00.000Z", "2026-11-10T08:00:00.000Z", TUESDAY)
      .run();
    await env.DB.prepare("INSERT INTO creatine_logs (local_date, grams, source) VALUES (?, 5, 'manual')")
      .bind(TUESDAY)
      .run();
    await env.DB.prepare("INSERT INTO body_metrics (local_date, weight_kg) VALUES ('2026-11-09', 80)").run();
    await env.DB.prepare("INSERT INTO daily_steps (local_date, steps) VALUES (?, 4210)").bind(TUESDAY).run();
    const send = fakeSend();

    // A las 20:00 solo toca steps; streak no (quedan 6 días y faltan 2 entrenos).
    expect(await runNotifications(env, AT_2000, send)).toEqual(["steps"]);

    const message = send.mock.calls[0]![1] as PushMessage;
    expect(message).toEqual({ type: "steps", title: "Gymvik", body: "Llevas 4.210 de 8.000 pasos", url: "/" });
  });

  it("usa la fecha y la hora locales de los ajustes, no las de UTC", async () => {
    await subscribe(SUB_A);
    // 23:30 UTC del martes es la 00:30 del miércoles en Madrid: con la hora de weight a las 00:00 toca.
    await env.DB.prepare("UPDATE settings SET notify_weight_time = '00:00' WHERE id = 1").run();
    const send = fakeSend();

    expect(await runNotifications(env, new Date("2026-11-10T23:30:00Z"), send)).toEqual(["weight"]);

    expect(await recorded()).toEqual([{ type: "weight", local_date: "2026-11-11" }]);
  });
});
