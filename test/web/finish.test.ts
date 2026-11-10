import { describe, expect, it } from "vitest";
import type { DraftSet, Exercise } from "../../src/shared/types";
import type { Draft } from "../../src/web/session/draftStore";
import { buildWorkout, countDoneSets, describeRecord, doneExercises, groupRecords, sessionTotals, structureOf } from "../../src/web/session/finish";

function row(weightKg: number | null, reps: number | null, done: boolean, extra: Partial<DraftSet> = {}): DraftSet {
  return { weightKg, reps, rir: null, durationMin: null, distanceKm: null, done, ...extra };
}

function exercise(id: string, name: string, category: Exercise["category"] = "strength"): Exercise {
  return { id, name, category, muscle: "", description: "", mediaUrl: null, isCustom: false, archived: false };
}

const CATALOG = new Map(
  [exercise("press", "Press banca"), exercise("fondos", "Fondos"), exercise("run", "Correr", "cardio")].map((e) => [e.id, e]),
);

const DRAFT: Draft = {
  id: "w-1",
  routineId: "r-1",
  startedAt: "2026-11-10T08:00:00.000Z",
  exercises: [
    { exerciseId: "press", restSeconds: 90, sets: [row(60, 10, true), row(60, 9, true), row(57.5, 8, false)] },
    { exerciseId: "fondos", restSeconds: 60, sets: [row(null, 12, false), row(null, 12, false)] },
    { exerciseId: "run", restSeconds: 0, sets: [row(null, null, true, { durationMin: 30, distanceKm: 5.2 })] },
  ],
};

const ENDED = new Date("2026-11-10T09:05:20.000Z");

describe("doneExercises", () => {
  it("solo deja las series marcadas, sin el campo done, y quita los ejercicios sin ninguna", () => {
    expect(doneExercises(DRAFT)).toEqual([
      {
        exerciseId: "press",
        sets: [
          { weightKg: 60, reps: 10, rir: null, durationMin: null, distanceKm: null },
          { weightKg: 60, reps: 9, rir: null, durationMin: null, distanceKm: null },
        ],
      },
      { exerciseId: "run", sets: [{ weightKg: null, reps: null, rir: null, durationMin: 30, distanceKm: 5.2 }] },
    ]);
  });

  it("corrige lo que el servidor rechazaría, para que un 400 no haga perder el entreno", () => {
    const odd: Draft = {
      ...DRAFT,
      exercises: [
        {
          exerciseId: "press",
          restSeconds: 90,
          sets: [
            row(-5, 8.6, true, { rir: 12 }),
            row(Number.NaN, -2, true, { rir: -1, durationMin: -3, distanceKm: Number.POSITIVE_INFINITY }),
            row(0, 0, true, { rir: 0 }),
          ],
        },
      ],
    };

    expect(doneExercises(odd)[0]?.sets).toEqual([
      { weightKg: null, reps: 9, rir: 10, durationMin: null, distanceKm: null },
      { weightKg: null, reps: null, rir: null, durationMin: null, distanceKm: null },
      { weightKg: 0, reps: 0, rir: 0, durationMin: null, distanceKm: null },
    ]);
  });

  it("sin ninguna serie marcada no queda nada", () => {
    const none: Draft = { ...DRAFT, exercises: [{ exerciseId: "press", restSeconds: 90, sets: [row(60, 10, false)] }] };

    expect(doneExercises(none)).toEqual([]);
    expect(countDoneSets(none)).toBe(0);
  });
});

describe("countDoneSets", () => {
  it("cuenta las series marcadas de todos los ejercicios", () => {
    expect(countDoneSets(DRAFT)).toBe(3);
  });
});

describe("buildWorkout", () => {
  it("monta el entreno con el id y el inicio del borrador, el final y las notas", () => {
    const workout = buildWorkout(DRAFT, { endedAt: ENDED, notes: "Buen día", timeZone: "Europe/Madrid" });

    expect(workout).toMatchObject({
      id: "w-1",
      routineId: "r-1",
      startedAt: "2026-11-10T08:00:00.000Z",
      endedAt: "2026-11-10T09:05:20.000Z",
      notes: "Buen día",
      source: "live",
    });
    expect(workout.exercises).toEqual(doneExercises(DRAFT));
  });

  it("la fecha local sale de la zona horaria, no de UTC", () => {
    const late: Draft = { ...DRAFT, startedAt: "2026-11-09T23:30:00.000Z" };

    expect(buildWorkout(late, { endedAt: ENDED, notes: "", timeZone: "Europe/Madrid" }).localDate).toBe("2026-11-10");
    expect(buildWorkout(late, { endedAt: ENDED, notes: "", timeZone: "UTC" }).localDate).toBe("2026-11-09");
  });

  it("un entreno libre conserva routineId null", () => {
    const free: Draft = { ...DRAFT, routineId: null };

    expect(buildWorkout(free, { endedAt: ENDED, notes: "", timeZone: "UTC" }).routineId).toBeNull();
  });
});

describe("structureOf", () => {
  it("es la lista de ejercicios con el número de filas del borrador, marcadas o no", () => {
    expect(structureOf(DRAFT)).toEqual([
      { exerciseId: "press", sets: 3 },
      { exerciseId: "fondos", sets: 2 },
      { exerciseId: "run", sets: 1 },
    ]);
  });

  it("no pasa de 20 series por ejercicio (el máximo de una rutina)", () => {
    const many: Draft = {
      ...DRAFT,
      exercises: [{ exerciseId: "press", restSeconds: 90, sets: Array.from({ length: 25 }, () => row(60, 10, false)) }],
    };

    expect(structureOf(many)).toEqual([{ exerciseId: "press", sets: 20 }]);
  });
});

describe("sessionTotals", () => {
  it("calcula duración, volumen, series y cardio con las reglas compartidas", () => {
    const workout = buildWorkout(DRAFT, { endedAt: ENDED, notes: "", timeZone: "Europe/Madrid" });

    expect(sessionTotals(workout, CATALOG)).toEqual({
      durationMin: 65,
      volumeKg: 1140,
      sets: 3,
      cardioMin: 30,
      cardioKm: 5.2,
    });
  });

  it("el volumen del cardio no cuenta aunque tenga peso", () => {
    const workout = buildWorkout(
      { ...DRAFT, exercises: [{ exerciseId: "run", restSeconds: 0, sets: [row(10, 10, true, { durationMin: 30 })] }] },
      { endedAt: ENDED, notes: "", timeZone: "UTC" },
    );

    expect(sessionTotals(workout, CATALOG).volumeKg).toBe(0);
  });

  it("sin ruido de coma flotante en el volumen", () => {
    const workout = buildWorkout(
      { ...DRAFT, exercises: [{ exerciseId: "press", restSeconds: 90, sets: [row(0.1, 3, true), row(0.2, 3, true)] }] },
      { endedAt: ENDED, notes: "", timeZone: "UTC" },
    );

    expect(sessionTotals(workout, CATALOG).volumeKg).toBe(0.9);
  });

  it("si el final no es posterior al inicio, la duración es 0, nunca negativa ni NaN", () => {
    const workout = buildWorkout(DRAFT, { endedAt: new Date("2026-11-10T07:00:00.000Z"), notes: "", timeZone: "UTC" });

    expect(sessionTotals(workout, CATALOG).durationMin).toBe(0);
  });
});

describe("describeRecord", () => {
  const names = new Map([["press", "Press banca"], ["run", "Correr"]]);

  it("escribe cada tipo de récord con su unidad y coma decimal", () => {
    expect(describeRecord({ exerciseId: "press", kind: "maxWeight", value: 62.5 }, names)).toEqual({
      name: "Press banca",
      label: "Peso máximo: 62,5 kg",
    });
    expect(describeRecord({ exerciseId: "press", kind: "best1RM", value: 80 }, names).label).toBe("1RM estimado: 80 kg");
    expect(describeRecord({ exerciseId: "press", kind: "volume", value: 4210 }, names).label).toBe("Volumen: 4.210 kg");
    expect(describeRecord({ exerciseId: "run", kind: "maxDistance", value: 5.2 }, names).label).toBe("Mayor distancia: 5,2 km");
    expect(describeRecord({ exerciseId: "run", kind: "bestPace", value: 5.5 }, names).label).toBe("Mejor ritmo: 5:30 min/km");
  });

  it("un ejercicio sin nombre se llama Ejercicio", () => {
    expect(describeRecord({ exerciseId: "x", kind: "maxWeight", value: 10 }, names).name).toBe("Ejercicio");
  });
});

describe("groupRecords", () => {
  const names = new Map([["press", "Press banca"], ["run", "Correr"]]);

  it("junta los récords de un mismo ejercicio y respeta el orden de aparición", () => {
    expect(
      groupRecords(
        [
          { exerciseId: "press", kind: "maxWeight", value: 62.5 },
          { exerciseId: "run", kind: "maxDistance", value: 5.2 },
          { exerciseId: "press", kind: "volume", value: 1220 },
        ],
        names,
      ),
    ).toEqual([
      { name: "Press banca", labels: ["Peso máximo: 62,5 kg", "Volumen: 1.220 kg"] },
      { name: "Correr", labels: ["Mayor distancia: 5,2 km"] },
    ]);
  });

  it("sin récords, lista vacía", () => {
    expect(groupRecords([], names)).toEqual([]);
  });
});
