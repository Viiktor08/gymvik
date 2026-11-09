import { describe, expect, it } from "vitest";
import type { Category, Exercise, SetEntry, Workout, WorkoutExercise } from "../../src/shared/types";
import { weeklySummary } from "../../src/shared/weekly";

// Semana del lunes 9 al domingo 15 de noviembre de 2026.
const WEEK = "2026-11-09";

function exercise(id: string, category: Category): Exercise {
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

function set(overrides: Partial<SetEntry> = {}): SetEntry {
  return { weightKg: null, reps: null, rir: null, durationMin: null, distanceKm: null, ...overrides };
}

function workout(localDate: string, exercises: WorkoutExercise[] = []): Workout {
  return {
    id: `w-${localDate}-${Math.random()}`,
    routineId: null,
    startedAt: `${localDate}T08:00:00Z`,
    endedAt: `${localDate}T09:00:00Z`,
    localDate,
    notes: "",
    source: "live",
    exercises,
  };
}

const bench = exercise("bench", "strength");
const pullUp = exercise("pull-up", "strength");
const run = exercise("run", "cardio");
const exercises = new Map([bench, pullUp, run].map((e) => [e.id, e]));

function summary(data: {
  workouts?: Workout[];
  steps?: { localDate: string; steps: number }[];
  creatineDates?: string[];
  exercises?: Map<string, Exercise>;
}) {
  return weeklySummary(WEEK, {
    workouts: data.workouts ?? [],
    steps: data.steps ?? [],
    creatineDates: data.creatineDates ?? [],
    exercises: data.exercises ?? exercises,
  });
}

describe("weeklySummary", () => {
  it("sin datos devuelve ceros y pasos medios null", () => {
    expect(summary({})).toEqual({
      workouts: 0,
      volumeKg: 0,
      cardioMin: 0,
      cardioKm: 0,
      avgSteps: null,
      creatineDays: 0,
    });
  });

  it("suma el volumen como peso por repeticiones de las series de fuerza", () => {
    const w = workout("2026-11-09", [
      { exerciseId: "bench", sets: [set({ weightKg: 60, reps: 10 }), set({ weightKg: 62.5, reps: 8 })] },
    ]);
    const result = summary({ workouts: [w] });
    expect(result.workouts).toBe(1);
    expect(result.volumeKg).toBe(60 * 10 + 62.5 * 8);
  });

  it("las dominadas sin lastre (weightKg null) no suman volumen ni producen NaN", () => {
    const w = workout("2026-11-10", [
      { exerciseId: "pull-up", sets: [set({ weightKg: null, reps: 8 }), set({ weightKg: null, reps: 6 })] },
    ]);
    const result = summary({ workouts: [w] });
    expect(result.volumeKg).toBe(0);
    expect(Number.isNaN(result.volumeKg)).toBe(false);
    expect(result.workouts).toBe(1);
  });

  it("solo suma las series con peso y repeticiones mayores que 0", () => {
    const w = workout("2026-11-10", [
      {
        exerciseId: "bench",
        sets: [
          set({ weightKg: 0, reps: 10 }),
          set({ weightKg: 50, reps: 0 }),
          set({ weightKg: 50, reps: null }),
          set({ weightKg: -20, reps: 10 }),
          set({ weightKg: 40, reps: 5 }),
        ],
      },
    ]);
    expect(summary({ workouts: [w] }).volumeKg).toBe(200);
  });

  it("suma minutos y kilómetros de cardio sin contarlos como volumen", () => {
    const w1 = workout("2026-11-09", [
      { exerciseId: "run", sets: [set({ durationMin: 20, distanceKm: 3 })] },
    ]);
    const w2 = workout("2026-11-13", [
      {
        exerciseId: "run",
        // Un cardio con peso y repeticiones (dato raro) tampoco debe entrar en el volumen.
        sets: [set({ durationMin: 30, distanceKm: 5, weightKg: 10, reps: 10 }), set({ durationMin: 10 })],
      },
    ]);
    expect(summary({ workouts: [w1, w2] })).toMatchObject({
      workouts: 2,
      volumeKg: 0,
      cardioMin: 60,
      cardioKm: 8,
    });
  });

  it("la fuerza no aporta minutos ni kilómetros de cardio", () => {
    const w = workout("2026-11-09", [
      { exerciseId: "bench", sets: [set({ weightKg: 50, reps: 10, durationMin: 5, distanceKm: 1 })] },
    ]);
    expect(summary({ workouts: [w] })).toMatchObject({ volumeKg: 500, cardioMin: 0, cardioKm: 0 });
  });

  it("un ejercicio que no está en el mapa no cuenta como cardio", () => {
    const w = workout("2026-11-09", [
      {
        exerciseId: "borrado",
        sets: [set({ durationMin: 25, distanceKm: 4 }), set({ weightKg: 20, reps: 10 })],
      },
    ]);
    expect(summary({ workouts: [w] })).toMatchObject({ volumeKg: 200, cardioMin: 0, cardioKm: 0 });
  });

  it("cuenta dos entrenos del mismo día y los entrenos sin ejercicios", () => {
    const result = summary({ workouts: [workout("2026-11-11"), workout("2026-11-11")] });
    expect(result.workouts).toBe(2);
  });

  it("solo suma lo que cae en los 7 días de la semana", () => {
    const lift = [{ exerciseId: "bench", sets: [set({ weightKg: 100, reps: 10 })] }];
    const cardio = [{ exerciseId: "run", sets: [set({ durationMin: 30, distanceKm: 5 })] }];
    const workouts = [
      // Dentro: el lunes y el domingo.
      workout("2026-11-09", lift),
      workout("2026-11-15", cardio),
      // Fuera: el domingo anterior y el lunes siguiente.
      workout("2026-11-08", lift),
      workout("2026-11-16", cardio),
    ];
    const result = summary({
      workouts,
      steps: [
        { localDate: "2026-11-08", steps: 20000 },
        { localDate: "2026-11-09", steps: 6000 },
        { localDate: "2026-11-15", steps: 8000 },
        { localDate: "2026-11-16", steps: 30000 },
      ],
      creatineDates: ["2026-11-08", "2026-11-09", "2026-11-16"],
    });
    expect(result).toEqual({
      workouts: 2,
      volumeKg: 1000,
      cardioMin: 30,
      cardioKm: 5,
      avgSteps: 7000,
      creatineDays: 1,
    });
  });

  it("los pasos medios son la media de los días con datos", () => {
    const result = summary({
      steps: [
        { localDate: "2026-11-09", steps: 8000 },
        { localDate: "2026-11-10", steps: 10000 },
        { localDate: "2026-11-12", steps: 12000 },
      ],
    });
    expect(result.avgSteps).toBe(10000);
  });

  it("un día con 0 pasos es un día con datos", () => {
    const result = summary({
      steps: [
        { localDate: "2026-11-09", steps: 0 },
        { localDate: "2026-11-10", steps: 6000 },
      ],
    });
    expect(result.avgSteps).toBe(3000);
  });

  it("los días de creatina no se repiten", () => {
    const result = summary({
      creatineDates: ["2026-11-09", "2026-11-09", "2026-11-10", "2026-11-14"],
    });
    expect(result.creatineDays).toBe(3);
  });
});
