import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("GET /api/health", () => {
  it("responde 200 con { ok: true } sin autenticación", async () => {
    const response = await exports.default.fetch("http://gymvik.test/api/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});
