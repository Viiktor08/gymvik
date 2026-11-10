import { afterEach, describe, expect, it, vi } from "vitest";
import { localDate } from "../../src/shared/dates";
import type { WorkoutExercise } from "../../src/shared/types";
import {
  buildManualWorkout,
  deviceTimeZone,
  groupByWeek,
  manualError,
  manualStartedAt,
  summaryLine,
  weekLabel,
  workoutBody,
  type WorkoutSummary,
} from "../../src/web/historyData";
import {
  addExerciseTo,
  addSetTo,
  cleanExercises,
  removeExerciseAt,
  removeSetFrom,
  setSetField,
} from "../../src/web/workoutEdit";

function summary(id: string, date: string, extra: Partial<WorkoutSummary> = {}): WorkoutSummary {
  return { id, routineName: "Pecho", localDate: date, durationMin: 45, volumeKg: 4210, ...extra };
}

function set(weightKg: number | null, reps: number | null, extra: Partial<WorkoutExercise["sets"][number]> = {}) {
  return { weightKg, reps, rir: null, durationMin: null, distanceKm: null, ...extra };
}

describe("groupByWeek", () => {
  it("agrupa por semana (lunes a domingo): el domingo y el lunes siguiente van en semanas distintas", () => {
    const groups = groupByWeek([
      summary("w-lun", "2026-11-09"),
      summary("w-dom", "2026-11-08"),
      summary("w-sab", "2026-11-07"),
    ]);
    expect(groups.map((group) => [group.weekStart, group.workouts.map((w) => w.id)])).toEqual([
      ["2026-11-09", ["w-lun"]],
      ["2026-11-02", ["w-dom", "w-sab"]],
    ]);
  });

  it("ordena las semanas de más reciente a más antigua y los entrenos de cada semana por fecha descendente", () => {
    const groups = groupByWeek([
      summary("a", "2026-10-27"),
      summary("b", "2026-11-04"),
      summary("c", "2026-11-10"),
      summary("d", "2026-11-02"),
      summary("e", "2026-11-11"),
    ]);
    expect(groups.map((group) => group.weekStart)).toEqual(["2026-11-09", "2026-11-02", "2026-10-26"]);
    expect(groups[0]?.workouts.map((w) => w.id)).toEqual(["e", "c"]);
    expect(groups[1]?.workouts.map((w) => w.id)).toEqual(["b", "d"]);
  });

  it("conserva el orden del servidor cuando dos entrenos son del mismo día", () => {
    const groups = groupByWeek([summary("tarde", "2026-11-10"), summary("manana", "2026-11-10")]);
    expect(groups[0]?.workouts.map((w) => w.id)).toEqual(["tarde", "manana"]);
  });

  it("agrupa bien al cruzar el año (la semana del 29 dic al 4 ene es una sola)", () => {
    const groups = groupByWeek([summary("a", "2026-01-02"), summary("b", "2025-12-30"), summary("c", "2025-12-28")]);
    expect(groups.map((group) => [group.weekStart, group.workouts.map((w) => w.id)])).toEqual([
      ["2025-12-29", ["a", "b"]],
      ["2025-12-22", ["c"]],
    ]);
  });

  it("una lista vacía no da ninguna semana", () => {
    expect(groupByWeek([])).toEqual([]);
  });

  it("no modifica la lista de entrada", () => {
    const input = [summary("a", "2026-11-02"), summary("b", "2026-11-10")];
    groupByWeek(input);
    expect(input.map((w) => w.id)).toEqual(["a", "b"]);
  });
});

describe("weekLabel", () => {
  it("en el año en curso da las dos fechas sin año", () => {
    expect(weekLabel("2026-11-09", 2026)).toBe("Semana del 9 nov al 15 nov");
  });

  it("cruzando de mes usa los dos meses", () => {
    expect(weekLabel("2026-03-30", 2026)).toBe("Semana del 30 mar al 5 abr");
  });

  it("en otro año añade el año a las dos fechas", () => {
    expect(weekLabel("2025-12-29", 2026)).toBe("Semana del 29 dic 2025 al 4 ene 2026");
  });
});

describe("summaryLine", () => {
  it("junta fecha, duración y volumen con puntos medios", () => {
    expect(summaryLine(summary("a", "2026-11-10"))).toBe("Martes, 10 de noviembre · 45 min · 4.210 kg");
  });

  it("sin volumen (cardio) no pone ni 0 kg ni NaN", () => {
    expect(summaryLine(summary("a", "2026-11-10", { volumeKg: 0, durationMin: 65 }))).toBe(
      "Martes, 10 de noviembre · 1 h 05 min",
    );
  });

  it("un volumen con decimales usa la coma", () => {
    expect(summaryLine(summary("a", "2026-11-10", { volumeKg: 1234.5 }))).toContain("1.234,5 kg");
  });
});

describe("manualStartedAt", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("es el mediodía de la fecha en la hora del dispositivo, en UTC con Z (invierno)", () => {
    vi.stubEnv("TZ", "Europe/Madrid");
    expect(manualStartedAt("2026-11-03")).toBe("2026-11-03T11:00:00.000Z");
  });

  it("respeta el horario de verano", () => {
    vi.stubEnv("TZ", "Europe/Madrid");
    expect(manualStartedAt("2026-07-07")).toBe("2026-07-07T10:00:00.000Z");
  });

  it("el día del cambio de hora sigue siendo el mediodía local", () => {
    vi.stubEnv("TZ", "Europe/Madrid");
    expect(manualStartedAt("2026-03-29")).toBe("2026-03-29T10:00:00.000Z");
    expect(manualStartedAt("2026-10-25")).toBe("2026-10-25T11:00:00.000Z");
  });

  it("con otra zona del dispositivo sigue siendo el mediodía de allí", () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    expect(manualStartedAt("2026-11-03")).toBe("2026-11-03T20:00:00.000Z");
  });

  it("la fecha local de ese instante es la fecha elegida", () => {
    vi.stubEnv("TZ", "Europe/Madrid");
    expect(localDate(new Date(manualStartedAt("2026-11-03")), deviceTimeZone())).toBe("2026-11-03");
  });

  it("rechaza una fecha que no existe", () => {
    expect(() => manualStartedAt("2026-02-30")).toThrow(RangeError);
    expect(() => manualStartedAt("")).toThrow(RangeError);
  });
});

describe("buildManualWorkout", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("source manual, startedAt a las 12:00 locales y endedAt = startedAt + la duración", () => {
    vi.stubEnv("TZ", "Europe/Madrid");
    const workout = buildManualWorkout({
      id: "w-1",
      date: "2026-11-03",
      routineId: "r-pecho",
      durationMin: 50,
      exercises: [{ exerciseId: "press", sets: [set(60, 10)] }],
    });
    expect(workout).toEqual({
      id: "w-1",
      routineId: "r-pecho",
      startedAt: "2026-11-03T11:00:00.000Z",
      endedAt: "2026-11-03T11:50:00.000Z",
      localDate: "2026-11-03",
      notes: "",
      source: "manual",
      exercises: [{ exerciseId: "press", sets: [set(60, 10)] }],
    });
  });

  it("un entreno libre y sin series se guarda con exercises vacío", () => {
    const workout = buildManualWorkout({ id: "w-2", date: "2026-11-03", routineId: null, durationMin: 30, exercises: [] });
    expect(workout.routineId).toBeNull();
    expect(workout.exercises).toEqual([]);
  });

  it("una duración larga pasa de medianoche en endedAt sin tocar la fecha", () => {
    vi.stubEnv("TZ", "Europe/Madrid");
    const workout = buildManualWorkout({ id: "w-3", date: "2026-11-03", routineId: null, durationMin: 1440, exercises: [] });
    expect(workout.endedAt).toBe("2026-11-04T11:00:00.000Z");
    expect(workout.localDate).toBe("2026-11-03");
  });

  it("quita las series en blanco y los ejercicios que se quedan sin ninguna", () => {
    const workout = buildManualWorkout({
      id: "w-4",
      date: "2026-11-03",
      routineId: null,
      durationMin: 40,
      exercises: [
        { exerciseId: "press", sets: [set(60, 10), set(null, null)] },
        { exerciseId: "fondos", sets: [set(null, null)] },
      ],
    });
    expect(workout.exercises).toEqual([{ exerciseId: "press", sets: [set(60, 10)] }]);
  });
});

describe("workoutBody", () => {
  it("no manda localDate (lo calcula el servidor) y limpia las series", () => {
    const body = workoutBody({
      id: "w-1",
      routineId: null,
      startedAt: "2026-11-03T11:00:00.000Z",
      endedAt: "2026-11-03T11:50:00.000Z",
      localDate: "2026-11-03",
      notes: "Buen día",
      source: "live",
      exercises: [{ exerciseId: "press", sets: [set(60, 10), set(null, null)] }],
    });
    expect(body).toEqual({
      id: "w-1",
      routineId: null,
      startedAt: "2026-11-03T11:00:00.000Z",
      endedAt: "2026-11-03T11:50:00.000Z",
      notes: "Buen día",
      source: "live",
      exercises: [{ exerciseId: "press", sets: [set(60, 10)] }],
    });
    expect("localDate" in body).toBe(false);
  });
});

describe("manualError", () => {
  const ok = { date: "2026-11-03", today: "2026-11-10", durationMin: 50 };

  it("acepta una fecha pasada, hoy y una duración normal", () => {
    expect(manualError(ok)).toBeNull();
    expect(manualError({ ...ok, date: "2026-11-10" })).toBeNull();
  });

  it("no admite fechas futuras", () => {
    expect(manualError({ ...ok, date: "2026-11-11" })).toBe("La fecha no puede ser futura.");
  });

  it("pide una fecha real", () => {
    expect(manualError({ ...ok, date: "" })).toBe("Elige la fecha del entreno.");
    expect(manualError({ ...ok, date: "2026-02-30" })).toBe("Elige la fecha del entreno.");
  });

  it("pide una duración de 1 a 1.440 minutos", () => {
    expect(manualError({ ...ok, durationMin: null })).toBe("Indica la duración en minutos.");
    expect(manualError({ ...ok, durationMin: 0 })).toBe("Indica la duración en minutos.");
    expect(manualError({ ...ok, durationMin: -5 })).toBe("Indica la duración en minutos.");
    expect(manualError({ ...ok, durationMin: Number.NaN })).toBe("Indica la duración en minutos.");
    expect(manualError({ ...ok, durationMin: 1 })).toBeNull();
    expect(manualError({ ...ok, durationMin: 1440 })).toBeNull();
    expect(manualError({ ...ok, durationMin: 1441 })).toBe("La duración no puede pasar de 24 horas.");
  });
});

describe("edición de series", () => {
  const base: WorkoutExercise[] = [
    { exerciseId: "press", sets: [set(60, 10), set(57.5, 8)] },
    { exerciseId: "run", sets: [set(null, null, { durationMin: 30, distanceKm: 5 })] },
  ];

  it("addSetTo copia la última serie y no toca la entrada", () => {
    const next = addSetTo(base, 0);
    expect(next[0]?.sets).toEqual([set(60, 10), set(57.5, 8), set(57.5, 8)]);
    expect(base[0]?.sets).toHaveLength(2);
  });

  it("addSetTo en un ejercicio sin series añade una en blanco", () => {
    const next = addSetTo([{ exerciseId: "press", sets: [] }], 0);
    expect(next[0]?.sets).toEqual([set(null, null)]);
  });

  it("removeSetFrom quita la serie indicada", () => {
    expect(removeSetFrom(base, 0, 0)[0]?.sets).toEqual([set(57.5, 8)]);
  });

  it("setSetField cambia solo ese campo de esa serie", () => {
    const next = setSetField(base, 0, 1, "weightKg", 62.5);
    expect(next[0]?.sets).toEqual([set(60, 10), set(62.5, 8)]);
    expect(next[1]).toBe(base[1]);
  });

  it("los índices fuera de rango no cambian nada", () => {
    expect(setSetField(base, 5, 0, "reps", 3)).toEqual(base);
    expect(setSetField(base, 0, 9, "reps", 3)).toEqual(base);
    expect(removeSetFrom(base, 0, 9)).toEqual(base);
    expect(addSetTo(base, 7)).toEqual(base);
  });

  it("removeExerciseAt quita el ejercicio", () => {
    expect(removeExerciseAt(base, 0).map((e) => e.exerciseId)).toEqual(["run"]);
  });

  it("addExerciseTo añade el ejercicio al final con una serie en blanco", () => {
    const next = addExerciseTo(base, "fondos");
    expect(next.map((e) => e.exerciseId)).toEqual(["press", "run", "fondos"]);
    expect(next[2]?.sets).toEqual([set(null, null)]);
  });
});

describe("cleanExercises", () => {
  it("deja valores que el servidor acepta: nada negativo, repeticiones y RIR enteros, RIR de 0 a 10", () => {
    const cleaned = cleanExercises([
      { exerciseId: "press", sets: [set(-5, 10.6, { rir: 12 }), set(60, -1), set(Number.NaN, 8, { rir: 2.4 })] },
    ]);
    expect(cleaned).toEqual([
      {
        exerciseId: "press",
        sets: [set(null, 11, { rir: 10 }), set(60, null), set(null, 8, { rir: 2 })],
      },
    ]);
  });

  it("conserva un 0 (peso corporal) y no lo toma por vacío", () => {
    expect(cleanExercises([{ exerciseId: "fondos", sets: [set(0, 12)] }])).toEqual([
      { exerciseId: "fondos", sets: [set(0, 12)] },
    ]);
  });

  it("no deja pasar Infinity", () => {
    expect(cleanExercises([{ exerciseId: "press", sets: [set(Infinity, 5)] }])).toEqual([
      { exerciseId: "press", sets: [set(null, 5)] },
    ]);
  });
});
