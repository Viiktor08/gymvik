import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { AuthenticationVerifier, RegistrationVerifier } from "../../src/worker/auth/passkeys";
import { SESSION_COOKIE, createSession } from "../../src/worker/auth/session";
import { createApp } from "../../src/worker/index";
import { randomToken, sha256Hex } from "../../src/worker/security/crypto";
import { ORIGIN, authed } from "./helpers";

// Aquí la verificación WebAuthn está sustituida por un stub que imita lo que
// hace la librería con el reto: lee el `challenge` del clientDataJSON y se lo
// pasa a `expectedChallenge`. La criptografía real se prueba en auth-webauthn.test.ts.

const SETUP_OPTIONS = "/api/auth/setup/options";
const SETUP_VERIFY = "/api/auth/setup/verify";
const LOGIN_OPTIONS = "/api/auth/login/options";
const LOGIN_VERIFY = "/api/auth/login/verify";
const RECOVER = "/api/auth/recover";
const PASSKEYS = "/api/auth/passkeys";
const PASSKEY_OPTIONS = "/api/auth/passkeys/options";
const PASSKEY_VERIFY = "/api/auth/passkeys/verify";
const RECOVERY_CODES = "/api/auth/recovery-codes";
const LOGOUT = "/api/auth/logout";
const ME = "/api/auth/me";

// Alfabeto de Crockford en minúsculas (sin i, l, o, u).
const CODE_PATTERN = /^[0-9a-hjkmnp-tv-z]{4}(-[0-9a-hjkmnp-tv-z]{4}){3}$/;
const UNKNOWN_CODE = "zzzz-zzzz-zzzz-zzzz";
const THIRTY_DAYS_SEC = 30 * 24 * 60 * 60;

type TestApp = ReturnType<typeof createApp>;
type Json = Record<string, any>;

function base64url(text: string): string {
  return btoa(text).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function challengeOf(clientDataJSON: string): string {
  const padded = clientDataJSON.replaceAll("-", "+").replaceAll("_", "/");
  return JSON.parse(atob(padded)).challenge;
}

function fakeRegistration(challenge: string, id: string = randomToken(16)) {
  return {
    id,
    rawId: id,
    type: "public-key",
    clientExtensionResults: {},
    response: {
      clientDataJSON: base64url(JSON.stringify({ type: "webauthn.create", challenge, origin: ORIGIN })),
      attestationObject: "AAAA",
      transports: ["internal"],
    },
  };
}

function fakeAssertion(challenge: string, id: string) {
  return {
    id,
    rawId: id,
    type: "public-key",
    clientExtensionResults: {},
    response: {
      clientDataJSON: base64url(JSON.stringify({ type: "webauthn.get", challenge, origin: ORIGIN })),
      authenticatorData: "AAAA",
      signature: "AAAA",
    },
  };
}

// Cada llamada usa un cubo de límite propio, para no depender del orden ni del
// aislamiento de D1 entre tests.
function randomIp(): string {
  return `ip-${randomToken(8)}`;
}

function buildApp() {
  const calls = {
    registration: [] as Parameters<RegistrationVerifier>[0][],
    authentication: [] as Parameters<AuthenticationVerifier>[0][],
  };
  const behavior = { rejectSignature: false, nextCounter: 7 };

  const verifyRegistration: RegistrationVerifier = async (input) => {
    calls.registration.push(input);
    if (!(await input.expectedChallenge(challengeOf(input.response.response.clientDataJSON)))) return null;
    if (behavior.rejectSignature) return null;
    return {
      credentialId: input.response.id,
      publicKey: new Uint8Array([1, 2, 3, 4]),
      counter: 0,
      transports: input.response.response.transports ?? [],
    };
  };
  const verifyAuthentication: AuthenticationVerifier = async (input) => {
    calls.authentication.push(input);
    if (!(await input.expectedChallenge(challengeOf(input.response.response.clientDataJSON)))) return null;
    if (behavior.rejectSignature) return null;
    return { newCounter: behavior.nextCounter };
  };

  return { app: createApp({ verifyRegistration, verifyAuthentication }), calls, behavior };
}

type SendOptions = { headers?: Record<string, string>; body?: unknown; ip?: string; bindings?: typeof env };

async function send(app: TestApp, method: string, path: string, options: SendOptions = {}): Promise<Response> {
  const { headers = {}, body, ip = randomIp(), bindings = env } = options;
  const hasBody = body !== undefined;
  return app.request(
    `${ORIGIN}${path}`,
    {
      method,
      headers: {
        Origin: ORIGIN,
        "CF-Connecting-IP": ip,
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      // Un string se envía tal cual, para poder probar JSON mal formado.
      body: !hasBody ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    },
    bindings,
  );
}

async function rowCount(table: "passkeys" | "sessions" | "auth_challenges" | "recovery_codes"): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
  return row?.n ?? 0;
}

async function insertPasskey(id: string = randomToken(16), label = ""): Promise<string> {
  await env.DB.prepare(
    "INSERT INTO passkeys (credential_id, public_key, counter, transports, label) VALUES (?, ?, 0, '[]', ?)",
  )
    .bind(id, "AQIDBA", label)
    .run();
  return id;
}

async function insertChallenge(purpose: string, minutesFromNow = 5): Promise<string> {
  const challenge = randomToken(32);
  await env.DB.prepare("INSERT INTO auth_challenges (challenge, purpose, expires_at) VALUES (?, ?, ?)")
    .bind(challenge, purpose, new Date(Date.now() + minutesFromNow * 60_000).toISOString())
    .run();
  return challenge;
}

function sessionTokenFrom(response: Response): string {
  const cookies = response.headers.getSetCookie().filter((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`));
  expect(cookies).toHaveLength(1);
  const token = /^[^=]+=([^;]*)/.exec(cookies[0] ?? "")?.[1];
  expect(token).toBeTruthy();
  return token as string;
}

function cookieHeader(token: string): Record<string, string> {
  return { Cookie: `${SESSION_COOKIE}=${token}` };
}

async function setupChallenge(app: TestApp): Promise<string> {
  const response = await send(app, "POST", SETUP_OPTIONS, { headers: { "X-Setup-Token": env.SETUP_TOKEN } });
  expect(response.status).toBe(200);
  return ((await response.json()) as Json).challenge;
}

async function loginChallenge(app: TestApp): Promise<string> {
  const response = await send(app, "POST", LOGIN_OPTIONS);
  expect(response.status).toBe(200);
  return ((await response.json()) as Json).challenge;
}

/** Hace el primer acceso completo y devuelve la respuesta de setup/verify. */
async function completeSetup(app: TestApp, id?: string): Promise<{ response: Response; body: Json }> {
  const challenge = await setupChallenge(app);
  const response = await send(app, "POST", SETUP_VERIFY, { body: { response: fakeRegistration(challenge, id) } });
  return { response, body: (await response.json()) as Json };
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM passkeys"),
    env.DB.prepare("DELETE FROM sessions"),
    env.DB.prepare("DELETE FROM auth_challenges"),
    env.DB.prepare("DELETE FROM recovery_codes"),
  ]);
});

describe("GET /api/auth/me", () => {
  it("sin passkeys indica que falta la configuración inicial", async () => {
    const { app } = buildApp();

    const response = await send(app, "GET", ME);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ authenticated: false, setupRequired: true });
  });

  it("con passkeys y sin cookie no hay sesión ni configuración pendiente", async () => {
    const { app } = buildApp();
    await insertPasskey();

    const response = await send(app, "GET", ME);

    expect(await response.json()).toEqual({ authenticated: false, setupRequired: false });
  });

  it("con una sesión válida indica authenticated: true y renueva la cookie", async () => {
    const { app } = buildApp();
    await insertPasskey();
    const token = await createSession(env.DB);

    const response = await send(app, "GET", ME, { headers: cookieHeader(token) });

    expect(await response.json()).toEqual({ authenticated: true, setupRequired: false });
    expect(sessionTokenFrom(response)).toBe(token);
  });

  it("con una cookie desconocida o caducada indica authenticated: false y no pone cookie", async () => {
    const { app } = buildApp();
    const expired = await createSession(env.DB);
    await env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ?")
      .bind(new Date(Date.now() - 1000).toISOString(), await sha256Hex(expired))
      .run();

    for (const token of ["no-existe", expired]) {
      const response = await send(app, "GET", ME, { headers: cookieHeader(token) });

      expect(((await response.json()) as Json).authenticated).toBe(false);
      expect(response.headers.getSetCookie()).toEqual([]);
    }
  });
});

describe("setup/options", () => {
  it("rechaza con 403 un token incorrecto o ausente", async () => {
    const { app } = buildApp();

    for (const headers of [{ "X-Setup-Token": "token-incorrecto" }, { "X-Setup-Token": "" }, {} as Record<string, string>]) {
      const response = await send(app, "POST", SETUP_OPTIONS, { headers });

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Token de configuración no válido" });
    }
    expect(await rowCount("auth_challenges")).toBe(0);
  });

  it("nunca acepta un token cuando SETUP_TOKEN está vacío, ni siquiera una cabecera vacía", async () => {
    const { app } = buildApp();
    const bindings = { ...env, SETUP_TOKEN: "" };

    for (const headers of [{ "X-Setup-Token": "" }, { "X-Setup-Token": "cualquiera" }]) {
      const response = await send(app, "POST", SETUP_OPTIONS, { headers, bindings });

      expect(response.status).toBe(403);
    }
    expect(await rowCount("auth_challenges")).toBe(0);
  });

  it("rechaza con 403, aunque el token sea correcto, si ya hay passkeys", async () => {
    const { app } = buildApp();
    await insertPasskey();

    const response = await send(app, "POST", SETUP_OPTIONS, { headers: { "X-Setup-Token": env.SETUP_TOKEN } });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "La configuración inicial ya está hecha" });
    expect(await rowCount("auth_challenges")).toBe(0);
  });

  it("con el token correcto devuelve las opciones y guarda un reto de 5 minutos", async () => {
    const { app } = buildApp();

    const response = await send(app, "POST", SETUP_OPTIONS, { headers: { "X-Setup-Token": env.SETUP_TOKEN } });

    expect(response.status).toBe(200);
    const options = (await response.json()) as Json;
    expect(options.rp).toEqual({ name: "Gymvik", id: "example.com" });
    expect(options.authenticatorSelection).toMatchObject({
      residentKey: "required",
      userVerification: "required",
    });
    expect(options.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const row = await env.DB.prepare("SELECT challenge, purpose, expires_at FROM auth_challenges").first<Json>();
    expect(row).toMatchObject({ challenge: options.challenge, purpose: "setup" });
    const ttlMs = Date.parse(row?.expires_at) - Date.now();
    expect(ttlMs).toBeGreaterThan(4 * 60_000);
    expect(ttlMs).toBeLessThanOrEqual(5 * 60_000);
  });

  it("borra los retos caducados al crear uno nuevo", async () => {
    const { app } = buildApp();
    const stale = await insertChallenge("login", -10);

    await setupChallenge(app);

    const row = await env.DB.prepare("SELECT 1 AS found FROM auth_challenges WHERE challenge = ?")
      .bind(stale)
      .first();
    expect(row).toBeNull();
  });
});

describe("setup/verify", () => {
  it("registra la primera passkey, devuelve 8 códigos y abre la sesión", async () => {
    const { app, calls } = buildApp();

    const { response, body } = await completeSetup(app, "primera-passkey");

    expect(response.status).toBe(200);
    expect(body.recoveryCodes).toHaveLength(8);
    for (const code of body.recoveryCodes) expect(code).toMatch(CODE_PATTERN);
    expect(new Set(body.recoveryCodes).size).toBe(8);
    // La librería recibe el hostname como rpID y el origen del propio sitio.
    expect(calls.registration).toHaveLength(1);
    expect(calls.registration[0]).toMatchObject({ expectedRPID: "example.com", expectedOrigin: ORIGIN });
    const passkey = await env.DB.prepare("SELECT credential_id, public_key, counter, transports FROM passkeys").first<Json>();
    expect(passkey).toEqual({
      credential_id: "primera-passkey",
      public_key: "AQIDBA",
      counter: 0,
      transports: '["internal"]',
    });
    // La sesión recién creada ya sirve.
    const token = sessionTokenFrom(response);
    const list = await send(app, "GET", PASSKEYS, { headers: cookieHeader(token) });
    expect(list.status).toBe(200);
  });

  it("pone la cookie de sesión con todos sus atributos de seguridad", async () => {
    const { app } = buildApp();

    const { response } = await completeSetup(app);

    const cookie = response.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`)) ?? "";
    expect(cookie).toMatch(new RegExp(`^__Host-session=[A-Za-z0-9_-]{43};`));
    expect(cookie).toContain(`Max-Age=${THIRTY_DAYS_SEC}`);
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).not.toContain("Domain");
  });

  it("guarda la sesión y los códigos como hash SHA-256, nunca en claro", async () => {
    const { app } = buildApp();

    const { response, body } = await completeSetup(app);

    const token = sessionTokenFrom(response);
    const session = await env.DB.prepare("SELECT token_hash FROM sessions").first<Json>();
    expect(session?.token_hash).toBe(await sha256Hex(token));
    const rows = await env.DB.prepare("SELECT code_hash, used_at FROM recovery_codes").all<Json>();
    expect(rows.results).toHaveLength(8);
    const expected = await Promise.all(body.recoveryCodes.map((code: string) => sha256Hex(code)));
    expect(rows.results.map((row) => row.code_hash).sort()).toEqual([...expected].sort());
    expect(rows.results.every((row) => row.used_at === null)).toBe(true);
  });

  it("guarda la etiqueta de la passkey si se envía", async () => {
    const { app } = buildApp();
    const challenge = await setupChallenge(app);

    await send(app, "POST", SETUP_VERIFY, {
      body: { response: fakeRegistration(challenge, "con-etiqueta"), label: "  iPhone de Victor " },
    });

    const row = await env.DB.prepare("SELECT label FROM passkeys").first<Json>();
    expect(row?.label).toBe("iPhone de Victor");
  });

  it("rechaza con 403 si ya hay passkeys, aunque haya un reto de setup vigente", async () => {
    const { app } = buildApp();
    const challenge = await setupChallenge(app);
    await insertPasskey();

    const response = await send(app, "POST", SETUP_VERIFY, { body: { response: fakeRegistration(challenge) } });

    expect(response.status).toBe(403);
    expect(await rowCount("passkeys")).toBe(1);
    expect(await rowCount("recovery_codes")).toBe(0);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("rechaza con 400 si no hay un reto de setup, sin registrar nada", async () => {
    const { app } = buildApp();

    const response = await send(app, "POST", SETUP_VERIFY, { body: { response: fakeRegistration(randomToken(32)) } });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "No se pudo registrar la passkey" });
    expect(await rowCount("passkeys")).toBe(0);
    expect(await rowCount("sessions")).toBe(0);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("rechaza con 400 si la verificación de la passkey falla, sin crear nada", async () => {
    const { app, behavior } = buildApp();
    const challenge = await setupChallenge(app);
    behavior.rejectSignature = true;

    const response = await send(app, "POST", SETUP_VERIFY, { body: { response: fakeRegistration(challenge) } });

    expect(response.status).toBe(400);
    expect(await rowCount("passkeys")).toBe(0);
    expect(await rowCount("recovery_codes")).toBe(0);
    expect(await rowCount("sessions")).toBe(0);
  });

  it("tras registrar la passkey, repetir la misma respuesta da 403", async () => {
    const { app } = buildApp();
    const challenge = await setupChallenge(app);
    const body = { response: fakeRegistration(challenge, "una-sola-vez") };

    const first = await send(app, "POST", SETUP_VERIFY, { body });
    const second = await send(app, "POST", SETUP_VERIFY, { body });

    expect(first.status).toBe(200);
    expect(second.status).toBe(403);
    expect(await rowCount("passkeys")).toBe(1);
    expect(await rowCount("sessions")).toBe(1);
  });

  it("un reto se consume aunque la verificación falle: no se puede reintentar con él", async () => {
    const { app, behavior } = buildApp();
    const challenge = await setupChallenge(app);
    const body = { response: fakeRegistration(challenge, "reintento") };
    behavior.rejectSignature = true;
    const failed = await send(app, "POST", SETUP_VERIFY, { body });
    behavior.rejectSignature = false;

    const retry = await send(app, "POST", SETUP_VERIFY, { body });

    expect(failed.status).toBe(400);
    expect(retry.status).toBe(400);
    expect(await rowCount("passkeys")).toBe(0);
  });

  it("rechaza con 400 un reto caducado", async () => {
    const { app } = buildApp();
    const challenge = await setupChallenge(app);
    await env.DB.prepare("UPDATE auth_challenges SET expires_at = ? WHERE challenge = ?")
      .bind(new Date(Date.now() - 1000).toISOString(), challenge)
      .run();

    const response = await send(app, "POST", SETUP_VERIFY, { body: { response: fakeRegistration(challenge) } });

    expect(response.status).toBe(400);
    expect(await rowCount("passkeys")).toBe(0);
  });

  it.each(["login", "register"])("rechaza con 400 un reto de propósito %s", async (purpose) => {
    const { app } = buildApp();
    const challenge = await insertChallenge(purpose);

    const response = await send(app, "POST", SETUP_VERIFY, { body: { response: fakeRegistration(challenge) } });

    expect(response.status).toBe(400);
    expect(await rowCount("passkeys")).toBe(0);
  });

  it("con dos configuraciones simultáneas solo gana una y deja un único juego de códigos", async () => {
    const { app } = buildApp();
    const [first, second] = [await setupChallenge(app), await setupChallenge(app)];

    const responses = await Promise.all([
      send(app, "POST", SETUP_VERIFY, { body: { response: fakeRegistration(first, "ganadora-a") } }),
      send(app, "POST", SETUP_VERIFY, { body: { response: fakeRegistration(second, "ganadora-b") } }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 403]);
    expect(await rowCount("passkeys")).toBe(1);
    expect(await rowCount("recovery_codes")).toBe(8);
    expect(await rowCount("sessions")).toBe(1);
  });

  it("responde 400 a un cuerpo que no es JSON o no tiene la forma esperada", async () => {
    const { app } = buildApp();
    await setupChallenge(app);

    for (const body of ["{", "", "null", {}, { response: {} }, { response: { id: "x" } }]) {
      const response = await send(app, "POST", SETUP_VERIFY, { body });

      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    expect(await rowCount("passkeys")).toBe(0);
  });
});

describe("login", () => {
  it("login/options pide verificación de usuario y no limita las credenciales (passkey sin usuario)", async () => {
    const { app } = buildApp();

    const response = await send(app, "POST", LOGIN_OPTIONS);

    expect(response.status).toBe(200);
    const options = (await response.json()) as Json;
    expect(options.rpId).toBe("example.com");
    expect(options.userVerification).toBe("required");
    expect(options.allowCredentials ?? []).toEqual([]);
    const row = await env.DB.prepare("SELECT purpose FROM auth_challenges WHERE challenge = ?")
      .bind(options.challenge)
      .first<Json>();
    expect(row?.purpose).toBe("login");
  });

  it("login/verify abre la sesión, actualiza el contador y consume el reto", async () => {
    const { app, calls, behavior } = buildApp();
    await insertPasskey("mi-passkey");
    behavior.nextCounter = 42;
    const challenge = await loginChallenge(app);

    const response = await send(app, "POST", LOGIN_VERIFY, { body: { response: fakeAssertion(challenge, "mi-passkey") } });

    expect(response.status).toBe(200);
    const token = sessionTokenFrom(response);
    expect((await send(app, "GET", PASSKEYS, { headers: cookieHeader(token) })).status).toBe(200);
    const row = await env.DB.prepare("SELECT counter FROM passkeys WHERE credential_id = 'mi-passkey'").first<Json>();
    expect(row?.counter).toBe(42);
    expect(calls.authentication[0]).toMatchObject({ expectedRPID: "example.com", expectedOrigin: ORIGIN });
    expect(calls.authentication[0]?.passkey).toMatchObject({ credentialId: "mi-passkey", counter: 0 });
    expect(await rowCount("auth_challenges")).toBe(0);
  });

  it("login/verify da 401 con una passkey desconocida, sin sesión", async () => {
    const { app } = buildApp();
    await insertPasskey("conocida");
    const challenge = await loginChallenge(app);

    const response = await send(app, "POST", LOGIN_VERIFY, { body: { response: fakeAssertion(challenge, "desconocida") } });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "No se pudo iniciar sesión" });
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await rowCount("sessions")).toBe(0);
  });

  it("login/verify da 401 si la verificación falla y no toca el contador", async () => {
    const { app, behavior } = buildApp();
    await insertPasskey("mi-passkey");
    const challenge = await loginChallenge(app);
    behavior.rejectSignature = true;

    const response = await send(app, "POST", LOGIN_VERIFY, { body: { response: fakeAssertion(challenge, "mi-passkey") } });

    expect(response.status).toBe(401);
    expect(response.headers.getSetCookie()).toEqual([]);
    const row = await env.DB.prepare("SELECT counter FROM passkeys").first<Json>();
    expect(row?.counter).toBe(0);
  });

  it("login/verify no deja reutilizar el reto", async () => {
    const { app } = buildApp();
    await insertPasskey("mi-passkey");
    const challenge = await loginChallenge(app);
    const body = { response: fakeAssertion(challenge, "mi-passkey") };

    const first = await send(app, "POST", LOGIN_VERIFY, { body });
    const second = await send(app, "POST", LOGIN_VERIFY, { body });

    expect(first.status).toBe(200);
    expect(second.status).toBe(401);
    expect(await rowCount("sessions")).toBe(1);
  });

  it("login/verify da 401 con un reto caducado", async () => {
    const { app } = buildApp();
    await insertPasskey("mi-passkey");
    const challenge = await loginChallenge(app);
    await env.DB.prepare("UPDATE auth_challenges SET expires_at = ?")
      .bind(new Date(Date.now() - 1000).toISOString())
      .run();

    const response = await send(app, "POST", LOGIN_VERIFY, { body: { response: fakeAssertion(challenge, "mi-passkey") } });

    expect(response.status).toBe(401);
  });

  it.each(["setup", "register"])("login/verify da 401 con un reto de propósito %s", async (purpose) => {
    const { app } = buildApp();
    await insertPasskey("mi-passkey");
    const challenge = await insertChallenge(purpose);

    const response = await send(app, "POST", LOGIN_VERIFY, { body: { response: fakeAssertion(challenge, "mi-passkey") } });

    expect(response.status).toBe(401);
    expect(await rowCount("sessions")).toBe(0);
  });

  it("login/verify responde 400 a un cuerpo no válido", async () => {
    const { app } = buildApp();

    for (const body of ["{", {}, { response: { id: "x" } }]) {
      const response = await send(app, "POST", LOGIN_VERIFY, { body });

      expect(response.status, JSON.stringify(body)).toBe(400);
    }
  });
});

describe("recuperación con código", () => {
  async function codesAfterSetup(app: TestApp): Promise<string[]> {
    const { body } = await completeSetup(app);
    return body.recoveryCodes;
  }

  it("el código funciona la primera vez (sesión y mustRegisterPasskey) y queda marcado como usado", async () => {
    const { app } = buildApp();
    const [code] = await codesAfterSetup(app);

    const response = await send(app, "POST", RECOVER, { body: { code } });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ mustRegisterPasskey: true });
    const token = sessionTokenFrom(response);
    expect((await send(app, "GET", PASSKEYS, { headers: cookieHeader(token) })).status).toBe(200);
    const row = await env.DB.prepare("SELECT used_at FROM recovery_codes WHERE code_hash = ?")
      .bind(await sha256Hex(code as string))
      .first<Json>();
    expect(row?.used_at).toBeTruthy();
  });

  it("la segunda vez devuelve 401, igual que un código que nunca existió", async () => {
    const { app } = buildApp();
    const [code] = await codesAfterSetup(app);
    await send(app, "POST", RECOVER, { body: { code } });

    const reused = await send(app, "POST", RECOVER, { body: { code } });
    const unknown = await send(app, "POST", RECOVER, { body: { code: UNKNOWN_CODE } });

    expect(reused.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await reused.json()).toEqual(await unknown.json());
    expect(reused.headers.getSetCookie()).toEqual([]);
  });

  it("con peticiones simultáneas con el mismo código solo una tiene éxito", async () => {
    const { app } = buildApp();
    const [code] = await codesAfterSetup(app);

    const responses = await Promise.all(
      Array.from({ length: 5 }, () => send(app, "POST", RECOVER, { body: { code } })),
    );

    expect(responses.map((response) => response.status).sort()).toEqual([200, 401, 401, 401, 401]);
    // Solo queda la sesión del que ganó: ni la del primer acceso ni las de los perdedores.
    const winner = responses.find((response) => response.status === 200) as Response;
    expect(await rowCount("sessions")).toBe(1);
    expect((await send(app, "GET", PASSKEYS, { headers: cookieHeader(sessionTokenFrom(winner)) })).status).toBe(200);
  });

  it("recuperar la cuenta cierra todas las sesiones anteriores y deja solo la nueva", async () => {
    const { app } = buildApp();
    const { response: setup, body } = await completeSetup(app);
    const lost = sessionTokenFrom(setup);
    const other = await createSession(env.DB);
    const [code] = body.recoveryCodes as string[];

    const response = await send(app, "POST", RECOVER, { body: { code } });

    expect(response.status).toBe(200);
    const fresh = sessionTokenFrom(response);
    expect(await rowCount("sessions")).toBe(1);
    for (const token of [lost, other]) {
      expect((await send(app, "GET", PASSKEYS, { headers: cookieHeader(token) })).status, token).toBe(401);
    }
    expect((await send(app, "GET", PASSKEYS, { headers: cookieHeader(fresh) })).status).toBe(200);
  });

  it("un código inválido o ya usado no cierra ninguna sesión", async () => {
    const { app } = buildApp();
    const { response: setup, body } = await completeSetup(app);
    const existing = sessionTokenFrom(setup);
    const [code] = body.recoveryCodes as string[];
    const recovered = await send(app, "POST", RECOVER, { body: { code } });
    const current = sessionTokenFrom(recovered);
    const bystander = await createSession(env.DB);

    for (const attempt of [UNKNOWN_CODE, code as string, "no es un código"]) {
      const rejected = await send(app, "POST", RECOVER, { body: { code: attempt } });

      expect(rejected.status, attempt).toBe(401);
      expect(rejected.headers.getSetCookie()).toEqual([]);
    }
    expect(existing).not.toBe(current);
    expect(await rowCount("sessions")).toBe(2);
    for (const token of [current, bystander]) {
      expect((await send(app, "GET", PASSKEYS, { headers: cookieHeader(token) })).status, token).toBe(200);
    }
  });

  it("acepta el código escrito en mayúsculas, con espacios o sin guion", async () => {
    const { app } = buildApp();
    const codes = await codesAfterSetup(app);
    const variants = [
      (codes[0] as string).toUpperCase(),
      ` ${codes[1]} `,
      (codes[2] as string).replaceAll("-", ""),
      (codes[3] as string).replaceAll("-", " "),
    ];

    for (const code of variants) {
      const response = await send(app, "POST", RECOVER, { body: { code } });

      expect(response.status, code).toBe(200);
    }
  });

  it("responde 400 a un cuerpo no válido y 401 a un código con formato raro", async () => {
    const { app } = buildApp();

    for (const body of ["{", "", {}, { code: 12 }, { code: "" }]) {
      const response = await send(app, "POST", RECOVER, { body });

      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    for (const code of ["a", "no es un código", "x".repeat(60)]) {
      const response = await send(app, "POST", RECOVER, { body: { code } });

      expect(response.status, code).toBe(401);
    }
  });

  it("regenerar los códigos invalida los anteriores, usados o no", async () => {
    const { app } = buildApp();
    const { body } = await completeSetup(app);
    const [used, unused] = body.recoveryCodes as string[];
    // Recuperar cierra la sesión del primer acceso: se sigue con la nueva.
    const token = sessionTokenFrom(await send(app, "POST", RECOVER, { body: { code: used } }));

    const regenerated = await send(app, "POST", RECOVERY_CODES, { headers: cookieHeader(token) });

    expect(regenerated.status).toBe(200);
    const fresh = ((await regenerated.json()) as Json).recoveryCodes as string[];
    expect(fresh).toHaveLength(8);
    for (const code of fresh) expect(code).toMatch(CODE_PATTERN);
    expect(await rowCount("recovery_codes")).toBe(8);
    for (const old of [used, unused]) {
      expect((await send(app, "POST", RECOVER, { body: { code: old } })).status).toBe(401);
    }
    expect((await send(app, "POST", RECOVER, { body: { code: fresh[0] } })).status).toBe(200);
  });

  it("regenerar los códigos exige sesión", async () => {
    const { app } = buildApp();
    await codesAfterSetup(app);

    const response = await send(app, "POST", RECOVERY_CODES);

    expect(response.status).toBe(401);
    expect(await rowCount("recovery_codes")).toBe(8);
  });
});

describe("sesión", () => {
  async function api(path: string, init: RequestInit = {}): Promise<Response> {
    return exports.default.fetch(`${ORIGIN}${path}`, init);
  }

  it("una cookie caducada da 401 en /api/settings (app real)", async () => {
    const token = await createSession(env.DB);
    await env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ?")
      .bind(new Date(Date.now() - 1000).toISOString(), await sha256Hex(token))
      .run();

    const response = await api("/api/settings", { headers: cookieHeader(token) });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "No autenticado" });
  });

  it("una sesión válida pasa la puerta de /api/settings (app real)", async () => {
    const response = await api("/api/settings", { headers: await authed() });

    expect(response.status).not.toBe(401);
  });

  it.each([["sin cookie", {}], ["con una cookie inventada", { Cookie: `${SESSION_COOKIE}=inventada` }]])(
    "%s da 401",
    async (_name, headers) => {
      const response = await api("/api/settings", { headers });

      expect(response.status).toBe(401);
    },
  );

  it("solo vale la cookie con el nombre __Host-session", async () => {
    const token = await createSession(env.DB);

    const response = await api("/api/settings", { headers: { Cookie: `session=${token}` } });

    expect(response.status).toBe(401);
  });

  it("protege también las rutas que todavía no existen y los prefijos parecidos a un hook", async () => {
    for (const path of ["/api/no-existe", "/api/hook-keys", "/api/hooks/creatine", "/api/auth/passkeys"]) {
      const response = await api(path);

      expect(response.status, path).toBe(401);
    }
  });

  it("deja pasar sin sesión solo /api/health, /api/hook/* y las rutas públicas de auth", async () => {
    expect((await api("/api/health")).status).toBe(200);
    expect((await api("/api/auth/me")).status).toBe(200);
    // Los hooks se autentican con su propia clave Bearer, no con la cookie: sin clave responden con su 401, que
    // no es el de la puerta de sesión.
    const hook = await api("/api/hook/creatine", { method: "POST" });
    expect(hook.status).toBe(401);
    expect(await hook.json()).not.toEqual({ error: "No autenticado" });
    // Un método sin ruta de hook llega al 404 de siempre, no a la puerta de sesión.
    const getHook = await api("/api/hook/steps", { headers: { Origin: ORIGIN } });
    expect(getHook.status).toBe(404);
    expect(await getHook.json()).not.toEqual({ error: "No autenticado" });
    // Cada ruta pública lo es solo con su método.
    expect((await api("/api/health", { method: "DELETE", headers: { Origin: ORIGIN } })).status).toBe(401);
    expect((await api(RECOVER)).status).toBe(401);
  });

  it("renueva last_seen_at y expires_at (+30 días) y vuelve a enviar la cookie", async () => {
    const token = await createSession(env.DB);
    const hash = await sha256Hex(token);
    const old = new Date(Date.now() - 20 * 86_400_000).toISOString();
    await env.DB.prepare("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?")
      .bind(old, new Date(Date.now() + 10 * 86_400_000).toISOString(), hash)
      .run();

    const response = await api(PASSKEYS, { headers: cookieHeader(token) });

    expect(response.status).toBe(200);
    const row = await env.DB.prepare("SELECT last_seen_at, expires_at FROM sessions WHERE token_hash = ?")
      .bind(hash)
      .first<Json>();
    expect(Math.abs(Date.parse(row?.last_seen_at) - Date.now())).toBeLessThan(60_000);
    expect(Math.abs(Date.parse(row?.expires_at) - (Date.now() + THIRTY_DAYS_SEC * 1000))).toBeLessThan(60_000);
    expect(sessionTokenFrom(response)).toBe(token);
    const cookie = response.headers.getSetCookie()[0] ?? "";
    expect(cookie).toContain(`Max-Age=${THIRTY_DAYS_SEC}`);
  });

  it("createSession devuelve el token en claro y guarda solo su hash, con caducidad a 30 días", async () => {
    const token = await createSession(env.DB);

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const rows = await env.DB.prepare("SELECT token_hash, expires_at FROM sessions").all<Json>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]?.token_hash).toBe(await sha256Hex(token));
    expect(JSON.stringify(rows.results)).not.toContain(token);
    expect(Math.abs(Date.parse(rows.results[0]?.expires_at) - (Date.now() + THIRTY_DAYS_SEC * 1000))).toBeLessThan(60_000);
  });

  it("createSession borra de paso las sesiones caducadas", async () => {
    const stale = await createSession(env.DB);
    await env.DB.prepare("UPDATE sessions SET expires_at = ?")
      .bind(new Date(Date.now() - 1000).toISOString())
      .run();

    await createSession(env.DB);

    const row = await env.DB.prepare("SELECT 1 AS found FROM sessions WHERE token_hash = ?")
      .bind(await sha256Hex(stale))
      .first();
    expect(row).toBeNull();
    expect(await rowCount("sessions")).toBe(1);
  });

  it("logout invalida la sesión, la borra y expira la cookie", async () => {
    const token = await createSession(env.DB);

    const response = await api(LOGOUT, { method: "POST", headers: await authedWith(token) });

    expect(response.status).toBe(200);
    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatch(new RegExp(`^${SESSION_COOKIE}=;`));
    expect(cookies[0]).toContain("Max-Age=0");
    expect(cookies[0]).toContain("Path=/");
    expect(cookies[0]).toContain("Secure");
    expect(await rowCount("sessions")).toBe(0);
    const after = await api(PASSKEYS, { headers: cookieHeader(token) });
    expect(after.status).toBe(401);
  });

  it("logout exige sesión y el Origin del propio sitio", async () => {
    const token = await createSession(env.DB);

    expect((await api(LOGOUT, { method: "POST", headers: { Origin: ORIGIN } })).status).toBe(401);
    expect((await api(LOGOUT, { method: "POST", headers: cookieHeader(token) })).status).toBe(403);
    expect(await rowCount("sessions")).toBe(1);
  });

  function authedWith(token: string): Record<string, string> {
    return { ...cookieHeader(token), Origin: ORIGIN };
  }
});

describe("gestión de passkeys", () => {
  it("GET /passkeys lista las passkeys sin exponer la clave pública ni el contador", async () => {
    const { app } = buildApp();
    await insertPasskey("una", "iPhone");
    await insertPasskey("otra", "iPad");

    const response = await send(app, "GET", PASSKEYS, { headers: await authed() });

    expect(response.status).toBe(200);
    const { passkeys } = (await response.json()) as { passkeys: Json[] };
    expect(passkeys.map((p) => p.id).sort()).toEqual(["otra", "una"]);
    expect(passkeys.find((p) => p.id === "una")).toEqual({
      id: "una",
      label: "iPhone",
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      transports: [],
    });
  });

  it("DELETE /passkeys/:id borra una passkey si quedan otras", async () => {
    const { app } = buildApp();
    await insertPasskey("una");
    await insertPasskey("otra");

    const response = await send(app, "DELETE", `${PASSKEYS}/una`, { headers: await authed() });

    expect(response.status).toBe(200);
    expect(await rowCount("passkeys")).toBe(1);
    const left = await env.DB.prepare("SELECT credential_id FROM passkeys").first<Json>();
    expect(left?.credential_id).toBe("otra");
  });

  it("DELETE /passkeys/:id da 409 si es la última y no la borra", async () => {
    const { app } = buildApp();
    await insertPasskey("unica");

    const response = await send(app, "DELETE", `${PASSKEYS}/unica`, { headers: await authed() });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "No puedes borrar tu única passkey" });
    expect(await rowCount("passkeys")).toBe(1);
  });

  it("DELETE /passkeys/:id da 404 si no existe", async () => {
    const { app } = buildApp();
    await insertPasskey("una");
    await insertPasskey("otra");

    const response = await send(app, "DELETE", `${PASSKEYS}/no-existe`, { headers: await authed() });

    expect(response.status).toBe(404);
    expect(await rowCount("passkeys")).toBe(2);
  });

  it("borrar dos passkeys a la vez nunca deja la cuenta sin ninguna", async () => {
    const { app } = buildApp();
    await insertPasskey("una");
    await insertPasskey("otra");
    const headers = await authed();

    const responses = await Promise.all([
      send(app, "DELETE", `${PASSKEYS}/una`, { headers }),
      send(app, "DELETE", `${PASSKEYS}/otra`, { headers }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await rowCount("passkeys")).toBe(1);
  });

  it("todas las rutas de gestión exigen sesión", async () => {
    const { app } = buildApp();
    await insertPasskey("una");
    await insertPasskey("otra");

    const attempts: [string, string][] = [
      ["GET", PASSKEYS],
      ["POST", PASSKEY_OPTIONS],
      ["POST", PASSKEY_VERIFY],
      ["DELETE", `${PASSKEYS}/una`],
      ["POST", RECOVERY_CODES],
      ["POST", LOGOUT],
    ];
    for (const [method, path] of attempts) {
      const response = await send(app, method, path, { body: method === "POST" ? {} : undefined });

      expect(response.status, `${method} ${path}`).toBe(401);
    }
    expect(await rowCount("passkeys")).toBe(2);
  });

  it("passkeys/options excluye las credenciales ya registradas y guarda un reto de registro", async () => {
    const { app } = buildApp();
    await insertPasskey("ya-registrada");

    const response = await send(app, "POST", PASSKEY_OPTIONS, { headers: await authed() });

    expect(response.status).toBe(200);
    const options = (await response.json()) as Json;
    expect(options.rp).toEqual({ name: "Gymvik", id: "example.com" });
    expect(options.excludeCredentials).toEqual([{ id: "ya-registrada", type: "public-key" }]);
    expect(options.authenticatorSelection).toMatchObject({ residentKey: "required", userVerification: "required" });
    const row = await env.DB.prepare("SELECT purpose FROM auth_challenges WHERE challenge = ?")
      .bind(options.challenge)
      .first<Json>();
    expect(row?.purpose).toBe("register");
  });

  it("passkeys/verify añade una passkey nueva con su etiqueta y consume el reto", async () => {
    const { app } = buildApp();
    await insertPasskey("primera");
    const headers = await authed();
    const options = (await (await send(app, "POST", PASSKEY_OPTIONS, { headers })).json()) as Json;
    const body = { response: fakeRegistration(options.challenge, "segunda"), label: "MacBook" };

    const response = await send(app, "POST", PASSKEY_VERIFY, { headers, body });

    expect(response.status).toBe(200);
    expect(await rowCount("passkeys")).toBe(2);
    const row = await env.DB.prepare("SELECT label FROM passkeys WHERE credential_id = 'segunda'").first<Json>();
    expect(row?.label).toBe("MacBook");
    expect(await rowCount("auth_challenges")).toBe(0);
    // No sirve para registrar dos veces con el mismo reto.
    const again = await send(app, "POST", PASSKEY_VERIFY, {
      headers,
      body: { response: fakeRegistration(options.challenge, "tercera") },
    });
    expect(again.status).toBe(400);
    expect(await rowCount("passkeys")).toBe(2);
  });

  it("passkeys/verify rechaza un reto de otro propósito", async () => {
    const { app } = buildApp();
    await insertPasskey("primera");
    const challenge = await insertChallenge("setup");

    const response = await send(app, "POST", PASSKEY_VERIFY, {
      headers: await authed(),
      body: { response: fakeRegistration(challenge, "segunda") },
    });

    expect(response.status).toBe(400);
    expect(await rowCount("passkeys")).toBe(1);
  });

  it("passkeys/verify no pisa una credencial ya registrada: da 409", async () => {
    const { app } = buildApp();
    await insertPasskey("repetida", "original");
    const headers = await authed();
    const options = (await (await send(app, "POST", PASSKEY_OPTIONS, { headers })).json()) as Json;

    const response = await send(app, "POST", PASSKEY_VERIFY, {
      headers,
      body: { response: fakeRegistration(options.challenge, "repetida") },
    });

    expect(response.status).toBe(409);
    const row = await env.DB.prepare("SELECT label FROM passkeys WHERE credential_id = 'repetida'").first<Json>();
    expect(row?.label).toBe("original");
  });
});

describe("límite de peticiones y CSRF", () => {
  it.each([
    [SETUP_OPTIONS, undefined],
    [SETUP_VERIFY, {}],
    [LOGIN_OPTIONS, undefined],
    [LOGIN_VERIFY, {}],
    [RECOVER, { code: UNKNOWN_CODE }],
  ])("%s responde 429 a la petición 11 de una misma IP en un minuto", async (path, body) => {
    const { app } = buildApp();
    const ip = randomIp();

    for (let i = 1; i <= 10; i += 1) {
      expect((await send(app, "POST", path, { ip, body })).status, `petición ${i}`).not.toBe(429);
    }
    const blocked = await send(app, "POST", path, { ip, body });

    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    // Otra IP no se ve afectada.
    expect((await send(app, "POST", path, { ip: randomIp(), body })).status).not.toBe(429);
  });

  it("tras 10 intentos fallidos, un código válido tampoco se acepta desde esa IP", async () => {
    const { app } = buildApp();
    const { body } = await completeSetup(app);
    const [code] = body.recoveryCodes as string[];
    const ip = randomIp();
    for (let i = 0; i < 10; i += 1) await send(app, "POST", RECOVER, { ip, body: { code: UNKNOWN_CODE } });

    const blocked = await send(app, "POST", RECOVER, { ip, body: { code } });
    const elsewhere = await send(app, "POST", RECOVER, { ip: randomIp(), body: { code } });

    expect(blocked.status).toBe(429);
    expect(elsewhere.status).toBe(200);
  });

  it.each([SETUP_OPTIONS, SETUP_VERIFY, LOGIN_OPTIONS, LOGIN_VERIFY, RECOVER, LOGOUT])(
    "%s rechaza con 403 un POST con Origin ajeno",
    async (path) => {
      const { app } = buildApp();

      const response = await send(app, "POST", path, { headers: { Origin: "https://evil.example" }, body: {} });

      expect(response.status).toBe(403);
    },
  );
});
