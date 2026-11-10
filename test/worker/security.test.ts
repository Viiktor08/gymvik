import { env, exports } from "cloudflare:workers";
import { createHash } from "node:crypto";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { afterEach, describe, expect, it, vi } from "vitest";
import headersFile from "../../public/_headers?raw";
import type { Env } from "../../src/worker/env";
import { app } from "../../src/worker/index";
import { randomToken, sha256Hex } from "../../src/worker/security/crypto";
import { SECURITY_HEADERS } from "../../src/worker/security/headers";
import { rateLimit } from "../../src/worker/security/rateLimit";
import { authed } from "./helpers";

// Las rutas de prueba se añaden antes de la primera petición: Hono congela el
// router al resolver la primera ruta.
app.get("/api/__test/boom", () => {
  throw new Error("detalle interno: SELECT * FROM secretos");
});
app.get("/api/__test/teapot", () => {
  throw new HTTPException(418, { message: "Soy una tetera" });
});

const ORIGIN = "https://example.com";

function request(path: string, init: RequestInit = {}): Promise<Response> {
  return exports.default.fetch(`${ORIGIN}${path}`, init);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("securityHeaders", () => {
  it("añade a toda respuesta las cabeceras de la spec §8", async () => {
    const response = await request("/api/health");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'self'; img-src 'self' https: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("strict-transport-security")).toBe("max-age=31536000");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("same-origin");
  });

  it("también las añade a las respuestas 404, con un JSON genérico", async () => {
    // Con sesión: sin ella la puerta respondería 401 antes de llegar al 404.
    const response = await request("/api/no-existe", { headers: await authed() });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "No encontrado" });
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(response.headers.get(name)).toBe(value);
    }
  });

  it("también las añade a las respuestas 403 de requireSameOrigin", async () => {
    const response = await request("/api/settings", {
      method: "POST",
      headers: { Origin: "https://evil.example" },
    });

    expect(response.status).toBe(403);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(response.headers.get(name)).toBe(value);
    }
  });

  it("también las añade a las respuestas de error, sin filtrar detalles internos", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await app.request(`${ORIGIN}/api/__test/boom`, { headers: await authed() }, env);

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ error: "Error interno" });
    expect(text).not.toContain("SELECT");
    expect(text).not.toContain("secretos");
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(response.headers.get(name)).toBe(value);
    }
    // El detalle se queda en los registros del Worker.
    expect(log).toHaveBeenCalledOnce();
  });

  it("respeta el estado de un HTTPException en lugar de convertirlo en 500", async () => {
    const response = await app.request(`${ORIGIN}/api/__test/teapot`, { headers: await authed() }, env);

    expect(response.status).toBe(418);
    expect(await response.json()).toEqual({ error: "Soy una tetera" });
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });
});

describe("Cache-Control de /api/*", () => {
  const NO_STORE = "no-store";

  it("lo llevan las respuestas correctas, las de error y las que no pasan la puerta de sesión", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const headers = await authed();

    const responses = {
      health: await request("/api/health"),
      settings: await request("/api/settings", { headers }),
      notFound: await request("/api/no-existe", { headers }),
      unauthenticated: await request("/api/settings"),
      forbidden: await request("/api/settings", { method: "POST", headers: { Origin: "https://evil.example" } }),
      teapot: await app.request(`${ORIGIN}/api/__test/teapot`, { headers }, env),
      boom: await app.request(`${ORIGIN}/api/__test/boom`, { headers }, env),
    };

    expect(responses.health.status).toBe(200);
    expect(responses.settings.status).toBe(200);
    expect(responses.notFound.status).toBe(404);
    expect(responses.unauthenticated.status).toBe(401);
    expect(responses.forbidden.status).toBe(403);
    expect(responses.teapot.status).toBe(418);
    expect(responses.boom.status).toBe(500);
    for (const [name, response] of Object.entries(responses)) {
      expect(response.headers.get("cache-control"), name).toBe(NO_STORE);
    }
    log.mockRestore();
  });

  it("lo llevan también las rutas de auth, aunque sean públicas", async () => {
    const response = await request("/api/auth/me");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(NO_STORE);
  });

  it("no cambia lo que ya ponía una ruta: las claves de atajo siguen con no-store, una sola vez", async () => {
    const response = await request("/api/hook-keys", {
      method: "POST",
      headers: await authed({ "Content-Type": "application/json" }),
      body: JSON.stringify({ label: "Atajo", scopes: ["steps"] }),
    });

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe(NO_STORE);
  });

  it("no es una cabecera de securityHeaders() para los estáticos: public/_headers no la declara", () => {
    expect(SECURITY_HEADERS).not.toHaveProperty("Cache-Control");
  });
});

describe("public/_headers", () => {
  // run_worker_first es solo /api/*: el HTML y los estáticos no pasan por el
  // Worker, así que sus cabeceras salen de este archivo.
  function parseHeadersFile(source: string): Map<string, Record<string, string>> {
    const rules = new Map<string, Record<string, string>>();
    let current: Record<string, string> | null = null;
    for (const line of source.split("\n")) {
      if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
      if (!/^\s/.test(line)) {
        current = {};
        rules.set(line.trim(), current);
        continue;
      }
      const separator = line.indexOf(":");
      if (current === null || separator === -1) throw new Error(`Línea no válida: ${line}`);
      current[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
    }
    return rules;
  }

  it("declara para /* las mismas cabeceras que securityHeaders()", () => {
    const rules = parseHeadersFile(headersFile);

    expect([...rules.keys()]).toEqual(["/*"]);
    const expected = Object.fromEntries(
      Object.entries(SECURITY_HEADERS).map(([name, value]) => [name.toLowerCase(), value]),
    );
    expect(rules.get("/*")).toEqual(expected);
  });
});

describe("requireSameOrigin", () => {
  const evil = { Origin: "https://evil.example" };

  it("rechaza con 403 un POST a /api/settings con un Origin ajeno", async () => {
    const response = await request("/api/settings", { method: "POST", headers: evil });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Origen no permitido" });
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])("rechaza con 403 un %s con un Origin ajeno", async (method) => {
    const response = await request("/api/workouts/1", { method, headers: evil });

    expect(response.status).toBe(403);
  });

  it("rechaza con 403 un método que modifica datos sin cabecera Origin", async () => {
    const response = await request("/api/settings", { method: "POST" });

    expect(response.status).toBe(403);
  });

  it.each(["http://example.com", "https://example.com:8443", "https://api.example.com", "null"])(
    "rechaza el Origin %s, que no es exactamente el del sitio",
    async (origin) => {
      const response = await request("/api/settings", { method: "POST", headers: { Origin: origin } });

      expect(response.status).toBe(403);
    },
  );

  it("deja pasar un método que modifica datos con el Origin del propio sitio", async () => {
    // Pasa la comprobación de Origin: sin sesión se queda en el 401 de la puerta, no en el 403.
    const response = await request("/api/settings", { method: "POST", headers: { Origin: ORIGIN } });

    expect(response.status).not.toBe(403);
  });

  it("no comprueba el Origin en métodos que no modifican datos", async () => {
    const response = await request("/api/health", { headers: evil });

    expect(response.status).toBe(200);
  });

  it("exime a /api/hook/*, que se autentica con una clave Bearer", async () => {
    for (const headers of [evil, undefined]) {
      const response = await request("/api/hook/creatine", { method: "POST", headers });

      // Sin clave, el hook responde 401: llega a su propia autenticación, no se queda en el 403 del Origin.
      expect(response.status).toBe(401);
    }
  });

  it("no exime a /api/hook-keys, que no es un hook", async () => {
    const response = await request("/api/hook-keys", { method: "POST", headers: evil });

    expect(response.status).toBe(403);
  });
});

describe("rateLimit", () => {
  const LIMIT = 10;

  // Cada test usa su propio cubo para no depender del orden ni del
  // aislamiento del almacenamiento de D1.
  function buildApp(options: { limit?: number; windowSec?: number } = {}) {
    const calls = { handled: 0 };
    const limited = new Hono<{ Bindings: Env }>();
    limited.use(
      "/limited",
      rateLimit({
        bucket: (c) => `test:${c.req.header("x-bucket") ?? "default"}`,
        limit: options.limit ?? LIMIT,
        windowSec: options.windowSec ?? 60,
      }),
    );
    limited.get("/limited", (c) => {
      calls.handled += 1;
      return c.text("ok");
    });
    const hit = (bucket: string) =>
      limited.request(`${ORIGIN}/limited`, { headers: { "x-bucket": bucket } }, env);
    return { calls, hit };
  }

  async function readRow(bucket: string) {
    return env.DB.prepare("SELECT window_start, count FROM rate_limits WHERE bucket = ?")
      .bind(`test:${bucket}`)
      .first<{ window_start: number; count: number }>();
  }

  it("responde 429 a la llamada número 11 en un minuto en una ruta limitada a 10", async () => {
    const { hit } = buildApp();
    const bucket = randomToken(8);

    for (let i = 1; i <= LIMIT; i += 1) {
      expect((await hit(bucket)).status, `llamada ${i}`).toBe(200);
    }
    const blocked = await hit(bucket);

    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "Demasiadas peticiones" });
    const retryAfter = Number(blocked.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
  });

  it("no ejecuta el manejador de la ruta cuando bloquea", async () => {
    const { calls, hit } = buildApp({ limit: 2 });
    const bucket = randomToken(8);

    for (let i = 0; i < 5; i += 1) await hit(bucket);

    expect(calls.handled).toBe(2);
  });

  it("cuenta cada cubo por separado", async () => {
    const { hit } = buildApp({ limit: 1 });
    const first = randomToken(8);
    const second = randomToken(8);

    expect((await hit(first)).status).toBe(200);
    expect((await hit(first)).status).toBe(429);
    expect((await hit(second)).status).toBe(200);
  });

  it("es atómico: con peticiones simultáneas pasan exactamente `limit`", async () => {
    const { hit } = buildApp();
    const bucket = randomToken(8);

    const responses = await Promise.all(Array.from({ length: 25 }, () => hit(bucket)));
    const statuses = responses.map((response) => response.status);

    expect(statuses.filter((status) => status === 200)).toHaveLength(LIMIT);
    expect(statuses.filter((status) => status === 429)).toHaveLength(25 - LIMIT);
  });

  it("cuando el cubo ya superó su límite no vuelve a escribir en la ventana actual", async () => {
    const { hit } = buildApp({ limit: 3 });
    const bucket = randomToken(8);
    for (let i = 0; i < 3; i += 1) await hit(bucket);
    expect((await hit(bucket)).status).toBe(429);
    const before = await readRow(bucket);

    for (let i = 0; i < 5; i += 1) {
      const blocked = await hit(bucket);

      expect(blocked.status).toBe(429);
      const retryAfter = Number(blocked.headers.get("retry-after"));
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(60);
    }

    expect(await readRow(bucket)).toEqual(before);
  });

  it("un cubo que ya superó el límite en una ventana vieja vuelve a contar desde 1 en la nueva", async () => {
    const { hit } = buildApp({ limit: 2 });
    const bucket = randomToken(8);
    for (let i = 0; i < 4; i += 1) await hit(bucket);
    await env.DB.prepare("UPDATE rate_limits SET window_start = window_start - 61 WHERE bucket = ?")
      .bind(`test:${bucket}`)
      .run();

    expect((await hit(bucket)).status).toBe(200);
    expect((await hit(bucket)).status).toBe(200);
    expect((await hit(bucket)).status).toBe(429);
    expect((await readRow(bucket))?.count).toBeGreaterThanOrEqual(2);
  });

  it("empieza una ventana nueva cuando la anterior ha caducado", async () => {
    const { hit } = buildApp({ limit: 2 });
    const bucket = randomToken(8);
    await hit(bucket);
    await hit(bucket);
    expect((await hit(bucket)).status).toBe(429);

    // Envejece la ventana por encima de windowSec en lugar de esperar un minuto.
    await env.DB.prepare("UPDATE rate_limits SET window_start = window_start - 61 WHERE bucket = ?")
      .bind(`test:${bucket}`)
      .run();

    expect((await hit(bucket)).status).toBe(200);
    expect((await readRow(bucket))?.count).toBe(1);
  });

  it("borra las ventanas antiguas de otros cubos al empezar una nueva", async () => {
    const { hit } = buildApp();
    const stale = randomToken(8);
    const recent = randomToken(8);
    const now = Math.floor(Date.now() / 1000);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO rate_limits (bucket, window_start, count) VALUES (?, ?, 3)").bind(
        `test:${stale}`,
        now - 3 * 86400,
      ),
      env.DB.prepare("INSERT INTO rate_limits (bucket, window_start, count) VALUES (?, ?, 3)").bind(
        `test:${recent}`,
        now - 3600,
      ),
    ]);

    await hit(randomToken(8));

    expect(await readRow(stale)).toBeNull();
    expect((await readRow(recent))?.count).toBe(3);
  });
});

describe("sha256Hex", () => {
  it("coincide con los vectores de prueba conocidos", async () => {
    expect(await sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("codifica el texto como UTF-8", async () => {
    const text = "Contraseña de prueba: ñandú 💪";

    expect(await sha256Hex(text)).toBe(createHash("sha256").update(text, "utf8").digest("hex"));
  });
});

describe("randomToken", () => {
  it("devuelve 32 bytes en base64url sin relleno por defecto", () => {
    const token = randomToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("ajusta la longitud al número de bytes pedido", () => {
    expect(randomToken(16)).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(randomToken(1)).toMatch(/^[A-Za-z0-9_-]{2}$/);
  });

  it("no repite valores", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => randomToken()));

    expect(tokens.size).toBe(200);
  });

  it("rechaza un número de bytes no válido", () => {
    expect(() => randomToken(0)).toThrow(RangeError);
    expect(() => randomToken(-1)).toThrow(RangeError);
    expect(() => randomToken(1.5)).toThrow(RangeError);
  });
});
