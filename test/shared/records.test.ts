import { describe, expect, it } from "vitest";
import {
  epley1RM,
  exerciseRecords,
  newRecords,
  sessionStats,
} from "../../src/shared/records";
import type { Exercise, SetEntry, Workout, WorkoutExercise } from "../../src/shared/types";

const NO_STATS = { maxWeight: null, best1RM: null, volume: 0, maxDistance: null, bestPace: null };

function exercise(id: string, category: Exercise["category"]): Exercise {
  return {
    id,
    name: id,
    category,
    muscle: "",
    description: "",
    mediaUrl: null,
    isCustom: false,
    archived: false,
  };
}

const EXERCISES = new Map<string, Exercise>([
  ["bench", exercise("bench", "strength")],
  ["squat", exercise("squat", "strength")],
  ["plank", exercise("plank", "core")],
  ["run", exercise("run", "cardio")],
]);

function strengthSet(weightKg: number | null, reps: number | null): SetEntry {
  return { weightKg, reps, rir: null, durationMin: null, distanceKm: null };
}

function cardioSet(durationMin: number | null, distanceKm: number | null): SetEntry {
  return { weightKg: null, reps: null, rir: null, durationMin, distanceKm };
}

function we(exerciseId: string, ...sets: SetEntry[]): WorkoutExercise {
  return { exerciseId, sets };
}

// Entreno de `day` de noviembre de 2026 a las 18:00 UTC; `id` es único por día salvo que se indique.
function workout(day: number, exercises: WorkoutExercise[], id = `w-${day}`): Workout {
  const dd = String(day).padStart(2, "0");
  return {
    id,
    routineId: null,
    startedAt: `2026-11-${dd}T18:00:00.000Z`,
    endedAt: `2026-11-${dd}T19:00:00.000Z`,
    localDate: `2026-11-${dd}`,
    notes: "",
    source: "live",
    exercises,
  };
}

describe("epley1RM", () => {
  it("con una repetición el resultado es el propio peso", () => {
    expect(epley1RM(100, 1)).toBe(100);
  });

  it("aplica w × (1 + r/30) y redondea al 0,5 kg más cercano", () => {
    expect(epley1RM(80, 10)).toBe(106.5); // 106,67
    expect(epley1RM(100, 5)).toBe(116.5); // 116,67
    expect(epley1RM(60, 10)).toBe(80); // exacto
    expect(epley1RM(62.5, 8)).toBe(79); // 79,17
  });

  it("devuelve null si el peso es null o no es mayor que 0", () => {
    expect(epley1RM(0, 10)).toBeNull();
    expect(epley1RM(null, 10)).toBeNull();
    expect(epley1RM(-20, 10)).toBeNull();
  });

  it("devuelve null si las repeticiones son null, 0 o negativas", () => {
    expect(epley1RM(100, null)).toBeNull();
    expect(epley1RM(100, 0)).toBeNull();
    expect(epley1RM(100, -3)).toBeNull();
  });

  it("devuelve null con valores no finitos en vez de Infinity o NaN", () => {
    expect(epley1RM(Number.POSITIVE_INFINITY, 5)).toBeNull();
    expect(epley1RM(100, Number.POSITIVE_INFINITY)).toBeNull();
    expect(epley1RM(Number.NaN, 5)).toBeNull();
    expect(epley1RM(100, Number.NaN)).toBeNull();
  });
});

describe("sessionStats", () => {
  it("un ejercicio sin series no tiene estadísticas", () => {
    expect(sessionStats({ exerciseId: "plank", sets: [] })).toEqual(NO_STATS);
  });

  it("fuerza: peso máximo, mejor 1RM y volumen de las series con peso y repeticiones", () => {
    const stats = sessionStats(we("bench", strengthSet(60, 10), strengthSet(70, 5), strengthSet(62.5, 8)));
    expect(stats).toEqual({
      ...NO_STATS,
      maxWeight: 70,
      best1RM: 81.5, // 70 × (1 + 5/30) = 81,67; el 60×10 da 80
      volume: 600 + 350 + 500,
    });
  });

  it("el 1RM y el peso máximo pueden venir de series distintas", () => {
    // 100×1 da 100 de 1RM; 90×8 da 114 de 1RM.
    const stats = sessionStats(we("bench", strengthSet(100, 1), strengthSet(90, 8)));
    expect(stats.maxWeight).toBe(100);
    expect(stats.best1RM).toBe(114);
  });

  it("el peso corporal (peso null) no genera peso, 1RM ni volumen", () => {
    expect(sessionStats(we("pullup", strengthSet(null, 10), strengthSet(null, 8)))).toEqual(NO_STATS);
  });

  it("una serie con 0 repeticiones no cuenta y nada sale Infinity ni NaN", () => {
    const stats = sessionStats(we("bench", strengthSet(100, 0), strengthSet(80, null)));
    expect(stats).toEqual(NO_STATS);
  });

  it("ignora las series con valores no finitos", () => {
    const stats = sessionStats(
      we("bench", strengthSet(Number.POSITIVE_INFINITY, 5), strengthSet(60, Number.NaN), strengthSet(60, 5)),
    );
    expect(stats).toEqual({ ...NO_STATS, maxWeight: 60, best1RM: 70, volume: 300 });
  });

  it("cardio: distancia máxima y mejor ritmo en min/km", () => {
    const stats = sessionStats(we("run", cardioSet(25, 5), cardioSet(12, 2), cardioSet(30, 5)));
    expect(stats).toEqual({ ...NO_STATS, maxDistance: 5, bestPace: 5 });
  });

  it("el mejor ritmo es el mínimo min/km entre las series", () => {
    // 6 min/km, 4,5 min/km y 5 min/km.
    const stats = sessionStats(we("run", cardioSet(30, 5), cardioSet(9, 2), cardioSet(20, 4)));
    expect(stats.bestPace).toBe(4.5);
  });

  it("una distancia 0 no da ritmo ni distancia máxima", () => {
    const stats = sessionStats(we("run", cardioSet(20, 0)));
    expect(stats).toEqual(NO_STATS);
  });

  it("sin duración no hay ritmo, pero la distancia sí cuenta", () => {
    const stats = sessionStats(we("run", cardioSet(null, 5), cardioSet(0, 3)));
    expect(stats).toEqual({ ...NO_STATS, maxDistance: 5, bestPace: null });
  });

  it("el redondeo del volumen evita diferencias por el orden de las series", () => {
    // Sumados sin redondear, estos dos órdenes difieren en el último decimal (112,8 y 112,80000000000001).
    const a = sessionStats(we("bench", strengthSet(2.3, 8), strengthSet(4.7, 8), strengthSet(7.1, 8)));
    const b = sessionStats(we("bench", strengthSet(7.1, 8), strengthSet(4.7, 8), strengthSet(2.3, 8)));
    expect(a.volume).toBe(112.8);
    expect(b.volume).toBe(112.8);
  });
});

describe("newRecords", () => {
  it("la primera vez que se hace un ejercicio no hay récords", () => {
    const current = workout(10, [we("bench", strengthSet(60, 10))]);
    expect(newRecords(current, [], EXERCISES)).toEqual([]);
  });

  it("un ejercicio sin historial propio no celebra nada aunque haya otros entrenos", () => {
    const previous = [workout(3, [we("squat", strengthSet(100, 5))])];
    const current = workout(10, [we("bench", strengthSet(60, 10))]);
    expect(newRecords(current, previous, EXERCISES)).toEqual([]);
  });

  it("solo salen los tipos que se superan: 62,5×8 tras 60×10 es solo peso máximo", () => {
    const previous = [workout(3, [we("bench", strengthSet(60, 10))])];
    const current = workout(10, [we("bench", strengthSet(62.5, 8))]);
    // best1RM 79 < 80 y volumen 500 < 600.
    expect(newRecords(current, previous, EXERCISES)).toEqual([
      { exerciseId: "bench", kind: "maxWeight", value: 62.5 },
    ]);
  });

  it("devuelve todos los récords que se superan a la vez", () => {
    const previous = [workout(3, [we("bench", strengthSet(60, 10))])];
    const current = workout(10, [we("bench", strengthSet(70, 10))]);
    expect(newRecords(current, previous, EXERCISES)).toEqual([
      { exerciseId: "bench", kind: "maxWeight", value: 70 },
      { exerciseId: "bench", kind: "best1RM", value: 93.5 },
      { exerciseId: "bench", kind: "volume", value: 700 },
    ]);
  });

  it("igualar el récord no es un récord nuevo", () => {
    const previous = [workout(3, [we("bench", strengthSet(60, 10))])];
    const current = workout(10, [we("bench", strengthSet(60, 10))]);
    expect(newRecords(current, previous, EXERCISES)).toEqual([]);
  });

  it("compara con el mejor valor de todo el historial, no solo con el último entreno", () => {
    const previous = [
      workout(3, [we("bench", strengthSet(80, 5))]),
      workout(5, [we("bench", strengthSet(60, 5))]),
    ];
    const current = workout(10, [we("bench", strengthSet(70, 5))]);
    expect(newRecords(current, previous, EXERCISES)).toEqual([]);
  });

  it("cardio: correr 5 km en 25 min con un mejor ritmo anterior de 5,5 min/km bate el ritmo", () => {
    const previous = [workout(3, [we("run", cardioSet(27.5, 5))])];
    const current = workout(10, [we("run", cardioSet(25, 5))]);
    // La distancia es la misma (5 km): solo mejora el ritmo.
    expect(newRecords(current, previous, EXERCISES)).toEqual([
      { exerciseId: "run", kind: "bestPace", value: 5 },
    ]);
  });

  it("cardio: un ritmo más lento o igual no es récord, una distancia mayor sí", () => {
    const previous = [workout(3, [we("run", cardioSet(25, 5))])];
    const slower = workout(10, [we("run", cardioSet(36, 6))]); // 6 min/km, 6 km
    expect(newRecords(slower, previous, EXERCISES)).toEqual([
      { exerciseId: "run", kind: "maxDistance", value: 6 },
    ]);
    const same = workout(11, [we("run", cardioSet(25, 5))]);
    expect(newRecords(same, previous, EXERCISES)).toEqual([]);
  });

  it("cardio no genera récords de fuerza, ni los ejercicios de fuerza los de cardio", () => {
    const previous = [
      workout(3, [
        we("run", { ...cardioSet(30, 5), weightKg: 10, reps: 5 }),
        we("bench", { ...strengthSet(60, 5), durationMin: 10, distanceKm: 2 }),
      ]),
    ];
    const current = workout(10, [
      we("run", { ...cardioSet(25, 5), weightKg: 20, reps: 5 }),
      we("bench", { ...strengthSet(70, 5), durationMin: 5, distanceKm: 3 }),
    ]);
    const records = newRecords(current, previous, EXERCISES);
    expect(records.filter((r) => r.exerciseId === "run").map((r) => r.kind)).toEqual(["bestPace"]);
    expect(records.filter((r) => r.exerciseId === "bench").map((r) => r.kind)).toEqual([
      "maxWeight",
      "best1RM",
      "volume",
    ]);
  });

  it("un ejercicio de core sin peso no genera récords de fuerza", () => {
    const previous = [workout(3, [we("plank", strengthSet(null, 30))])];
    const current = workout(10, [we("plank", strengthSet(null, 45))]);
    expect(newRecords(current, previous, EXERCISES)).toEqual([]);
  });

  it("sin valor anterior de ese tipo no hay récord (de peso corporal a lastre)", () => {
    const previous = [workout(3, [we("plank", strengthSet(null, 30))])];
    const current = workout(10, [we("plank", strengthSet(10, 30))]);
    expect(newRecords(current, previous, EXERCISES)).toEqual([]);
  });

  it("sin ritmo anterior (distancia 0) no hay récord de ritmo", () => {
    const previous = [workout(3, [we("run", cardioSet(20, 0))])];
    const current = workout(10, [we("run", cardioSet(25, 5))]);
    expect(newRecords(current, previous, EXERCISES)).toEqual([]);
  });

  it("ignora un entreno anterior con el mismo id (reintento del PUT)", () => {
    const earlier = workout(3, [we("bench", strengthSet(60, 10))]);
    const current = workout(10, [we("bench", strengthSet(70, 10))]);
    // Copia ya guardada del mismo entreno, con otra hora de inicio y más peso: no debe compararse consigo mismo.
    const storedCopy = { ...workout(5, [we("bench", strengthSet(100, 10))]), id: current.id };
    const expected = newRecords(current, [earlier], EXERCISES);
    expect(expected.length).toBeGreaterThan(0);
    expect(newRecords(current, [earlier, storedCopy], EXERCISES)).toEqual(expected);
    expect(newRecords(current, [current], EXERCISES)).toEqual([]);
  });

  it("solo compara con entrenos que empezaron antes", () => {
    const current = workout(10, [we("bench", strengthSet(60, 10))]);
    const later = workout(12, [we("bench", strengthSet(40, 10))]);
    const afterSameInstant = { ...workout(11, [we("bench", strengthSet(40, 10))]), startedAt: current.startedAt };
    expect(newRecords(current, [later, afterSameInstant], EXERCISES)).toEqual([]);

    // Un entreno posterior con menos peso no impide el récord de uno anterior, y uno posterior con más peso no lo quita.
    const earlier = workout(3, [we("bench", strengthSet(50, 10))]);
    const heavierLater = workout(15, [we("bench", strengthSet(100, 10))]);
    expect(newRecords(current, [earlier, heavierLater], EXERCISES).map((r) => r.kind)).toEqual([
      "maxWeight",
      "best1RM",
      "volume",
    ]);
  });

  it("compara instantes y no cadenas: respeta la zona horaria del ISO", () => {
    const current = { ...workout(10, [we("bench", strengthSet(60, 10))]), startedAt: "2026-11-10T10:00:00.000Z" };
    // 11:30+02:00 son las 09:30Z: empezó antes que el actual aunque la cadena sea mayor.
    const earlier = { ...workout(9, [we("bench", strengthSet(50, 10))]), startedAt: "2026-11-10T11:30:00.000+02:00" };
    expect(newRecords(current, [earlier], EXERCISES).map((r) => r.kind)).toContain("maxWeight");
  });

  it("un ejercicio repetido en el mismo entreno se evalúa junto y da como mucho un récord por tipo", () => {
    const previous = [workout(3, [we("bench", strengthSet(60, 10))])];
    const current = workout(10, [
      we("bench", strengthSet(65, 8)),
      we("squat", strengthSet(100, 5)),
      we("bench", strengthSet(70, 6)),
    ]);
    const records = newRecords(current, previous, EXERCISES);
    // Combinado: peso máx. 70, 1RM 84 (70×6) frente a 80, volumen 520 + 420 = 940 frente a 600.
    expect(records).toEqual([
      { exerciseId: "bench", kind: "maxWeight", value: 70 },
      { exerciseId: "bench", kind: "best1RM", value: 84 },
      { exerciseId: "bench", kind: "volume", value: 940 },
    ]);
  });

  it("un ejercicio repetido en un entreno anterior también se combina", () => {
    const previous = [
      workout(3, [we("bench", strengthSet(60, 5)), we("bench", strengthSet(60, 5))]), // volumen 600
    ];
    const current = workout(10, [we("bench", strengthSet(60, 9))]); // volumen 540
    expect(newRecords(current, previous, EXERCISES).map((r) => r.kind)).not.toContain("volume");
  });

  it("ignora los ejercicios que no están en el mapa", () => {
    const previous = [workout(3, [we("ghost", strengthSet(60, 10))])];
    const current = workout(10, [we("ghost", strengthSet(100, 10))]);
    expect(newRecords(current, previous, EXERCISES)).toEqual([]);
  });

  it("no devuelve Infinity ni NaN con repeticiones 0, peso null o distancia 0", () => {
    const previous = [
      workout(3, [
        we("bench", strengthSet(60, 10), strengthSet(null, 0)),
        we("run", cardioSet(20, 0)),
      ]),
    ];
    const current = workout(10, [
      we("bench", strengthSet(100, 0), strengthSet(null, 10), strengthSet(70, 10)),
      we("run", cardioSet(20, 0), cardioSet(null, 4), cardioSet(0, 3)),
    ]);
    const records = newRecords(current, previous, EXERCISES);
    for (const record of records) {
      expect(Number.isFinite(record.value)).toBe(true);
    }
    expect(records.map((r) => r.kind)).toEqual(["maxWeight", "best1RM", "volume"]);
  });
});

describe("exerciseRecords", () => {
  it("sin entrenos no hay récords", () => {
    expect(exerciseRecords("bench", [])).toEqual({});
  });

  it("devuelve el mejor valor de cada tipo con la fecha local en que se logró", () => {
    const workouts = [
      workout(3, [we("bench", strengthSet(60, 10))]), // 1RM 80, volumen 600
      workout(5, [we("bench", strengthSet(80, 3))]), // peso 80, 1RM 88, volumen 240
      workout(7, [we("bench", strengthSet(50, 15), strengthSet(50, 15))]), // volumen 1500
    ];
    expect(exerciseRecords("bench", workouts)).toEqual({
      maxWeight: { value: 80, localDate: "2026-11-05" },
      best1RM: { value: 88, localDate: "2026-11-05" },
      volume: { value: 1500, localDate: "2026-11-07" },
    });
  });

  it("cardio: distancia máxima y mejor ritmo, sin récord de volumen", () => {
    const workouts = [
      workout(3, [we("run", cardioSet(30, 5))]), // 6 min/km, 5 km
      workout(5, [we("run", cardioSet(20, 3))]), // 6,67 min/km, 3 km
      workout(7, [we("run", cardioSet(24, 5), cardioSet(10, 2))]), // 4,8 min/km, 5 km
    ];
    expect(exerciseRecords("run", workouts)).toEqual({
      maxDistance: { value: 5, localDate: "2026-11-03" },
      bestPace: { value: 4.8, localDate: "2026-11-07" },
    });
  });

  it("omite las claves sin valor", () => {
    const workouts = [workout(3, [we("plank", strengthSet(null, 30)), we("run", cardioSet(20, 0))])];
    expect(exerciseRecords("plank", workouts)).toEqual({});
    expect(exerciseRecords("run", workouts)).toEqual({});
  });

  it("en un empate conserva la fecha del primero que lo logró, sin importar el orden de entrada", () => {
    const first = workout(3, [we("bench", strengthSet(60, 10))]);
    const second = workout(8, [we("bench", strengthSet(60, 10))]);
    expect(exerciseRecords("bench", [second, first]).maxWeight).toEqual({ value: 60, localDate: "2026-11-03" });
  });

  it("solo cuenta el ejercicio pedido y combina sus repeticiones dentro de un entreno", () => {
    const workouts = [
      workout(3, [
        we("squat", strengthSet(140, 5)),
        we("bench", strengthSet(60, 5)),
        we("bench", strengthSet(60, 5)),
      ]),
    ];
    expect(exerciseRecords("bench", workouts)).toEqual({
      maxWeight: { value: 60, localDate: "2026-11-03" },
      best1RM: { value: 70, localDate: "2026-11-03" },
      volume: { value: 600, localDate: "2026-11-03" },
    });
  });

  it("no devuelve Infinity ni NaN con repeticiones 0, peso null o distancia 0", () => {
    const workouts = [
      workout(3, [we("bench", strengthSet(100, 0), strengthSet(null, 10)), we("run", cardioSet(20, 0))]),
    ];
    expect(exerciseRecords("bench", workouts)).toEqual({});
    expect(exerciseRecords("run", workouts)).toEqual({});
  });
});
