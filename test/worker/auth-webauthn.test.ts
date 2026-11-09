import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "../../src/worker/auth/session";
import { randomToken } from "../../src/worker/security/crypto";
import { ORIGIN } from "./helpers";
import { SoftAuthenticator } from "./softAuthenticator";

// Ceremonias WebAuthn completas contra la app real, con la verificación real de
// @simplewebauthn/server (sin stubs) y un autenticador por software. Comprueba
// que la librería funciona en workerd y que las reglas de la spec §8 se cumplen.

type Json = Record<string, any>;

const RP_ID = "example.com";

function send(method: string, path: string, options: { headers?: Record<string, string>; body?: unknown } = {}) {
  const { headers = {}, body } = options;
  return exports.default.fetch(`${ORIGIN}${path}`, {
    method,
    headers: {
      Origin: ORIGIN,
      "CF-Connecting-IP": `ip-${randomToken(8)}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function sessionCookie(response: Response): Record<string, string> {
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith(`${SESSION_COOKIE}=`));
  expect(cookie).toBeTruthy();
  return { Cookie: (cookie as string).split(";")[0] as string };
}

async function setupOptions(): Promise<Json> {
  const response = await send("POST", "/api/auth/setup/options", { headers: { "X-Setup-Token": env.SETUP_TOKEN } });
  expect(response.status).toBe(200);
  return (await response.json()) as Json;
}

async function loginChallenge(): Promise<string> {
  const response = await send("POST", "/api/auth/login/options");
  expect(response.status).toBe(200);
  return ((await response.json()) as Json).challenge;
}

/** Primer acceso completo con un autenticador nuevo. */
async function register(device: SoftAuthenticator) {
  const options = await setupOptions();
  const response = await send("POST", "/api/auth/setup/verify", {
    body: { response: await device.register({ challenge: options.challenge, origin: ORIGIN, rpId: RP_ID }) },
  });
  return response;
}

function login(device: SoftAuthenticator, challenge: string, overrides: Partial<Parameters<SoftAuthenticator["assert"]>[0]> = {}) {
  return device
    .assert({ challenge, origin: ORIGIN, rpId: RP_ID, ...overrides })
    .then((assertion) => send("POST", "/api/auth/login/verify", { body: { response: assertion } }));
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM passkeys"),
    env.DB.prepare("DELETE FROM sessions"),
    env.DB.prepare("DELETE FROM auth_challenges"),
    env.DB.prepare("DELETE FROM recovery_codes"),
  ]);
  // La verificación real avisa en los registros cuando rechaza una respuesta.
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("WebAuthn real en workerd", () => {
  it("primer acceso, cierre de sesión y login con la passkey registrada", async () => {
    const device = await SoftAuthenticator.create();

    const registered = await register(device);

    expect(registered.status).toBe(200);
    expect(((await registered.json()) as Json).recoveryCodes).toHaveLength(8);
    const stored = await env.DB.prepare("SELECT credential_id, counter, transports FROM passkeys").first<Json>();
    expect(stored).toEqual({ credential_id: device.id, counter: 0, transports: '["internal"]' });

    const me = await send("GET", "/api/auth/me");
    expect(await me.json()).toEqual({ authenticated: false, setupRequired: false });

    const loggedIn = await login(device, await loginChallenge());

    expect(loggedIn.status).toBe(200);
    const session = sessionCookie(loggedIn);
    expect((await send("GET", "/api/auth/passkeys", { headers: session })).status).toBe(200);
    const row = await env.DB.prepare("SELECT counter FROM passkeys").first<Json>();
    expect(row?.counter).toBe(1);
  });

  it("no acepta repetir una aserción (reto de un solo uso) ni un contador que no avanza", async () => {
    const device = await SoftAuthenticator.create();
    await register(device);
    const challenge = await loginChallenge();
    const assertion = await device.assert({ challenge, origin: ORIGIN, rpId: RP_ID });
    const body = { response: assertion };

    const first = await send("POST", "/api/auth/login/verify", { body });
    const replay = await send("POST", "/api/auth/login/verify", { body });
    // Una aserción nueva (reto nuevo) pero con el contador anterior: clon sospechoso.
    const stale = await login(device, await loginChallenge(), { counter: 1 });
    const fresh = await login(device, await loginChallenge(), { counter: 2 });

    expect(first.status).toBe(200);
    expect(replay.status).toBe(401);
    expect(stale.status).toBe(401);
    expect(fresh.status).toBe(200);
    const row = await env.DB.prepare("SELECT counter FROM passkeys").first<Json>();
    expect(row?.counter).toBe(2);
  });

  it("acepta contador 0 siempre, como las passkeys sincronizadas de iCloud", async () => {
    const device = await SoftAuthenticator.create();
    await register(device);

    const first = await login(device, await loginChallenge(), { counter: 0 });
    const second = await login(device, await loginChallenge(), { counter: 0 });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });

  it("rechaza el login si el usuario no se verificó (userVerification: required)", async () => {
    const device = await SoftAuthenticator.create();
    await register(device);

    const response = await login(device, await loginChallenge(), { userVerified: false });

    expect(response.status).toBe(401);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("rechaza una firma hecha con otra clave", async () => {
    const device = await SoftAuthenticator.create();
    await register(device);
    const impostor = await SoftAuthenticator.create(device.credentialId);

    const response = await login(device, await loginChallenge(), { signWith: impostor });

    expect(response.status).toBe(401);
  });

  it.each([
    ["otro origen", { origin: "https://evil.example" }],
    ["otro rpID", { rpId: "evil.example" }],
  ])("rechaza el login hecho para %s", async (_name, overrides) => {
    const device = await SoftAuthenticator.create();
    await register(device);

    const response = await login(device, await loginChallenge(), overrides);

    expect(response.status).toBe(401);
  });

  it("rechaza el primer acceso si el usuario no se verificó", async () => {
    const device = await SoftAuthenticator.create();
    const options = await setupOptions();

    const response = await send("POST", "/api/auth/setup/verify", {
      body: { response: await device.register({ challenge: options.challenge, origin: ORIGIN, rpId: RP_ID, userVerified: false }) },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "No se pudo registrar la passkey" });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM passkeys").first<Json>()).toEqual({ n: 0 });
  });

  it.each([
    ["otro origen", { origin: "https://evil.example" }],
    ["otro rpID", { rpId: "evil.example" }],
  ])("rechaza el primer acceso hecho para %s", async (_name, overrides) => {
    const device = await SoftAuthenticator.create();
    const options = await setupOptions();

    const response = await send("POST", "/api/auth/setup/verify", {
      body: { response: await device.register({ challenge: options.challenge, origin: ORIGIN, rpId: RP_ID, ...overrides }) },
    });

    expect(response.status).toBe(400);
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM passkeys").first<Json>()).toEqual({ n: 0 });
  });

  it("rechaza el primer acceso con un reto que no emitió el servidor", async () => {
    const device = await SoftAuthenticator.create();
    await setupOptions();

    const response = await send("POST", "/api/auth/setup/verify", {
      body: { response: await device.register({ challenge: randomToken(32), origin: ORIGIN, rpId: RP_ID }) },
    });

    expect(response.status).toBe(400);
  });

  it("añade una segunda passkey con sesión y excluye la ya registrada", async () => {
    const first = await SoftAuthenticator.create();
    const session = sessionCookie(await register(first));

    const optionsResponse = await send("POST", "/api/auth/passkeys/options", { headers: session });
    const options = (await optionsResponse.json()) as Json;
    expect(options.excludeCredentials).toEqual([{ id: first.id, type: "public-key", transports: ["internal"] }]);
    const second = await SoftAuthenticator.create();
    const verified = await send("POST", "/api/auth/passkeys/verify", {
      headers: session,
      body: {
        response: await second.register({ challenge: options.challenge, origin: ORIGIN, rpId: RP_ID }),
        label: "iPad",
      },
    });

    expect(verified.status).toBe(200);
    const list = (await (await send("GET", "/api/auth/passkeys", { headers: session })).json()) as Json;
    expect(list.passkeys.map((p: Json) => p.id).sort()).toEqual([first.id, second.id].sort());
    // La nueva passkey sirve para entrar.
    expect((await login(second, await loginChallenge())).status).toBe(200);
  });

  it("tras recuperar con un código, la sesión permite registrar una passkey nueva", async () => {
    const original = await SoftAuthenticator.create();
    const registered = await register(original);
    const [code] = ((await registered.json()) as Json).recoveryCodes as string[];

    const recovered = await send("POST", "/api/auth/recover", { body: { code } });
    const session = sessionCookie(recovered);
    const options = (await (await send("POST", "/api/auth/passkeys/options", { headers: session })).json()) as Json;
    const replacement = await SoftAuthenticator.create();
    const verified = await send("POST", "/api/auth/passkeys/verify", {
      headers: session,
      body: { response: await replacement.register({ challenge: options.challenge, origin: ORIGIN, rpId: RP_ID }) },
    });

    expect(await recovered.json()).toEqual({ mustRegisterPasskey: true });
    expect(verified.status).toBe(200);
    expect((await login(replacement, await loginChallenge())).status).toBe(200);
  });
});
