import { describe, expect, it } from "vitest";
import { formatDecimal, formatLongDate, formatShortDate, formatSigned } from "../../src/web/format";

describe("formatDecimal", () => {
  it("usa coma decimal y no rellena con ceros", () => {
    expect(formatDecimal(74.3)).toBe("74,3");
    expect(formatDecimal(80)).toBe("80");
    expect(formatDecimal(57.555)).toBe("57,56");
  });

  it("no agrupa miles en kilos", () => {
    expect(formatDecimal(1234.5)).toBe("1234,5");
  });

  it("lo que no es un número finito sale como —, nunca NaN ni Infinity", () => {
    expect(formatDecimal(null)).toBe("—");
    expect(formatDecimal(undefined)).toBe("—");
    expect(formatDecimal(Number.NaN)).toBe("—");
    expect(formatDecimal(Number.POSITIVE_INFINITY)).toBe("—");
    expect(formatDecimal(Number.NEGATIVE_INFINITY)).toBe("—");
  });

  it("-0 no se escribe como -0", () => {
    expect(formatDecimal(-0)).toBe("0");
  });
});

describe("formatSigned", () => {
  it("pone + a las subidas y un menos de verdad a las bajadas", () => {
    expect(formatSigned(0.4)).toBe("+0,4");
    expect(formatSigned(-0.4)).toBe("−0,4");
  });

  it("0, -0 y lo que redondea a 0 salen sin signo", () => {
    expect(formatSigned(0)).toBe("0");
    expect(formatSigned(-0)).toBe("0");
    expect(formatSigned(-0.004)).toBe("0");
  });

  it("un valor no finito sale como —", () => {
    expect(formatSigned(Number.NaN)).toBe("—");
    expect(formatSigned(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("formatLongDate y formatShortDate", () => {
  it("escriben el día en español, con mayúscula inicial el largo", () => {
    expect(formatLongDate("2026-11-10")).toBe("Martes, 10 de noviembre");
    expect(formatLongDate("2026-03-01")).toBe("Domingo, 1 de marzo");
    expect(formatShortDate("2026-11-09")).toBe("9 nov");
  });

  it("una fecha que no existe sale vacía, no Invalid Date", () => {
    for (const bad of ["", "hoy", "2026-02-30", "2026-13-01", "10/11/2026"]) {
      expect(formatLongDate(bad)).toBe("");
      expect(formatShortDate(bad)).toBe("");
    }
  });
});
