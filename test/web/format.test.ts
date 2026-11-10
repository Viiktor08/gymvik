import { describe, expect, it } from "vitest";
import {
  formatClock,
  formatDecimal,
  formatLongDate,
  formatMediumDate,
  formatMinutes,
  formatPace,
  formatShortDate,
  formatSigned,
} from "../../src/web/format";

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

describe("formatMediumDate", () => {
  it("escribe día, mes abreviado y año, sin puntos", () => {
    expect(formatMediumDate("2026-11-09")).toBe("9 nov 2026");
    expect(formatMediumDate("2026-09-01")).toBe("1 sept 2026");
  });

  it("una fecha no válida sale vacía", () => {
    expect(formatMediumDate("2026-02-30")).toBe("");
    expect(formatMediumDate("")).toBe("");
  });
});

describe("formatClock", () => {
  it("escribe minutos y segundos, y horas solo cuando las hay", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(5)).toBe("0:05");
    expect(formatClock(90)).toBe("1:30");
    expect(formatClock(754)).toBe("12:34");
    expect(formatClock(3600)).toBe("1:00:00");
    expect(formatClock(3723)).toBe("1:02:03");
  });

  it("descarta los decimales y no baja de cero", () => {
    expect(formatClock(59.9)).toBe("0:59");
    expect(formatClock(-4)).toBe("0:00");
  });

  it("lo que no es un número finito sale como 0:00, nunca NaN", () => {
    expect(formatClock(Number.NaN)).toBe("0:00");
    expect(formatClock(Number.POSITIVE_INFINITY)).toBe("0:00");
  });
});

describe("formatPace", () => {
  it("escribe el ritmo en min:ss por kilómetro", () => {
    expect(formatPace(5.5)).toBe("5:30 min/km");
    expect(formatPace(6)).toBe("6:00 min/km");
    expect(formatPace(4.2)).toBe("4:12 min/km");
  });

  it("redondea los segundos sin llegar a 60", () => {
    expect(formatPace(5.999)).toBe("6:00 min/km");
  });

  it("lo que no es un ritmo sale como —", () => {
    expect(formatPace(Number.NaN)).toBe("—");
    expect(formatPace(Number.POSITIVE_INFINITY)).toBe("—");
    expect(formatPace(0)).toBe("—");
    expect(formatPace(-1)).toBe("—");
  });
});

describe("formatMinutes", () => {
  it("escribe minutos, y horas con minutos a partir de 60", () => {
    expect(formatMinutes(0)).toBe("0 min");
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(60)).toBe("1 h 00 min");
    expect(formatMinutes(65)).toBe("1 h 05 min");
    expect(formatMinutes(125)).toBe("2 h 05 min");
  });

  it("redondea los decimales y lo que no es un número sale como 0 min", () => {
    expect(formatMinutes(44.6)).toBe("45 min");
    expect(formatMinutes(Number.NaN)).toBe("0 min");
    expect(formatMinutes(-3)).toBe("0 min");
    expect(formatMinutes(Number.POSITIVE_INFINITY)).toBe("0 min");
  });
});
