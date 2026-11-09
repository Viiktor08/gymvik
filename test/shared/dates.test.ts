import { describe, expect, it } from "vitest";
import {
  addDays,
  daysLeftInWeek,
  formatThousands,
  isValidLocalDate,
  localDate,
  localTime,
  parseDecimal,
  weekDays,
  weekStart,
} from "../../src/shared/dates";

describe("localDate", () => {
  it("usa la fecha de la zona horaria, no la de UTC", () => {
    expect(localDate(new Date("2026-11-09T23:30:00Z"), "Europe/Madrid")).toBe("2026-11-10");
    expect(localDate(new Date("2026-11-09T22:30:00Z"), "Europe/Madrid")).toBe("2026-11-09");
  });

  it("funciona el fin de semana del cambio de hora", () => {
    expect(localDate(new Date("2026-03-28T23:30:00Z"), "Europe/Madrid")).toBe("2026-03-29");
    expect(localDate(new Date("2026-10-24T22:30:00Z"), "Europe/Madrid")).toBe("2026-10-25");
  });

  it("respeta otras zonas horarias", () => {
    expect(localDate(new Date("2026-11-09T02:00:00Z"), "America/New_York")).toBe("2026-11-08");
  });

  it("rellena con ceros el mes y el día", () => {
    expect(localDate(new Date("2026-01-05T12:00:00Z"), "Europe/Madrid")).toBe("2026-01-05");
  });
});

describe("localTime", () => {
  it("da la hora local en formato HH:MM", () => {
    expect(localTime(new Date("2026-07-01T18:05:00Z"), "Europe/Madrid")).toBe("20:05");
    expect(localTime(new Date("2026-01-01T18:05:00Z"), "Europe/Madrid")).toBe("19:05");
  });

  it("da 00:05 a medianoche, nunca 24:05", () => {
    expect(localTime(new Date("2026-11-09T23:05:00Z"), "Europe/Madrid")).toBe("00:05");
    expect(localTime(new Date("2026-07-01T22:05:00Z"), "Europe/Madrid")).toBe("00:05");
  });
});

describe("addDays", () => {
  it("cruza el fin de año", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
  });

  it("respeta los meses cortos y los años bisiestos", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
  });

  it("no se ve afectada por los cambios de hora", () => {
    expect(addDays("2026-03-28", 1)).toBe("2026-03-29");
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
    expect(addDays("2026-10-25", 1)).toBe("2026-10-26");
  });

  it("admite 0 y saltos grandes", () => {
    expect(addDays("2026-11-09", 0)).toBe("2026-11-09");
    expect(addDays("2026-11-09", 365)).toBe("2027-11-09");
    expect(addDays("2026-11-09", -7)).toBe("2026-11-02");
  });

  it("falla con una fecha que no existe", () => {
    expect(() => addDays("2026-02-30", 1)).toThrow(RangeError);
    expect(() => addDays("hoy", 1)).toThrow(RangeError);
  });
});

describe("weekStart", () => {
  it("devuelve el lunes de la semana", () => {
    expect(weekStart("2026-11-15")).toBe("2026-11-09"); // domingo
    expect(weekStart("2026-11-09")).toBe("2026-11-09"); // lunes
    expect(weekStart("2026-11-11")).toBe("2026-11-09"); // miércoles
  });

  it("cruza el cambio de mes y de año", () => {
    expect(weekStart("2027-01-01")).toBe("2026-12-28"); // viernes
    expect(weekStart("2026-12-01")).toBe("2026-11-30"); // martes
  });
});

describe("daysLeftInWeek", () => {
  it("cuenta el día de hoy: lunes = 7 … domingo = 1", () => {
    expect(daysLeftInWeek("2026-11-09")).toBe(7);
    expect(daysLeftInWeek("2026-11-10")).toBe(6);
    expect(daysLeftInWeek("2026-11-12")).toBe(4);
    expect(daysLeftInWeek("2026-11-15")).toBe(1);
  });
});

describe("weekDays", () => {
  it("devuelve las 7 fechas de lunes a domingo", () => {
    expect(weekDays("2026-11-09")).toEqual([
      "2026-11-09",
      "2026-11-10",
      "2026-11-11",
      "2026-11-12",
      "2026-11-13",
      "2026-11-14",
      "2026-11-15",
    ]);
  });

  it("cruza el fin de año", () => {
    expect(weekDays("2026-12-28")).toEqual([
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
      "2027-01-03",
    ]);
  });
});

describe("isValidLocalDate", () => {
  it("acepta fechas reales en formato YYYY-MM-DD", () => {
    expect(isValidLocalDate("2026-11-09")).toBe(true);
    expect(isValidLocalDate("2028-02-29")).toBe(true);
  });

  it("rechaza fechas inexistentes o con otro formato", () => {
    expect(isValidLocalDate("2026-02-29")).toBe(false);
    expect(isValidLocalDate("2026-13-01")).toBe(false);
    expect(isValidLocalDate("2026-00-10")).toBe(false);
    expect(isValidLocalDate("2026-11-9")).toBe(false);
    expect(isValidLocalDate("2026-11-09T00:00:00Z")).toBe(false);
    expect(isValidLocalDate("")).toBe(false);
  });
});

describe("parseDecimal", () => {
  it("acepta coma y punto decimales", () => {
    expect(parseDecimal("57,5")).toBe(57.5);
    expect(parseDecimal("57.5")).toBe(57.5);
    expect(parseDecimal("0,25")).toBe(0.25);
  });

  it("ignora los espacios alrededor", () => {
    expect(parseDecimal(" 60 ")).toBe(60);
  });

  it("acepta enteros, negativos y formas incompletas al teclear", () => {
    expect(parseDecimal("8")).toBe(8);
    expect(parseDecimal("-2,5")).toBe(-2.5);
    expect(parseDecimal("5,")).toBe(5);
    expect(parseDecimal(",5")).toBe(0.5);
  });

  it("devuelve null con texto vacío", () => {
    expect(parseDecimal("")).toBeNull();
    expect(parseDecimal("   ")).toBeNull();
  });

  it("devuelve null con texto que no es un número", () => {
    expect(parseDecimal("abc")).toBeNull();
    expect(parseDecimal("12kg")).toBeNull();
    expect(parseDecimal("1,2,3")).toBeNull();
    expect(parseDecimal("1 000")).toBeNull();
    expect(parseDecimal("0x10")).toBeNull();
    expect(parseDecimal(",")).toBeNull();
    expect(parseDecimal("-")).toBeNull();
  });

  it("devuelve null con valores no finitos o en notación científica", () => {
    expect(parseDecimal("Infinity")).toBeNull();
    expect(parseDecimal("-Infinity")).toBeNull();
    expect(parseDecimal("NaN")).toBeNull();
    expect(parseDecimal("1e5")).toBeNull();
    expect(parseDecimal("9".repeat(400))).toBeNull();
  });
});

describe("formatThousands", () => {
  it("agrupa con punto también los números de 4 cifras", () => {
    expect(formatThousands(4210)).toBe("4.210");
    expect(formatThousands(8000)).toBe("8.000");
  });

  it("no agrupa los de menos de 4 cifras", () => {
    expect(formatThousands(999)).toBe("999");
    expect(formatThousands(0)).toBe("0");
  });

  it("agrupa los números grandes", () => {
    expect(formatThousands(1234567)).toBe("1.234.567");
  });
});
