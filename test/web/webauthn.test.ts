import { WebAuthnError } from "@simplewebauthn/browser";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/web/api";

const browser = vi.hoisted(() => ({
  startRegistration: vi.fn(),
  startAuthentication: vi.fn(),
  browserSupportsWebAuthn: vi.fn(() => true),
}));
const apiMock = vi.hoisted(() => vi.fn());

vi.mock("@simplewebauthn/browser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@simplewebauthn/browser")>()),
  ...browser,
}));
vi.mock("../../src/web/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/web/api")>()),
  api: apiMock,
}));

const { passkeyErrorMessage, registerFirstPasskey, registerPasskey, signInWithPasskey } = await import(
  "../../src/web/webauthn"
);

const OPTIONS = { challenge: "reto" };
const CREDENTIAL = { id: "cred", type: "public-key" };

function bodyOf(call: number): unknown {
  const init = apiMock.mock.calls[call]?.[1] as RequestInit | undefined;
  return typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
}

function headersOf(call: number): Headers {
  return new Headers((apiMock.mock.calls[call]?.[1] as RequestInit | undefined)?.headers);
}

beforeEach(() => {
  vi.resetAllMocks();
  browser.browserSupportsWebAuthn.mockReturnValue(true);
});

describe("registerFirstPasskey", () => {
  it("pide las opciones con el token, registra la passkey y devuelve los códigos", async () => {
    apiMock.mockResolvedValueOnce(OPTIONS).mockResolvedValueOnce({ recoveryCodes: ["aaaa-bbbb-cccc-dddd"] });
    browser.startRegistration.mockResolvedValue(CREDENTIAL);

    await expect(registerFirstPasskey("secreto")).resolves.toEqual(["aaaa-bbbb-cccc-dddd"]);

    expect(apiMock.mock.calls[0]?.[0]).toBe("/api/auth/setup/options");
    expect(apiMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
    expect(headersOf(0).get("X-Setup-Token")).toBe("secreto");
    expect(browser.startRegistration).toHaveBeenCalledWith({ optionsJSON: OPTIONS });
    expect(apiMock.mock.calls[1]?.[0]).toBe("/api/auth/setup/verify");
    expect(bodyOf(1)).toEqual({ response: CREDENTIAL });
  });

  it("no guarda el token en ningún almacenamiento", async () => {
    apiMock.mockResolvedValueOnce(OPTIONS).mockResolvedValueOnce({ recoveryCodes: [] });
    browser.startRegistration.mockResolvedValue(CREDENTIAL);
    await registerFirstPasskey("secreto");
    expect(JSON.stringify({ ...localStorage })).not.toContain("secreto");
    expect(JSON.stringify({ ...sessionStorage })).not.toContain("secreto");
  });

  it("si el navegador no admite passkeys, ni siquiera llama a la API", async () => {
    browser.browserSupportsWebAuthn.mockReturnValue(false);
    await expect(registerFirstPasskey("secreto")).rejects.toThrow(/no admite passkeys/);
    expect(apiMock).not.toHaveBeenCalled();
  });
});

describe("registerPasskey", () => {
  it("registra una passkey nueva con la sesión abierta", async () => {
    apiMock.mockResolvedValueOnce(OPTIONS).mockResolvedValueOnce({ ok: true });
    browser.startRegistration.mockResolvedValue(CREDENTIAL);

    await registerPasskey("iPhone");

    expect(apiMock.mock.calls[0]?.[0]).toBe("/api/auth/passkeys/options");
    expect(apiMock.mock.calls[1]?.[0]).toBe("/api/auth/passkeys/verify");
    expect(bodyOf(1)).toEqual({ response: CREDENTIAL, label: "iPhone" });
  });
});

describe("signInWithPasskey", () => {
  it("pide el reto, firma con la passkey y la verifica", async () => {
    apiMock.mockResolvedValueOnce(OPTIONS).mockResolvedValueOnce({ ok: true });
    browser.startAuthentication.mockResolvedValue(CREDENTIAL);

    await signInWithPasskey();

    expect(apiMock.mock.calls[0]?.[0]).toBe("/api/auth/login/options");
    expect(browser.startAuthentication).toHaveBeenCalledWith({ optionsJSON: OPTIONS });
    expect(apiMock.mock.calls[1]?.[0]).toBe("/api/auth/login/verify");
    expect(bodyOf(1)).toEqual({ response: CREDENTIAL });
  });

  it("no verifica nada si el usuario cancela", async () => {
    apiMock.mockResolvedValueOnce(OPTIONS);
    browser.startAuthentication.mockRejectedValue(new DOMException("cancelado", "NotAllowedError"));
    await expect(signInWithPasskey()).rejects.toThrow();
    expect(apiMock).toHaveBeenCalledTimes(1);
  });
});

describe("passkeyErrorMessage", () => {
  it("enseña el mensaje del servidor", () => {
    expect(passkeyErrorMessage(new ApiError(401, "No se pudo iniciar sesión"))).toBe("No se pudo iniciar sesión");
  });

  it("explica que sin conexión no se puede entrar", () => {
    expect(passkeyErrorMessage(new ApiError(0, "Sin conexión"))).toBe("Sin conexión");
  });

  it("distingue cancelar la verificación", () => {
    expect(passkeyErrorMessage(new DOMException("x", "NotAllowedError"))).toMatch(/cancelado|no se completó/i);
    const wrapped = new WebAuthnError({
      message: "x",
      code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
      cause: new DOMException("x", "NotAllowedError"),
    });
    expect(passkeyErrorMessage(wrapped)).toMatch(/cancelado|no se completó/i);
    const aborted = new WebAuthnError({
      message: "x",
      code: "ERROR_CEREMONY_ABORTED",
      cause: new DOMException("x", "AbortError"),
    });
    expect(passkeyErrorMessage(aborted)).toMatch(/cancelado|no se completó/i);
  });

  it("avisa de que el dispositivo ya tiene una passkey", () => {
    const error = new WebAuthnError({
      message: "x",
      code: "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED",
      cause: new DOMException("x", "InvalidStateError"),
    });
    expect(passkeyErrorMessage(error)).toMatch(/ya tiene una passkey/);
  });

  it("para cualquier otra cosa da un mensaje genérico, sin detalles técnicos", () => {
    expect(passkeyErrorMessage(new Error("boom: internal detail"))).toBe(
      "No se pudo completar. Inténtalo de nuevo.",
    );
    expect(passkeyErrorMessage("texto suelto")).toBe("No se pudo completar. Inténtalo de nuevo.");
  });
});
