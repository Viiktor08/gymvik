import { describe, expect, it } from "vitest";
import { roundAxis } from "../../src/web/components/chartKit";

describe("roundAxis", () => {
  it("cubre los valores con marcas redondas y a la misma distancia", () => {
    expect(roundAxis([72.45, 76.65, 74.1])).toEqual({ domain: [72, 78], ticks: [72, 74, 76, 78] });
  });

  it("un rango corto usa medios kilos", () => {
    expect(roundAxis([74.2, 74.6])).toEqual({ domain: [74, 75], ticks: [74, 74.5, 75] });
  });

  it("un rango largo no pasa de 5 marcas", () => {
    const { ticks } = roundAxis([50, 130]);
    expect(ticks.length).toBeLessThanOrEqual(5);
    expect(ticks[0]).toBeLessThanOrEqual(50);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(130);
  });

  it("una línea plana sobre una marca exacta queda en medio", () => {
    expect(roundAxis([75, 75])).toEqual({ domain: [74.5, 75.5], ticks: [74.5, 75, 75.5] });
  });

  it("un solo valor no exacto también tiene eje", () => {
    expect(roundAxis([74.3])).toEqual({ domain: [74, 74.5], ticks: [74, 74.5] });
  });

  it("nunca produce Infinity ni NaN con valores finitos", () => {
    for (const values of [[0], [0.1], [1e-9], [199.99], [1e6, 1e6 + 3]]) {
      const { domain, ticks } = roundAxis(values);
      expect([...domain, ...ticks].every(Number.isFinite)).toBe(true);
    }
  });
});
