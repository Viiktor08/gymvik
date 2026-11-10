import { createExecutionContext, createScheduledController, waitOnExecutionContext } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { createApp } from "../../src/worker/index";
import { sendPush } from "../../src/worker/push/webpush";
import { ORIGIN, authed, send } from "./helpers";

type Json = Record<string, any>;

// Ningún test de este archivo toca la red: `fetch` está sustituido y los endpoints son de un dominio .test.
const ENDPOINT_A = "https://push.example.test/send/a";
const ENDPOINT_B = "https://push.example.test/send/b";

// --- Base64url y claves de un "dispositivo" ---

function toB64u(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromB64u(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

type Device = {
  sub: { endpoint: string; p256dh: string; auth: string };
  privateKey: CryptoKey;
  publicRaw: Uint8Array<ArrayBuffer>;
  authSecret: Uint8Array<ArrayBuffer>;
};

/** Lo que haría el navegador al suscribirse: un par ECDH P-256 y un secreto de 16 bytes. */
async function makeDevice(endpoint: string): Promise<Device> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const publicRaw = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  const authSecret = crypto.getRandomValues(new Uint8Array(16));
  return {
    sub: { endpoint, p256dh: toB64u(publicRaw), auth: toB64u(authSecret) },
    privateKey: pair.privateKey,
    publicRaw,
    authSecret,
  };
}

/** Descifra un cuerpo aes128gcm como lo haría el navegador (RFC 8291) y devuelve el JSON del mensaje. */
async function decrypt(body: Uint8Array, device: Device): Promise<unknown> {
  const text = new TextEncoder();
  const salt = body.slice(0, 16);
  const keyIdLength = body[20]!;
  const serverPublic = body.slice(21, 21 + keyIdLength);
  const ciphertext = body.slice(21 + keyIdLength);

  const serverKey = await crypto.subtle.importKey("raw", serverPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  // En tiempo de ejecución la propiedad se llama `public`; los tipos de workerd la declaran como `$public`.
  const ecdh = { name: "ECDH", public: serverKey } as SubtleCryptoDeriveKeyAlgorithm;
  const secret = await crypto.subtle.deriveBits(ecdh, device.privateKey, 256);
  const hkdf = async (ikm: BufferSource, hkdfSalt: BufferSource, info: BufferSource, bits: number) =>
    crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: hkdfSalt, info },
      await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]),
      bits,
    );
  const ikm = await hkdf(
    secret,
    device.authSecret,
    concat(text.encode("WebPush: info\0"), device.publicRaw, serverPublic),
    256,
  );
  const cek = await hkdf(ikm, salt, text.encode("Content-Encoding: aes128gcm\0"), 128);
  const nonce = await hkdf(ikm, salt, text.encode("Content-Encoding: nonce\0"), 96);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, aes, ciphertext));

  // Tras el mensaje va el delimitador 0x02 y ceros de relleno.
  let end = plain.length;
  while (end > 0 && plain[end - 1] === 0) end--;
  expect(plain[end - 1]).toBe(2);
  return JSON.parse(new TextDecoder().decode(plain.slice(0, end - 1)));
}

// --- fetch simulado ---

type Recorded = { url: string; headers: Record<string, string>; body: Uint8Array };

/** Sustituye `fetch`: anota cada petición y responde con el estado que toque a cada endpoint (201 por defecto). */
function stubFetch(statusByEndpoint: Record<string, number> = {}) {
  const requests: Recorded[] = [];
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    requests.push({
      url,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: init?.body as Uint8Array,
    });
    return new Response(null, { status: statusByEndpoint[url] ?? 201 });
  });
  return { requests, spy };
}

async function rows(table: string): Promise<Json[]> {
  const { results } = await env.DB.prepare(`SELECT * FROM ${table} ORDER BY 1`).all<Json>();
  return results;
}

beforeEach(async () => {
  // El almacenamiento D1 no se aísla entre tests del mismo archivo.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM push_subscriptions"),
    env.DB.prepare("DELETE FROM notifications_sent"),
    env.DB.prepare("DELETE FROM workouts"),
    env.DB.prepare("DELETE FROM routine_items"),
    env.DB.prepare("DELETE FROM routines"),
    env.DB.prepare("DELETE FROM body_metrics"),
    env.DB.prepare("DELETE FROM settings"),
    env.DB.prepare("INSERT INTO settings (id) VALUES (1)"),
  ]);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const MESSAGE = { type: "weight", title: "Gymvik", body: "Hace una semana que no apuntas tu peso", url: "/?peso=1" } as const;

describe("sendPush", () => {
  it("cifra el mensaje (aes128gcm), lo firma con VAPID y lo envía al endpoint", async () => {
    const device = await makeDevice(ENDPOINT_A);
    const { requests } = stubFetch();

    expect(await sendPush(device.sub, MESSAGE, env)).toEqual({ gone: false });

    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request!.url).toBe(ENDPOINT_A);
    expect(request!.headers["content-encoding"]).toBe("aes128gcm");
    expect(Number(request!.headers.ttl)).toBeGreaterThan(0);
    // El servicio de push solo ve texto cifrado; el dispositivo lo descifra y recibe el mensaje tal cual.
    expect(await decrypt(request!.body, device)).toEqual(MESSAGE);

    // Authorization: vapid t=<JWT ES256>, k=<clave pública>.
    const match = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=(.+)$/.exec(request!.headers.authorization ?? "");
    expect(match).not.toBeNull();
    const [, header, payload, signature, key] = match!;
    expect(key).toBe(env.VAPID_PUBLIC_KEY);
    expect(JSON.parse(new TextDecoder().decode(fromB64u(header!)))).toEqual({ typ: "JWT", alg: "ES256" });
    const claims = JSON.parse(new TextDecoder().decode(fromB64u(payload!)));
    expect(claims.aud).toBe("https://push.example.test");
    expect(claims.sub).toBe(env.VAPID_SUBJECT);
    expect(claims.exp).toBeGreaterThan(Date.now() / 1000);
    const publicKey = await crypto.subtle.importKey(
      "raw",
      fromB64u(env.VAPID_PUBLIC_KEY),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const signed = new TextEncoder().encode(`${header}.${payload}`);
    expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, fromB64u(signature!), signed)).toBe(true);
  });

  it.each([404, 410])("%i del servicio de push significa gone", async (status) => {
    const device = await makeDevice(ENDPOINT_A);
    stubFetch({ [ENDPOINT_A]: status });

    expect(await sendPush(device.sub, MESSAGE, env)).toEqual({ gone: true });
  });

  it.each([400, 403, 413, 429, 500, 503])("%i del servicio de push es un fallo, no gone", async (status) => {
    const device = await makeDevice(ENDPOINT_A);
    stubFetch({ [ENDPOINT_A]: status });

    await expect(sendPush(device.sub, MESSAGE, env)).rejects.toThrow(String(status));
  });

  it("propaga el fallo de red", async () => {
    const device = await makeDevice(ENDPOINT_A);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Network connection lost"));

    await expect(sendPush(device.sub, MESSAGE, env)).rejects.toThrow("Network connection lost");
  });
});

describe("GET /api/push/public-key", () => {
  it("devuelve la clave pública VAPID", async () => {
    const response = await send("GET", "/api/push/public-key");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ publicKey: env.VAPID_PUBLIC_KEY });
  });

  it("si el secreto VAPID no está configurado, responde 503 en vez de una clave vacía", async () => {
    const response = await createApp().request(
      `${ORIGIN}/api/push/public-key`,
      { headers: await authed() },
      { ...env, VAPID_PUBLIC_KEY: "" },
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Las notificaciones no están configuradas" });
  });

  it("si el secreto VAPID no existe del todo (sin definir), también responde 503, sin cuerpo con la clave", async () => {
    const response = await createApp().request(
      `${ORIGIN}/api/push/public-key`,
      { headers: await authed() },
      { ...env, VAPID_PUBLIC_KEY: undefined } as unknown as typeof env,
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Las notificaciones no están configuradas" });
  });

  it("exige sesión", async () => {
    const response = await exports.default.fetch(`${ORIGIN}/api/push/public-key`);

    expect(response.status).toBe(401);
  });
});

describe("POST /api/push/subscribe", () => {
  const body = (endpoint = ENDPOINT_A, extra: Json = {}) => ({
    endpoint,
    expirationTime: null,
    keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg", ...extra },
  });

  it("guarda la suscripción", async () => {
    const response = await send("POST", "/api/push/subscribe", { body: body() });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ subscribed: true });
    expect(await rows("push_subscriptions")).toMatchObject([
      { endpoint: ENDPOINT_A, p256dh: body().keys.p256dh, auth: body().keys.auth },
    ]);
  });

  it("repetirla con el mismo endpoint actualiza las claves en vez de duplicar", async () => {
    await send("POST", "/api/push/subscribe", { body: body() });
    const renewed = { endpoint: ENDPOINT_A, keys: { p256dh: "nuevaClaveP256dh", auth: "nuevaClaveAuth" } };

    expect((await send("POST", "/api/push/subscribe", { body: renewed })).status).toBe(200);

    expect(await rows("push_subscriptions")).toMatchObject([
      { endpoint: ENDPOINT_A, p256dh: "nuevaClaveP256dh", auth: "nuevaClaveAuth" },
    ]);
  });

  it.each([
    ["un endpoint http", { endpoint: "http://push.example.test/send/a" }],
    ["un endpoint que no es una URL", { endpoint: "no-es-una-url" }],
    ["un endpoint javascript:", { endpoint: "javascript:alert(1)" }],
    ["un endpoint vacío", { endpoint: "" }],
    ["un endpoint que no es texto", { endpoint: 42 }],
    ["un endpoint desmesurado", { endpoint: `https://push.example.test/${"a".repeat(3000)}` }],
    ["sin claves", { keys: undefined }],
    ["sin p256dh", { keys: { auth: "tBHItJI5svbpez7KI4CCXg" } }],
    ["sin auth", { keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM" } }],
    ["una clave que no es base64url", { keys: { p256dh: "no es base64url!", auth: "tBHItJI5svbpez7KI4CCXg" } }],
    ["una clave vacía", { keys: { p256dh: "", auth: "tBHItJI5svbpez7KI4CCXg" } }],
  ])("rechaza %s con 400 y no guarda nada", async (_name, override) => {
    const response = await send("POST", "/api/push/subscribe", { body: { ...body(), ...override } });

    expect(response.status).toBe(400);
    expect(await rows("push_subscriptions")).toEqual([]);
  });

  it("rechaza JSON mal formado con 400", async () => {
    expect((await send("POST", "/api/push/subscribe", { body: "{no es json" })).status).toBe(400);
  });

  it("exige sesión", async () => {
    const response = await exports.default.fetch(`${ORIGIN}/api/push/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN },
      body: JSON.stringify(body()),
    });

    expect(response.status).toBe(401);
    expect(await rows("push_subscriptions")).toEqual([]);
  });
});

describe("DELETE /api/push/subscribe", () => {
  beforeEach(async () => {
    for (const endpoint of [ENDPOINT_A, ENDPOINT_B]) {
      await env.DB.prepare("INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES (?, 'k', 'a')").bind(endpoint).run();
    }
  });

  it("borra solo la suscripción indicada", async () => {
    const response = await send("DELETE", "/api/push/subscribe", { body: { endpoint: ENDPOINT_A } });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true });
    expect((await rows("push_subscriptions")).map((row) => row.endpoint)).toEqual([ENDPOINT_B]);
  });

  it("si no existía, responde 200 con deleted false (ya estaba dada de baja)", async () => {
    const response = await send("DELETE", "/api/push/subscribe", { body: { endpoint: "https://push.example.test/otra" } });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: false });
    expect(await rows("push_subscriptions")).toHaveLength(2);
  });

  it("rechaza un cuerpo sin endpoint con 400", async () => {
    expect((await send("DELETE", "/api/push/subscribe", { body: {} })).status).toBe(400);
    expect((await send("DELETE", "/api/push/subscribe", { body: { endpoint: 7 } })).status).toBe(400);
    expect(await rows("push_subscriptions")).toHaveLength(2);
  });
});

describe("POST /api/push/test", () => {
  async function subscribe(device: Device): Promise<void> {
    await env.DB.prepare("INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES (?, ?, ?)")
      .bind(device.sub.endpoint, device.sub.p256dh, device.sub.auth)
      .run();
  }

  it("envía el aviso de prueba a todas las suscripciones", async () => {
    const a = await makeDevice(ENDPOINT_A);
    const b = await makeDevice(ENDPOINT_B);
    await subscribe(a);
    await subscribe(b);
    const { requests } = stubFetch();

    const response = await send("POST", "/api/push/test");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sent: 2, removed: 0, failed: 0 });
    expect(requests.map((request) => request.url).sort()).toEqual([ENDPOINT_A, ENDPOINT_B]);
    const toA = requests.find((request) => request.url === ENDPOINT_A)!;
    expect(await decrypt(toA.body, a)).toMatchObject({ title: "Gymvik", body: "Aviso de prueba ✓", url: "/" });
  });

  it("borra las suscripciones gone y cuenta los fallos", async () => {
    const a = await makeDevice(ENDPOINT_A);
    const b = await makeDevice(ENDPOINT_B);
    const c = await makeDevice("https://push.example.test/send/c");
    await subscribe(a);
    await subscribe(b);
    await subscribe(c);
    stubFetch({ [ENDPOINT_A]: 201, [ENDPOINT_B]: 410, "https://push.example.test/send/c": 500 });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await send("POST", "/api/push/test");

    expect(await response.json()).toEqual({ sent: 1, removed: 1, failed: 1 });
    expect((await rows("push_subscriptions")).map((row) => row.endpoint)).toEqual([ENDPOINT_A, "https://push.example.test/send/c"]);
  });

  it("sin suscripciones responde 200 con todo a cero", async () => {
    const { spy } = stubFetch();

    const response = await send("POST", "/api/push/test");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sent: 0, removed: 0, failed: 0 });
    expect(spy).not.toHaveBeenCalled();
  });

  it("exige sesión y Origin", async () => {
    const { spy } = stubFetch();

    expect((await exports.default.fetch(`${ORIGIN}/api/push/test`, { method: "POST", headers: { Origin: ORIGIN } })).status).toBe(401);
    expect((await exports.default.fetch(`${ORIGIN}/api/push/test`, { method: "POST" })).status).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("scheduled", () => {
  it("ejecuta runNotifications con la hora actual y el sendPush real", async () => {
    // Martes 2026-11-10, 09:00 en Madrid: sin rutina en rotación solo toca weight.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-10T08:00:00Z"));
    const device = await makeDevice(ENDPOINT_A);
    await env.DB.prepare("INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES (?, ?, ?)")
      .bind(device.sub.endpoint, device.sub.p256dh, device.sub.auth)
      .run();
    const { requests } = stubFetch();

    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ cron: "*/15 * * * *" }), env, ctx);
    await waitOnExecutionContext(ctx);

    expect(requests).toHaveLength(1);
    expect(await decrypt(requests[0]!.body, device)).toMatchObject({ type: "weight", url: "/?peso=1" });
    expect(await rows("notifications_sent")).toEqual([{ type: "weight", local_date: "2026-11-10" }]);
  });
});
