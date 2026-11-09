import { describe, expect, it } from "vitest";
import { addDays } from "../../src/shared/dates";
import { streakWeeks, weekProgress } from "../../src/shared/streak";

// Hoy es jueves 12 de noviembre de 2026. Las semanas empiezan en lunes.
const TODAY = "2026-11-12";
const CURRENT = "2026-11-09";
const WEEK_1_AGO = "2026-11-02";
const WEEK_2_AGO = "2026-10-26";
const WEEK_3_AGO = "2026-10-19";

// `n` entrenos en días distintos de la semana que empieza en `monday` (lunes, martes…).
function inWeek(monday: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addDays(monday, i));
}

describe("weekProgress", () => {
  it("cuenta los entrenos de la semana y marca los días de lunes a domingo", () => {
    const dates = ["2026-11-09", "2026-11-11", "2026-11-11"];
    expect(weekProgress(dates, TODAY)).toEqual({
      count: 3,
      days: [true, false, true, false, false, false, false],
    });
  });

  it("sin entrenos devuelve cero y siete días sin marcar", () => {
    expect(weekProgress([], TODAY)).toEqual({
      count: 0,
      days: [false, false, false, false, false, false, false],
    });
  });

  it("ignora los entrenos de otras semanas", () => {
    // Domingo de la semana anterior y lunes de la siguiente quedan fuera.
    const dates = ["2026-11-08", "2026-11-10", "2026-11-16"];
    expect(weekProgress(dates, TODAY)).toEqual({
      count: 1,
      days: [false, true, false, false, false, false, false],
    });
  });

  it("da lo mismo desde el lunes que desde el domingo de la misma semana", () => {
    const dates = ["2026-11-15", "2026-11-09"];
    const expected = { count: 2, days: [true, false, false, false, false, false, true] };
    expect(weekProgress(dates, "2026-11-09")).toEqual(expected);
    expect(weekProgress(dates, "2026-11-15")).toEqual(expected);
  });

  it("no depende del orden de las fechas", () => {
    const dates = ["2026-11-13", "2026-11-09", "2026-11-11"];
    expect(weekProgress(dates, TODAY)).toEqual(weekProgress([...dates].reverse(), TODAY));
  });
});

describe("streakWeeks", () => {
  it("cuenta las semanas cumplidas anteriores; la actual sin cumplir no rompe la racha", () => {
    const dates = [
      ...inWeek(WEEK_3_AGO, 3),
      ...inWeek(WEEK_2_AGO, 4),
      ...inWeek(WEEK_1_AGO, 3),
      ...inWeek(CURRENT, 1),
    ];
    expect(streakWeeks(dates, 3, TODAY)).toBe(3);
  });

  it("suma 1 en cuanto la semana actual está cumplida", () => {
    const dates = [
      ...inWeek(WEEK_3_AGO, 3),
      ...inWeek(WEEK_2_AGO, 4),
      ...inWeek(WEEK_1_AGO, 3),
      ...inWeek(CURRENT, 3),
    ];
    expect(streakWeeks(dates, 3, TODAY)).toBe(4);
  });

  it("una semana anterior sin cumplir deja la racha en 0", () => {
    const dates = [...inWeek(WEEK_1_AGO, 2), ...inWeek(CURRENT, 1)];
    expect(streakWeeks(dates, 3, TODAY)).toBe(0);
  });

  it("si la semana actual ya está cumplida, la racha es 1 aunque la anterior no lo estuviera", () => {
    const dates = [...inWeek(WEEK_1_AGO, 2), ...inWeek(CURRENT, 3)];
    expect(streakWeeks(dates, 3, TODAY)).toBe(1);
  });

  it("sin entrenos la racha es 0", () => {
    expect(streakWeeks([], 3, TODAY)).toBe(0);
  });

  it("4 entrenos con objetivo 3 cuenta como semana cumplida", () => {
    expect(streakWeeks(inWeek(WEEK_1_AGO, 4), 3, TODAY)).toBe(1);
  });

  it("una semana sin cumplir corta la racha aunque las anteriores sí cumplieran", () => {
    const dates = [...inWeek(WEEK_3_AGO, 3), ...inWeek(WEEK_2_AGO, 1), ...inWeek(WEEK_1_AGO, 3)];
    expect(streakWeeks(dates, 3, TODAY)).toBe(1);
  });

  it("una semana entera sin entrenos corta la racha", () => {
    const dates = [...inWeek(WEEK_3_AGO, 3), ...inWeek(WEEK_1_AGO, 3)];
    expect(streakWeeks(dates, 3, TODAY)).toBe(1);
  });

  it("dos entrenos el mismo día cuentan 2", () => {
    // Lunes, lunes y miércoles: 3 entrenos en la semana anterior.
    const dates = [WEEK_1_AGO, WEEK_1_AGO, addDays(WEEK_1_AGO, 2)];
    expect(streakWeeks(dates, 3, TODAY)).toBe(1);
    expect(streakWeeks(dates, 4, TODAY)).toBe(0);
  });

  it("no depende del orden de las fechas", () => {
    const dates = [
      ...inWeek(CURRENT, 3),
      ...inWeek(WEEK_2_AGO, 4),
      ...inWeek(WEEK_1_AGO, 3),
      ...inWeek(WEEK_3_AGO, 3),
    ];
    expect(streakWeeks(dates, 3, TODAY)).toBe(4);
    expect(streakWeeks([...dates].reverse(), 3, TODAY)).toBe(4);
  });

  it("no cuenta las semanas futuras", () => {
    const future = [...inWeek("2026-11-16", 3), ...inWeek("2026-11-23", 3)];
    expect(streakWeeks(future, 3, TODAY)).toBe(0);
    const dates = [...inWeek(WEEK_1_AGO, 3), ...future];
    expect(streakWeeks(dates, 3, TODAY)).toBe(1);
  });

  it("el domingo pertenece a la semana que termina y el lunes a la que empieza", () => {
    // Domingo 8 y lunes 9: semanas distintas, así que ninguna llega a 2.
    const dates = ["2026-11-08", "2026-11-09"];
    expect(streakWeeks(dates, 2, TODAY)).toBe(0);
    // Lunes 2 a domingo 8 son la misma semana.
    expect(streakWeeks(["2026-11-02", "2026-11-08"], 2, TODAY)).toBe(1);
  });

  it("con objetivo menor que 1 no hay racha y no se queda en bucle", () => {
    expect(streakWeeks(inWeek(WEEK_1_AGO, 3), 0, TODAY)).toBe(0);
    expect(streakWeeks([], -1, TODAY)).toBe(0);
    expect(streakWeeks([], Number.NaN, TODAY)).toBe(0);
  });
});
