import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localDate } from "../../src/shared/dates";
import { sha256Hex } from "../../src/worker/security/crypto";
import { ORIGIN, authed, send } from "./helpers";

type Json = Record<string, any>;

const MADRID = "Europe/Madrid";

async function json(response: Response): Promise<any> {
  return response.json();
}

async function rows(table: string, order = "local_date"): Promise<Json[]> {
  const { results } = await env.DB.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all<Json>();
  return results;
}

async function keyRow(key: string): Promise<Json | null> {
  return env.DB.prepare("SELECT * FROM hook_keys WHERE key_hash = ?")
    .bind(await sha256Hex(key))
    .first<Json>();
}

/** Crea una clave por la API (con sesión) y devuelve el secreto, que solo se ve en esa respuesta. */
async function createKey(scopes: string[], label = "Atajo de prueba"): Promise<string> {
  const response = await send("POST", "/api/hook-keys", { body: { label, scopes } });
  expect(response.status).toBe(201);
  return (await json(response)).key;
}

type HookOptions = { body?: unknown; headers?: Record<string, string> };

/**
 * Llamada a un hook como la hace un Atajo: POST con `Authorization: Bearer`, sin cookie y sin `Origin`.
 * Un string se manda tal cual (JSON mal formado); sin `body`, la petición va sin cuerpo.
 */
function hook(path: string, key: string | null, options: HookOptions = {}): Promise<Response> {
  const { body, headers = {} } = options;
  return exports.default.fetch(`${ORIGIN}/api/hook/${path}`, {
    method: "POST",
    headers: {
      ...(key === null ? {} : { Authorization: `Bearer ${key}` }),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(async () => {
  // El almacenamiento D1 no se aísla entre tests del mismo archivo: se vacía y se restauran los ajustes.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM hook_keys"),
    env.DB.prepare("DELETE FROM rate_limits"),
    env.DB.prepare("DELETE FROM creatine_logs"),
    env.DB.prepare("DELETE FROM daily_steps"),
    env.DB.prepare("DELETE FROM settings"),
    env.DB.prepare("INSERT INTO settings (id) VALUES (1)"),
  ]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("claves de atajo (con sesión)", () => {
  it.each([
    ["GET", "/api/hook-keys"],
    ["POST", "/api/hook-keys"],
    ["DELETE", "/api/hook-keys/abc"],
  ])("%s %s sin sesión responde 401", async (method, path) => {
    const response = await exports.default.fetch(`${ORIGIN}${path}`, {
      method,
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: method === "POST" ? JSON.stringify({ label: "x", scopes: ["steps"] }) : undefined,
    });

    expect(response.status).toBe(401);
  });

  it("/api/hook-keys sigue exigiendo sesión aunque empiece parecido a /api/hook/", async () => {
    const key = await createKey(["creatine", "steps"]);

    // Una clave Bearer válida no abre las rutas de gestión de claves.
    for (const [method, path] of [
      ["GET", "/api/hook-keys"],
      ["POST", "/api/hook-keys"],
      ["DELETE", "/api/hook-keys/abc"],
    ] as const) {
      const response = await exports.default.fetch(`${ORIGIN}${path}`, {
        method,
        headers: { Authorization: `Bearer ${key}`, Origin: ORIGIN, "Content-Type": "application/json" },
        body: method === "POST" ? JSON.stringify({ label: "otra", scopes: ["steps"] }) : undefined,
      });

      expect(response.status, `${method} ${path}`).toBe(401);
    }
    expect(await rows("hook_keys", "created_at")).toHaveLength(1);
  });

  it("exige el Origin del propio sitio al crear y revocar (no es un hook)", async () => {
    const cookie = { ...(await authed()), Origin: "https://evil.example", "Content-Type": "application/json" };

    const created = await exports.default.fetch(`${ORIGIN}/api/hook-keys`, {
      method: "POST",
      headers: cookie,
      body: JSON.stringify({ label: "x", scopes: ["steps"] }),
    });
    const revoked = await exports.default.fetch(`${ORIGIN}/api/hook-keys/abc`, { method: "DELETE", headers: cookie });

    expect(created.status).toBe(403);
    expect(revoked.status).toBe(403);
  });

  it("crea una clave fk_ + 32 bytes en base64url y guarda solo su hash", async () => {
    const response = await send("POST", "/api/hook-keys", { body: { label: "  NFC cocina ", scopes: ["creatine"] } });

    expect(response.status).toBe(201);
    const body = await json(response);
    expect(Object.keys(body)).toEqual(["key"]);
    expect(body.key).toMatch(/^fk_[A-Za-z0-9_-]{43}$/);

    const stored = await rows("hook_keys", "created_at");
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      label: "NFC cocina",
      key_hash: await sha256Hex(body.key),
      scopes: '["creatine"]',
      last_used_at: null,
      revoked_at: null,
    });
    // El secreto en claro no está en ninguna columna.
    expect(JSON.stringify(stored)).not.toContain(body.key);
  });

  it("cada clave es distinta y los permisos repetidos se guardan una vez", async () => {
    const first = await createKey(["steps", "steps", "creatine"]);
    const second = await createKey(["steps"]);

    expect(first).not.toBe(second);
    expect(JSON.parse((await keyRow(first))?.scopes)).toEqual(["steps", "creatine"]);
  });

  it.each([
    ["scopes vacío", { label: "x", scopes: [] }],
    ["permiso desconocido", { label: "x", scopes: ["steps", "weight"] }],
    ["permiso que no es texto", { label: "x", scopes: [1] }],
    ["scopes que no es una lista", { label: "x", scopes: "steps" }],
    ["sin scopes", { label: "x" }],
    ["sin etiqueta", { scopes: ["steps"] }],
    ["etiqueta vacía", { label: "   ", scopes: ["steps"] }],
    ["etiqueta demasiado larga", { label: "x".repeat(101), scopes: ["steps"] }],
    ["etiqueta que no es texto", { label: 5, scopes: ["steps"] }],
  ])("rechaza con 400: %s", async (_name, body) => {
    const response = await send("POST", "/api/hook-keys", { body });

    expect(response.status).toBe(400);
    expect(await rows("hook_keys", "created_at")).toHaveLength(0);
  });

  it("rechaza con 400 un cuerpo que no es JSON", async () => {
    const response = await send("POST", "/api/hook-keys", { body: "{no es json" });

    expect(response.status).toBe(400);
  });

  it("lista las claves, las más recientes primero, sin el secreto ni el hash", async () => {
    const first = await createKey(["steps"], "Pasos");
    const second = await createKey(["creatine", "steps"], "Todo");
    await env.DB.prepare("UPDATE hook_keys SET created_at = ? WHERE key_hash = ?")
      .bind("2020-01-01T00:00:00.000Z", await sha256Hex(first))
      .run();

    const response = await send("GET", "/api/hook-keys");

    expect(response.status).toBe(200);
    const list = await json(response);
    expect(list).toEqual([
      {
        id: expect.any(String),
        label: "Todo",
        scopes: ["creatine", "steps"],
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        lastUsedAt: null,
        revokedAt: null,
      },
      {
        id: expect.any(String),
        label: "Pasos",
        scopes: ["steps"],
        createdAt: "2020-01-01T00:00:00.000Z",
        lastUsedAt: null,
        revokedAt: null,
      },
    ]);
    const text = JSON.stringify(list);
    expect(text).not.toContain(first);
    expect(text).not.toContain(second);
    expect(text).not.toContain(await sha256Hex(first));
  });

  it("la lista vacía es []", async () => {
    const response = await send("GET", "/api/hook-keys");

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual([]);
  });

  it("revocar marca revokedAt, mantiene la clave en la lista y es idempotente", async () => {
    const key = await createKey(["steps"]);
    const id = (await keyRow(key))?.id;

    const first = await send("DELETE", `/api/hook-keys/${id}`);
    const revokedAt = (await keyRow(key))?.revoked_at;
    const second = await send("DELETE", `/api/hook-keys/${id}`);

    expect(first.status).toBe(200);
    expect(await json(first)).toEqual({ revoked: true });
    expect(second.status).toBe(200);
    expect(Date.parse(revokedAt)).not.toBeNaN();
    // Revocar otra vez no mueve la fecha de la primera revocación.
    expect((await keyRow(key))?.revoked_at).toBe(revokedAt);
    const list = await json(await send("GET", "/api/hook-keys"));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id, revokedAt });
  });

  it("revocar una clave que no existe responde 404", async () => {
    const response = await send("DELETE", "/api/hook-keys/no-existe");

    expect(response.status).toBe(404);
  });

  it("revocar una clave no afecta a las demás", async () => {
    const revoked = await createKey(["steps"]);
    const other = await createKey(["steps"]);

    await send("DELETE", `/api/hook-keys/${(await keyRow(revoked))?.id}`);

    expect((await hook("steps", revoked, { body: { steps: 1 } })).status).toBe(401);
    expect((await hook("steps", other, { body: { steps: 1 } })).status).toBe(200);
  });
});

describe("autenticación de los hooks", () => {
  it("una clave de atajo usada contra /api/settings da 401", async () => {
    const key = await createKey(["creatine", "steps"]);

    for (const method of ["GET", "PATCH"]) {
      const response = await exports.default.fetch(`${ORIGIN}/api/settings`, {
        method,
        headers: { Authorization: `Bearer ${key}`, Origin: ORIGIN, "Content-Type": "application/json" },
        body: method === "PATCH" ? JSON.stringify({ displayName: "Intruso" }) : undefined,
      });

      expect(response.status, method).toBe(401);
      expect(await json(response)).toEqual({ error: "No autenticado" });
    }
  });

  it("una clave de atajo no abre el resto de /api/*", async () => {
    const key = await createKey(["creatine", "steps"]);

    for (const [method, path] of [
      ["GET", "/api/today"],
      ["PUT", "/api/creatine/2026-11-09"],
      ["GET", "/api/workouts"],
    ] as const) {
      const response = await exports.default.fetch(`${ORIGIN}${path}`, {
        method,
        headers: { Authorization: `Bearer ${key}`, Origin: ORIGIN },
      });

      expect(response.status, `${method} ${path}`).toBe(401);
    }
    expect(await rows("creatine_logs")).toHaveLength(0);
  });

  it("la cookie de sesión no vale en un hook", async () => {
    const response = await exports.default.fetch(`${ORIGIN}/api/hook/steps`, {
      method: "POST",
      headers: { ...(await authed()), "Content-Type": "application/json" },
      body: JSON.stringify({ steps: 100 }),
    });

    expect(response.status).toBe(401);
    expect(await rows("daily_steps")).toHaveLength(0);
  });

  it("sin cabecera Authorization responde 401 con un cuerpo propio del hook", async () => {
    const response = await hook("creatine", null);

    expect(response.status).toBe(401);
    const body = await json(response);
    expect(body.error).toEqual(expect.any(String));
    expect(body).not.toEqual({ error: "No autenticado" });
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    expect(await rows("creatine_logs")).toHaveLength(0);
  });

  it("una clave revocada da 401", async () => {
    const key = await createKey(["creatine", "steps"]);
    await send("DELETE", `/api/hook-keys/${(await keyRow(key))?.id}`);

    const creatine = await hook("creatine", key);
    const steps = await hook("steps", key, { body: { steps: 100 } });

    expect(creatine.status).toBe(401);
    expect(steps.status).toBe(401);
    expect(await rows("creatine_logs")).toHaveLength(0);
    expect(await rows("daily_steps")).toHaveLength(0);
  });

  it.each([
    ["clave inventada con el formato correcto", () => `fk_${"A".repeat(43)}`],
    ["clave sin el prefijo fk_", () => "A".repeat(43)],
    ["clave vacía", () => ""],
  ])("%s da 401", async (_name, makeKey) => {
    await createKey(["creatine", "steps"]);

    const response = await hook("creatine", makeKey());

    expect(response.status).toBe(401);
  });

  it("el hash de la clave no sirve como clave", async () => {
    const key = await createKey(["steps"]);

    const response = await hook("steps", await sha256Hex(key), { body: { steps: 1 } });

    expect(response.status).toBe(401);
  });

  it.each([
    ["esquema Basic", (key: string) => `Basic ${key}`],
    ["sin esquema", (key: string) => key],
    ["solo el esquema", () => "Bearer"],
    ["solo el esquema y un espacio", () => "Bearer "],
    ["dos claves", (key: string) => `Bearer ${key} ${key}`],
    ["espacios de más en medio", (key: string) => `Bearer  ${key}`],
    ["clave con comillas", (key: string) => `Bearer "${key}"`],
    ["clave truncada", (key: string) => `Bearer ${key.slice(0, -1)}`],
    ["clave con un carácter de más", (key: string) => `Bearer ${key}x`],
  ])("Authorization mal formado (%s) da 401", async (_name, header) => {
    const key = await createKey(["creatine", "steps"]);

    const response = await hook("creatine", null, { headers: { Authorization: header(key) } });

    expect(response.status).toBe(401);
    expect(await rows("creatine_logs")).toHaveLength(0);
  });

  it("acepta el esquema Bearer en cualquier combinación de mayúsculas", async () => {
    const key = await createKey(["steps"]);

    const response = await hook("steps", null, {
      body: { steps: 10 },
      headers: { Authorization: `bearer ${key}` },
    });

    expect(response.status).toBe(200);
  });

  it("registra last_used_at al usar la clave, y no en una revocada", async () => {
    const key = await createKey(["steps"]);
    expect((await keyRow(key))?.last_used_at).toBeNull();

    const before = Date.now();
    await hook("steps", key, { body: { steps: 1 } });

    const usedAt = Date.parse((await keyRow(key))?.last_used_at);
    expect(usedAt).toBeGreaterThanOrEqual(before - 1000);
    expect(usedAt).toBeLessThanOrEqual(Date.now() + 1000);

    const id = (await keyRow(key))?.id;
    await env.DB.prepare("UPDATE hook_keys SET last_used_at = NULL WHERE id = ?").bind(id).run();
    await send("DELETE", `/api/hook-keys/${id}`);
    await hook("steps", key, { body: { steps: 2 } });
    expect((await keyRow(key))?.last_used_at).toBeNull();
  });

  it("last_used_at aparece en la lista de claves", async () => {
    const key = await createKey(["steps"]);
    await hook("steps", key, { body: { steps: 1 } });

    const list = await json(await send("GET", "/api/hook-keys"));

    expect(Date.parse(list[0].lastUsedAt)).not.toBeNaN();
  });
});

describe("permisos de los hooks", () => {
  it("una clave con solo steps contra /hook/creatine da 403 y no marca nada", async () => {
    const key = await createKey(["steps"]);

    const response = await hook("creatine", key);

    expect(response.status).toBe(403);
    expect(await json(response)).toEqual({ error: expect.any(String) });
    expect(await rows("creatine_logs")).toHaveLength(0);
  });

  it("una clave con solo creatine contra /hook/steps da 403 y no guarda nada", async () => {
    const key = await createKey(["creatine"]);

    const response = await hook("steps", key, { body: { steps: 5000 } });

    expect(response.status).toBe(403);
    expect(await rows("daily_steps")).toHaveLength(0);
  });

  it("una clave con ambos permisos sirve para los dos hooks", async () => {
    const key = await createKey(["creatine", "steps"]);

    expect((await hook("creatine", key)).status).toBe(200);
    expect((await hook("steps", key, { body: { steps: 5000 } })).status).toBe(200);
  });

  it("el 403 llega antes que la validación (400) y antes de consumir el límite", async () => {
    const key = await createKey(["creatine"]);

    for (let i = 0; i < 35; i++) {
      const response = await hook("steps", key, { body: { steps: 250000 } });
      expect(response.status).toBe(403);
    }
    // El límite sigue intacto: las 30 llamadas permitidas siguen disponibles.
    expect((await hook("creatine", key)).status).toBe(200);
  });

  it("el 401 llega antes que el 403 y que la validación", async () => {
    const response = await hook("steps", `fk_${"A".repeat(43)}`, { body: { steps: 250000 } });

    expect(response.status).toBe(401);
  });
});

describe("POST /api/hook/creatine", () => {
  it("marca hoy con los gramos de ajustes, origen nfc y el mensaje de la spec", async () => {
    const key = await createKey(["creatine"]);

    const response = await hook("creatine", key);

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ message: "Creatina ✓ 5 g" });
    expect(await rows("creatine_logs")).toEqual([
      { local_date: localDate(new Date(), MADRID), grams: 5, source: "nfc" },
    ]);
  });

  it("usa los gramos de ajustes aunque cambien", async () => {
    await env.DB.prepare("UPDATE settings SET creatine_grams = 3 WHERE id = 1").run();
    const key = await createKey(["creatine"]);

    const response = await hook("creatine", key);

    expect(await json(response)).toEqual({ message: "Creatina ✓ 3 g" });
    expect((await rows("creatine_logs"))[0]?.grams).toBe(3);
  });

  it("dos veces el mismo día: la segunda dice 'Ya estaba marcada' y solo hay una fila", async () => {
    const key = await createKey(["creatine"]);

    const first = await hook("creatine", key);
    const second = await hook("creatine", key);

    expect(first.status).toBe(200);
    expect(await json(first)).toEqual({ message: "Creatina ✓ 5 g" });
    expect(second.status).toBe(200);
    expect(await json(second)).toEqual({ message: "Ya estaba marcada" });
    expect(await rows("creatine_logs")).toHaveLength(1);
  });

  it("no pisa una toma ya marcada, ni siquiera con otros gramos", async () => {
    const today = localDate(new Date(), MADRID);
    await env.DB.prepare("INSERT INTO creatine_logs (local_date, grams, source) VALUES (?, 5, 'manual')")
      .bind(today)
      .run();
    const key = await createKey(["creatine"]);

    const response = await hook("creatine", key, { body: { grams: 8 } });

    expect(await json(response)).toEqual({ message: "Ya estaba marcada" });
    expect(await rows("creatine_logs")).toEqual([{ local_date: today, grams: 5, source: "manual" }]);
  });

  it("acepta los gramos del cuerpo y usa coma decimal en el mensaje", async () => {
    const key = await createKey(["creatine"]);

    const response = await hook("creatine", key, { body: { grams: 2.5 } });

    expect(await json(response)).toEqual({ message: "Creatina ✓ 2,5 g" });
    expect((await rows("creatine_logs"))[0]).toMatchObject({ grams: 2.5, source: "nfc" });
  });

  it("gramos enteros en el cuerpo, sin decimales en el mensaje", async () => {
    const key = await createKey(["creatine"]);

    const response = await hook("creatine", key, { body: { grams: 10 } });

    expect(await json(response)).toEqual({ message: "Creatina ✓ 10 g" });
  });

  it.each([
    ["sin cuerpo", undefined],
    ["cuerpo vacío con Content-Type JSON", ""],
    ["cuerpo en blanco", "  \n"],
    ["objeto vacío", {}],
  ])("%s es válido (el Atajo puede no enviar nada)", async (_name, body) => {
    const key = await createKey(["creatine"]);

    const response = await hook("creatine", key, {
      body,
      headers: body === "" || body === "  \n" ? { "Content-Type": "application/json" } : {},
    });

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ message: "Creatina ✓ 5 g" });
  });

  it.each([
    ["JSON mal formado", "{grams:"],
    ["texto que no es JSON", "cinco"],
    ["null", "null"],
    ["una lista", "[]"],
    ["gramos en texto", { grams: "5" }],
    ["gramos cero", { grams: 0 }],
    ["gramos negativos", { grams: -1 }],
    ["demasiados gramos", { grams: 101 }],
  ])("responde 400 con %s y no marca nada", async (_name, body) => {
    const key = await createKey(["creatine"]);

    const response = await hook("creatine", key, { body });

    expect(response.status).toBe(400);
    expect(await rows("creatine_logs")).toHaveLength(0);
  });

  it("el día es hoy en la zona horaria de ajustes, no en UTC", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 23:30 UTC del 9: ya es 10 en Madrid, todavía es 9 en Los Ángeles.
    vi.setSystemTime(new Date("2026-11-09T23:30:00Z"));
    const key = await createKey(["creatine"]);

    await hook("creatine", key);
    expect((await rows("creatine_logs")).map((r) => r.local_date)).toEqual(["2026-11-10"]);

    await env.DB.prepare("DELETE FROM creatine_logs").run();
    await env.DB.prepare("UPDATE settings SET timezone = 'America/Los_Angeles' WHERE id = 1").run();
    await hook("creatine", key);
    expect((await rows("creatine_logs")).map((r) => r.local_date)).toEqual(["2026-11-09"]);
  });

  it("solo atiende POST", async () => {
    const key = await createKey(["creatine"]);

    const response = await exports.default.fetch(`${ORIGIN}/api/hook/creatine`, {
      headers: { Authorization: `Bearer ${key}` },
    });

    expect(response.status).toBe(404);
    expect(await rows("creatine_logs")).toHaveLength(0);
  });
});

describe("POST /api/hook/steps", () => {
  it("guarda los pasos de hoy y responde con el mensaje de la spec", async () => {
    const key = await createKey(["steps"]);

    const response = await hook("steps", key, { body: { steps: 8432 } });

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ message: "Pasos: 8.432" });
    const stored = await rows("daily_steps");
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ local_date: localDate(new Date(), MADRID), steps: 8432 });
  });

  it.each([
    [0, "Pasos: 0"],
    [999, "Pasos: 999"],
    [1000, "Pasos: 1.000"],
    [200000, "Pasos: 200.000"],
  ])("%i pasos: «%s»", async (steps, message) => {
    const key = await createKey(["steps"]);

    const response = await hook("steps", key, { body: { steps } });

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ message });
    expect((await rows("daily_steps"))[0]?.steps).toBe(steps);
  });

  it("pasos enviados dos veces: se queda el último valor, en una sola fila", async () => {
    const key = await createKey(["steps"]);

    await hook("steps", key, { body: { steps: 4000 } });
    const second = await hook("steps", key, { body: { steps: 3000 } });

    expect(second.status).toBe(200);
    expect(await json(second)).toEqual({ message: "Pasos: 3.000" });
    const stored = await rows("daily_steps");
    expect(stored).toHaveLength(1);
    expect(stored[0]?.steps).toBe(3000);
  });

  it("actualiza updated_at al reenviar", async () => {
    const key = await createKey(["steps"]);
    await hook("steps", key, { body: { steps: 4000 } });
    await env.DB.prepare("UPDATE daily_steps SET updated_at = '2020-01-01T00:00:00.000Z'").run();

    await hook("steps", key, { body: { steps: 4100 } });

    const updatedAt = (await rows("daily_steps"))[0]?.updated_at;
    expect(Math.abs(Date.parse(updatedAt) - Date.now())).toBeLessThan(60_000);
  });

  it("usa la fecha del cuerpo si viene, sin tocar los otros días", async () => {
    const key = await createKey(["steps"]);
    await hook("steps", key, { body: { steps: 1000 } });

    const response = await hook("steps", key, { body: { steps: 7000, date: "2020-03-04" } });

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ message: "Pasos: 7.000" });
    const byDate = Object.fromEntries((await rows("daily_steps")).map((r) => [r.local_date, r.steps]));
    expect(byDate).toEqual({ "2020-03-04": 7000, [localDate(new Date(), MADRID)]: 1000 });
  });

  it("sin fecha, el día es hoy en la zona horaria de ajustes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-09T23:30:00Z"));
    await env.DB.prepare("UPDATE settings SET timezone = 'America/Los_Angeles' WHERE id = 1").run();
    const key = await createKey(["steps"]);

    await hook("steps", key, { body: { steps: 500 } });

    expect((await rows("daily_steps")).map((r) => r.local_date)).toEqual(["2026-11-09"]);
  });

  it("steps: 250000 responde 400 y no guarda nada", async () => {
    const key = await createKey(["steps"]);

    const response = await hook("steps", key, { body: { steps: 250000 } });

    expect(response.status).toBe(400);
    expect(await rows("daily_steps")).toHaveLength(0);
  });

  it("un valor inválido no pisa el último valor guardado", async () => {
    const key = await createKey(["steps"]);
    await hook("steps", key, { body: { steps: 4000 } });

    const response = await hook("steps", key, { body: { steps: 200001 } });

    expect(response.status).toBe(400);
    expect((await rows("daily_steps"))[0]?.steps).toBe(4000);
  });

  it.each([
    ["sin cuerpo", undefined],
    ["cuerpo vacío", ""],
    ["JSON mal formado", "{steps:"],
    ["objeto vacío", {}],
    ["pasos en texto", { steps: "8432" }],
    ["pasos negativos", { steps: -1 }],
    ["pasos decimales", { steps: 8432.5 }],
    ["pasos nulos", { steps: null }],
    ["fecha que no existe", { steps: 100, date: "2026-02-30" }],
    ["fecha con otro formato", { steps: 100, date: "09/11/2026" }],
    ["fecha que no es texto", { steps: 100, date: 20261109 }],
  ])("responde 400 con %s", async (_name, body) => {
    const key = await createKey(["steps"]);

    const response = await hook("steps", key, {
      body,
      headers: body === "" ? { "Content-Type": "application/json" } : {},
    });

    expect(response.status).toBe(400);
    expect(await json(response)).toEqual({ error: expect.any(String) });
    expect(await rows("daily_steps")).toHaveLength(0);
  });
});

describe("límite de peticiones por clave", () => {
  const LIMIT = 30;

  it("la petición 31 en el mismo minuto responde 429 con Retry-After", async () => {
    const key = await createKey(["steps"]);

    for (let i = 1; i <= LIMIT; i++) {
      const response = await hook("steps", key, { body: { steps: i } });
      expect(response.status, `petición ${i}`).toBe(200);
    }
    const limited = await hook("steps", key, { body: { steps: 99 } });

    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    // La petición limitada no llega a guardar nada.
    expect((await rows("daily_steps"))[0]?.steps).toBe(LIMIT);
  });

  it("el límite es de cada clave: otra clave sigue pudiendo usar el hook", async () => {
    const busy = await createKey(["steps"], "Ocupada");
    const free = await createKey(["steps"], "Libre");
    for (let i = 0; i <= LIMIT; i++) await hook("steps", busy, { body: { steps: 1 } });

    expect((await hook("steps", busy, { body: { steps: 1 } })).status).toBe(429);
    expect((await hook("steps", free, { body: { steps: 1 } })).status).toBe(200);
  });

  it("el cubo es el id de la clave y se comparte entre los dos hooks", async () => {
    const key = await createKey(["creatine", "steps"]);
    const id = (await keyRow(key))?.id;

    for (let i = 0; i < LIMIT - 1; i++) await hook("steps", key, { body: { steps: 1 } });
    expect((await hook("creatine", key)).status).toBe(200);

    expect((await hook("steps", key, { body: { steps: 1 } })).status).toBe(429);
    const buckets = await rows("rate_limits", "bucket");
    expect(buckets.map((r) => r.bucket)).toEqual([`hook:${id}`]);
  });

  it("el 429 llega antes que la validación (400)", async () => {
    const key = await createKey(["steps"]);
    for (let i = 0; i < LIMIT; i++) await hook("steps", key, { body: { steps: 1 } });

    const response = await hook("steps", key, { body: { steps: 250000 } });

    expect(response.status).toBe(429);
  });

  it("una clave revocada da 401 aunque haya agotado el límite", async () => {
    const key = await createKey(["steps"]);
    for (let i = 0; i <= LIMIT; i++) await hook("steps", key, { body: { steps: 1 } });
    await send("DELETE", `/api/hook-keys/${(await keyRow(key))?.id}`);

    const response = await hook("steps", key, { body: { steps: 1 } });

    expect(response.status).toBe(401);
  });
});
