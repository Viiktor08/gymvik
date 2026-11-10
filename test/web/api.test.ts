import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "../../src/web/api";

const fetchMock = vi.fn<typeof fetch>();
const assign = vi.fn<(url: string) => void>();

function respond(status: number, body: unknown, contentType = "application/json"): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Response(status === 204 ? null : text, { status, headers: { "Content-Type": contentType } });
}

// Una respuesta nueva en cada llamada: el cuerpo de un Response solo se puede leer una vez.
function reply(status: number, body: unknown, contentType?: string) {
  fetchMock.mockImplementation(async () => respond(status, body, contentType));
}

function at(pathname: string) {
  vi.stubGlobal("location", { pathname, assign });
}

beforeEach(() => {
  fetchMock.mockReset();
  assign.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  at("/");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api", () => {
  it("devuelve el JSON de la respuesta", async () => {
    reply(200, { ok: true });
    await expect(api<{ ok: boolean }>("/api/health")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith("/api/health", expect.anything());
  });

  it("si el cuerpo es un texto lo manda como JSON, sin pisar una cabecera propia", async () => {
    reply(200, {});
    await api("/api/settings", { method: "PATCH", body: JSON.stringify({ theme: "blue" }) });
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("Content-Type")).toBe("application/json");

    await api("/api/x", { method: "POST", body: "a", headers: { "Content-Type": "text/plain" } });
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("Content-Type")).toBe("text/plain");
  });

  it("no manda Content-Type si no hay cuerpo", async () => {
    reply(200, {});
    await api("/api/today");
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).has("Content-Type")).toBe(false);
  });

  it("una respuesta vacía (204) da undefined", async () => {
    reply(204, null);
    await expect(api("/api/creatine/2026-11-10", { method: "DELETE" })).resolves.toBeUndefined();
  });

  it("un error de la API lanza ApiError con el mensaje del servidor", async () => {
    reply(400, { error: "Datos no válidos" });
    const error = await api("/api/settings").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, message: "Datos no válidos" });
  });

  it("un error sin JSON da un mensaje genérico en español", async () => {
    reply(502, "<html>Bad gateway</html>", "text/html");
    await expect(api("/api/today")).rejects.toMatchObject({ status: 502, message: "Error del servidor" });
  });

  it("sin red lanza ApiError con status 0", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(api("/api/today")).rejects.toMatchObject({ status: 0, message: "Sin conexión" });
  });

  describe("401", () => {
    it("redirige a /login y lanza el error", async () => {
      reply(401, { error: "No autenticado" });
      await expect(api("/api/today")).rejects.toMatchObject({ status: 401 });
      expect(assign).toHaveBeenCalledExactlyOnceWith("/login");
    });

    it("no redirige en las rutas /api/auth/*, para no crear bucles", async () => {
      reply(401, { error: "No se pudo iniciar sesión" });
      await expect(api("/api/auth/login/verify", { method: "POST" })).rejects.toMatchObject({
        status: 401,
        message: "No se pudo iniciar sesión",
      });
      expect(assign).not.toHaveBeenCalled();
    });

    it.each(["/login", "/setup", "/recuperar"])("no redirige si ya estás en %s", async (pathname) => {
      at(pathname);
      reply(401, { error: "No autenticado" });
      await expect(api("/api/settings")).rejects.toMatchObject({ status: 401 });
      expect(assign).not.toHaveBeenCalled();
    });

    it("un 403 no redirige", async () => {
      reply(403, { error: "Origen no permitido" });
      await expect(api("/api/settings", { method: "PATCH" })).rejects.toMatchObject({ status: 403 });
      expect(assign).not.toHaveBeenCalled();
    });
  });
});
