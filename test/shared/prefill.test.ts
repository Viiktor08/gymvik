import { describe, expect, it } from "vitest";
import { formatLast, lastPerformance, prefillSets } from "../../src/shared/prefill";
import type { SetEntry, Workout } from "../../src/shared/types";

function strength(weightKg: number | null, reps: number | null, rir: number | null = null): SetEntry {
  return { weightKg, reps, rir, durationMin: null, distanceKm: null };
}

function cardio(durationMin: number | null, distanceKm: number | null): SetEntry {
  return { weightKg: null, reps: null, rir: null, durationMin, distanceKm };
}

function workout(id: string, startedAt: string, exercises: Workout["exercises"]): Workout {
  return {
    id,
    routineId: null,
    startedAt,
    endedAt: startedAt,
    localDate: startedAt.slice(0, 10),
    notes: "",
    source: "live",
    exercises,
  };
}

describe("lastPerformance", () => {
  it("devuelve las series de la sesión más reciente por startedAt, no por el orden de la lista", () => {
    const workouts = [
      workout("new", "2026-11-05T17:00:00Z", [{ exerciseId: "bench", sets: [strength(62.5, 8)] }]),
      workout("old", "2026-11-01T17:00:00Z", [{ exerciseId: "bench", sets: [strength(60, 10)] }]),
      workout("mid", "2026-11-03T17:00:00Z", [{ exerciseId: "bench", sets: [strength(60, 9)] }]),
    ];
    expect(lastPerformance("bench", workouts)).toEqual([strength(62.5, 8)]);
  });

  it("ignora las sesiones más recientes en las que no aparece el ejercicio", () => {
    const workouts = [
      workout("a", "2026-11-01T17:00:00Z", [{ exerciseId: "bench", sets: [strength(60, 10)] }]),
      workout("b", "2026-11-05T17:00:00Z", [{ exerciseId: "squat", sets: [strength(100, 5)] }]),
    ];
    expect(lastPerformance("bench", workouts)).toEqual([strength(60, 10)]);
  });

  it("compara instantes, no texto: respeta el desfase horario", () => {
    const workouts = [
      // 2026-11-05T23:30 en +02:00 son las 21:30Z; la otra es posterior (22:00Z) aunque como texto sea menor.
      workout("a", "2026-11-05T23:30:00+02:00", [{ exerciseId: "bench", sets: [strength(60, 10)] }]),
      workout("b", "2026-11-05T22:00:00Z", [{ exerciseId: "bench", sets: [strength(65, 6)] }]),
    ];
    expect(lastPerformance("bench", workouts)).toEqual([strength(65, 6)]);
  });

  it("si el ejercicio se repite en el entreno más reciente usa su primera aparición", () => {
    const workouts = [
      workout("a", "2026-11-05T17:00:00Z", [
        { exerciseId: "bench", sets: [strength(60, 10)] },
        { exerciseId: "squat", sets: [strength(100, 5)] },
        { exerciseId: "bench", sets: [strength(40, 15)] },
      ]),
    ];
    expect(lastPerformance("bench", workouts)).toEqual([strength(60, 10)]);
  });

  it("devuelve null si el ejercicio nunca se hizo o no hay entrenos", () => {
    expect(lastPerformance("bench", [])).toBeNull();
    expect(
      lastPerformance("bench", [workout("a", "2026-11-01T17:00:00Z", [{ exerciseId: "squat", sets: [strength(100, 5)] }])]),
    ).toBeNull();
  });

  it("ignora un startedAt inválido en favor de uno válido", () => {
    const workouts = [
      workout("bad", "no-es-fecha", [{ exerciseId: "bench", sets: [strength(1, 1)] }]),
      workout("ok", "2026-11-01T17:00:00Z", [{ exerciseId: "bench", sets: [strength(60, 10)] }]),
    ];
    expect(lastPerformance("bench", workouts)).toEqual([strength(60, 10)]);
  });
});

describe("prefillSets", () => {
  it("repite la última serie cuando la rutina pide más que las del historial", () => {
    const result = prefillSets({ sets: 3, repsTarget: "8-10" }, [strength(60, 10), strength(60, 9)], "strength");
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ ...strength(60, 10), done: false });
    expect(result[1]).toEqual({ ...strength(60, 9), done: false });
    expect(result[2]).toEqual(result[1]);
  });

  it("devuelve exactamente item.sets filas: recorta si el historial tiene más series", () => {
    const last = [strength(60, 10), strength(60, 9), strength(57.5, 8), strength(55, 8)];
    const result = prefillSets({ sets: 2, repsTarget: "8-10" }, last, "strength");
    expect(result).toEqual([
      { ...strength(60, 10), done: false },
      { ...strength(60, 9), done: false },
    ]);
  });

  it("todas las series empiezan sin hacer, también si en el historial se copian de series hechas", () => {
    const result = prefillSets({ sets: 3, repsTarget: "10" }, [strength(60, 10), strength(60, 9)], "strength");
    expect(result.every((s) => s.done === false)).toBe(true);
  });

  it("no comparte objetos con el historial", () => {
    const last = [strength(60, 10)];
    const result = prefillSets({ sets: 2, repsTarget: "10" }, last, "strength");
    expect(result[0]).not.toBe(last[0]);
    expect(result[0]).not.toBe(result[1]);
  });

  it("copia también cardio con el historial", () => {
    const result = prefillSets({ sets: 1, repsTarget: "20 min" }, [cardio(30, 5)], "cardio");
    expect(result).toEqual([{ ...cardio(30, 5), done: false }]);
  });

  it("sin historial: peso null y repeticiones = primer entero del objetivo", () => {
    const result = prefillSets({ sets: 3, repsTarget: "8-10" }, null, "strength");
    expect(result).toHaveLength(3);
    for (const set of result) {
      expect(set).toEqual({ weightKg: null, reps: 8, rir: null, durationMin: null, distanceKm: null, done: false });
    }
  });

  it("sin historial y sin número en el objetivo: repeticiones null", () => {
    const result = prefillSets({ sets: 2, repsTarget: "" }, null, "strength");
    expect(result.map((s) => s.reps)).toEqual([null, null]);
    expect(prefillSets({ sets: 1, repsTarget: "al fallo" }, null, "strength")[0]?.reps).toBeNull();
  });

  it("un historial vacío se trata como sin historial", () => {
    expect(prefillSets({ sets: 1, repsTarget: "12" }, [], "strength")).toEqual([
      { weightKg: null, reps: 12, rir: null, durationMin: null, distanceKm: null, done: false },
    ]);
  });

  it("cardio sin historial: durationMin = primer entero del objetivo y reps y peso null", () => {
    const result = prefillSets({ sets: 1, repsTarget: "20 min" }, null, "cardio");
    expect(result).toEqual([{ weightKg: null, reps: null, rir: null, durationMin: 20, distanceKm: null, done: false }]);
  });

  it("cardio sin historial y sin número: durationMin null", () => {
    expect(prefillSets({ sets: 1, repsTarget: "" }, null, "cardio")[0]?.durationMin).toBeNull();
  });

  it("sin series devuelve una lista vacía", () => {
    expect(prefillSets({ sets: 0, repsTarget: "10" }, [strength(60, 10)], "strength")).toEqual([]);
  });
});

describe("formatLast", () => {
  it("fuerza: peso×reps con coma decimal", () => {
    expect(formatLast([strength(60, 10), strength(60, 9), strength(57.5, 8)], "strength")).toBe(
      "60×10 · 60×9 · 57,5×8",
    );
  });

  it("las series sin peso salen como N reps, también con peso 0", () => {
    expect(formatLast([strength(null, 12), strength(0, 10)], "core")).toBe("12 reps · 10 reps");
  });

  it("ignora el RIR", () => {
    expect(formatLast([strength(60, 10, 2)], "strength")).toBe("60×10");
  });

  it("cardio: minutos y kilómetros", () => {
    expect(formatLast([cardio(30, 5)], "cardio")).toBe("30 min · 5 km");
  });

  it("cardio: coma decimal en los km", () => {
    expect(formatLast([cardio(30, 5.25)], "cardio")).toBe("30 min · 5,25 km");
  });

  it("cardio sin distancia muestra solo los minutos", () => {
    expect(formatLast([cardio(30, null)], "cardio")).toBe("30 min");
    expect(formatLast([cardio(30, 0)], "cardio")).toBe("30 min");
  });

  it("varias series de cardio se unen con ·", () => {
    expect(formatLast([cardio(10, 2), cardio(20, null)], "cardio")).toBe("10 min · 2 km · 20 min");
  });

  it("lista vacía devuelve cadena vacía", () => {
    expect(formatLast([], "strength")).toBe("");
    expect(formatLast([], "cardio")).toBe("");
  });

  it("nunca muestra NaN ni Infinity", () => {
    const text = formatLast([strength(Number.NaN, 10), strength(60, Number.POSITIVE_INFINITY), strength(null, null)], "strength");
    expect(text).not.toMatch(/NaN|Infinity/);
  });
});
