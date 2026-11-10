import { describe, expect, it } from "vitest";
import {
  backupSchema,
  bodyMetricInputSchema,
  creatineHookSchema,
  exerciseInputSchema,
  hookKeyInputSchema,
  routineSchema,
  settingsPatchSchema,
  settingsSchema,
  stepsHookSchema,
  workoutSchema,
} from "../../src/shared/schemas";

const validSet = { weightKg: 60, reps: 10, rir: 2, durationMin: null, distanceKm: null };

const validWorkout = {
  id: "7b0c6b3e-6d54-4f0c-9d3e-1c2b8e5a9f10",
  routineId: "push_a",
  startedAt: "2026-11-09T17:00:00.000Z",
  endedAt: "2026-11-09T18:05:00.000Z",
  localDate: "2026-11-09",
  notes: "",
  source: "live",
  exercises: [{ exerciseId: "bench_press", sets: [validSet] }],
};

const validRoutine = {
  id: "push_a",
  name: "Empuje A",
  inRotation: true,
  rotationOrder: 0,
  archived: false,
  items: [{ exerciseId: "bench_press", position: 0, sets: 3, repsTarget: "8-10", restSeconds: 90 }],
};

const validExercise = {
  name: "Press de banca",
  category: "strength",
  muscle: "Pecho",
  description: "Empuja la barra desde el pecho hasta estirar los brazos.",
  mediaUrl: null,
};

const validSettings = {
  displayName: "Victor",
  theme: "green",
  timezone: "Europe/Madrid",
  weeklyGoal: 3,
  stepsGoal: 8000,
  creatineGrams: 5,
  shortcutName: "Gymvik Pasos",
  notifications: {
    today: { enabled: true, time: "09:00" },
    creatine: { enabled: true, time: "10:00" },
    steps: { enabled: true, time: "20:00" },
    streak: { enabled: true, time: "19:00" },
    weight: { enabled: false, time: "09:00" },
  },
};

describe("exerciseInputSchema", () => {
  it("acepta un ejercicio válido", () => {
    expect(exerciseInputSchema.safeParse(validExercise).success).toBe(true);
  });

  it("acepta mediaUrl con https", () => {
    const result = exerciseInputSchema.safeParse({ ...validExercise, mediaUrl: "https://example.com/press.mp4" });
    expect(result.success).toBe(true);
  });

  it("rechaza mediaUrl con javascript:", () => {
    expect(exerciseInputSchema.safeParse({ ...validExercise, mediaUrl: "javascript:alert(1)" }).success).toBe(false);
  });

  it("rechaza mediaUrl con http:", () => {
    expect(exerciseInputSchema.safeParse({ ...validExercise, mediaUrl: "http://example.com/press.mp4" }).success).toBe(
      false,
    );
  });

  it("rechaza otros esquemas y URLs que la base de datos no aceptaría", () => {
    for (const mediaUrl of ["data:text/html,<script>1</script>", "ftp://example.com/a", "https:example.com", "example.com"]) {
      expect(exerciseInputSchema.safeParse({ ...validExercise, mediaUrl }).success, mediaUrl).toBe(false);
    }
  });

  it("recorta los espacios de un enlace pegado", () => {
    const result = exerciseInputSchema.parse({ ...validExercise, mediaUrl: "  https://example.com/press.mp4 " });
    expect(result.mediaUrl).toBe("https://example.com/press.mp4");
  });

  it("acepta mediaUrl nula o ausente", () => {
    expect(exerciseInputSchema.parse({ ...validExercise, mediaUrl: null }).mediaUrl).toBeNull();
    const { mediaUrl: _omitted, ...withoutMedia } = validExercise;
    expect(exerciseInputSchema.parse(withoutMedia).mediaUrl).toBeNull();
  });

  it("rechaza nombres vacíos y categorías desconocidas", () => {
    expect(exerciseInputSchema.safeParse({ ...validExercise, name: "  " }).success).toBe(false);
    expect(exerciseInputSchema.safeParse({ ...validExercise, category: "yoga" }).success).toBe(false);
  });
});

describe("workoutSchema", () => {
  it("acepta un entreno válido", () => {
    expect(workoutSchema.safeParse(validWorkout).success).toBe(true);
  });

  it("acepta entrenos sin ejercicios y series con todo a null", () => {
    expect(workoutSchema.safeParse({ ...validWorkout, routineId: null, source: "manual", exercises: [] }).success).toBe(
      true,
    );
    const emptySet = { weightKg: null, reps: null, rir: null, durationMin: null, distanceKm: null };
    expect(
      workoutSchema.safeParse({ ...validWorkout, exercises: [{ exerciseId: "bench_press", sets: [emptySet] }] }).success,
    ).toBe(true);
  });

  it("rechaza reps negativas", () => {
    const exercises = [{ exerciseId: "bench_press", sets: [{ ...validSet, reps: -1 }] }];
    expect(workoutSchema.safeParse({ ...validWorkout, exercises }).success).toBe(false);
  });

  it("rechaza weightKg negativo", () => {
    const exercises = [{ exerciseId: "bench_press", sets: [{ ...validSet, weightKg: -1 }] }];
    expect(workoutSchema.safeParse({ ...validWorkout, exercises }).success).toBe(false);
  });

  it("acepta peso y repeticiones a cero", () => {
    const exercises = [{ exerciseId: "pull_up", sets: [{ ...validSet, weightKg: 0, reps: 0 }] }];
    expect(workoutSchema.safeParse({ ...validWorkout, exercises }).success).toBe(true);
  });

  it("rechaza valores no finitos y repeticiones decimales", () => {
    for (const patch of [{ weightKg: Infinity }, { weightKg: NaN }, { reps: 8.5 }, { durationMin: -5 }, { distanceKm: -1 }]) {
      const exercises = [{ exerciseId: "bench_press", sets: [{ ...validSet, ...patch }] }];
      expect(workoutSchema.safeParse({ ...validWorkout, exercises }).success, JSON.stringify(patch)).toBe(false);
    }
  });

  it("rechaza fechas inventadas o instantes que no son ISO", () => {
    expect(workoutSchema.safeParse({ ...validWorkout, localDate: "2026-02-30" }).success).toBe(false);
    expect(workoutSchema.safeParse({ ...validWorkout, localDate: "09/11/2026" }).success).toBe(false);
    expect(workoutSchema.safeParse({ ...validWorkout, startedAt: "ayer" }).success).toBe(false);
  });

  it("rechaza un source desconocido", () => {
    expect(workoutSchema.safeParse({ ...validWorkout, source: "import" }).success).toBe(false);
  });

  it("permite quitar localDate con omit (lo calcula el servidor)", () => {
    const { localDate: _omitted, ...withoutLocalDate } = validWorkout;
    expect(workoutSchema.omit({ localDate: true }).safeParse(withoutLocalDate).success).toBe(true);
  });
});

describe("routineSchema", () => {
  it("acepta una rutina válida", () => {
    expect(routineSchema.safeParse(validRoutine).success).toBe(true);
  });

  it("rechaza series o descansos imposibles", () => {
    const item = validRoutine.items[0]!;
    expect(routineSchema.safeParse({ ...validRoutine, items: [{ ...item, sets: 0 }] }).success).toBe(false);
    expect(routineSchema.safeParse({ ...validRoutine, items: [{ ...item, restSeconds: -1 }] }).success).toBe(false);
    expect(routineSchema.safeParse({ ...validRoutine, items: [{ ...item, repsTarget: "" }] }).success).toBe(false);
  });

  it("rechaza nombres vacíos", () => {
    expect(routineSchema.safeParse({ ...validRoutine, name: "" }).success).toBe(false);
  });
});

describe("settingsSchema", () => {
  it("acepta unos ajustes completos", () => {
    expect(settingsSchema.safeParse(validSettings).success).toBe(true);
  });

  it("exige los cinco avisos", () => {
    const { weight: _omitted, ...notifications } = validSettings.notifications;
    expect(settingsSchema.safeParse({ ...validSettings, notifications }).success).toBe(false);
  });
});

describe("settingsPatchSchema", () => {
  it("acepta un parche vacío y parches parciales", () => {
    expect(settingsPatchSchema.safeParse({}).success).toBe(true);
    expect(settingsPatchSchema.safeParse({ weeklyGoal: 4 }).success).toBe(true);
    expect(settingsPatchSchema.safeParse({ notifications: { steps: { time: "21:30" } } }).success).toBe(true);
    expect(settingsPatchSchema.safeParse({ notifications: { weight: { enabled: false } } }).success).toBe(true);
  });

  it("acepta los ocho temas y rechaza otros", () => {
    for (const theme of ["green", "blue", "purple", "red", "orange", "pink", "teal", "graphite"]) {
      expect(settingsPatchSchema.safeParse({ theme }).success, theme).toBe(true);
    }
    expect(settingsPatchSchema.safeParse({ theme: "yellow" }).success).toBe(false);
  });

  it("valida el formato HH:MM de las horas", () => {
    for (const time of ["09:00", "00:00", "23:59"]) {
      expect(settingsPatchSchema.safeParse({ notifications: { today: { time } } }).success, time).toBe(true);
    }
    for (const time of ["24:00", "9:00", "09:60", "09:00:00", "ab:cd", ""]) {
      expect(settingsPatchSchema.safeParse({ notifications: { today: { time } } }).success, time).toBe(false);
    }
  });

  it("valida la zona horaria con Intl", () => {
    expect(settingsPatchSchema.safeParse({ timezone: "Europe/Madrid" }).success).toBe(true);
    expect(settingsPatchSchema.safeParse({ timezone: "America/New_York" }).success).toBe(true);
    expect(settingsPatchSchema.safeParse({ timezone: "Mars/Olympus" }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ timezone: "" }).success).toBe(false);
  });

  it("rechaza claves desconocidas, también dentro de los avisos", () => {
    expect(settingsPatchSchema.safeParse({ isAdmin: true }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ notifications: { backup: { enabled: true } } }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ notifications: { today: { sound: true } } }).success).toBe(false);
  });

  it("rechaza objetivos fuera de rango", () => {
    expect(settingsPatchSchema.safeParse({ weeklyGoal: 0 }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ weeklyGoal: 8 }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ weeklyGoal: 2.5 }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ stepsGoal: -1 }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ creatineGrams: 0 }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ displayName: "  " }).success).toBe(false);
  });
});

describe("bodyMetricInputSchema", () => {
  it("acepta el peso solo, con grasa o con grasa null", () => {
    expect(bodyMetricInputSchema.safeParse({ weightKg: 78.5 }).success).toBe(true);
    expect(bodyMetricInputSchema.safeParse({ weightKg: 78.5, bodyFatPct: 18.2 }).success).toBe(true);
    expect(bodyMetricInputSchema.safeParse({ weightKg: 78.5, bodyFatPct: null }).success).toBe(true);
    expect(bodyMetricInputSchema.safeParse({ weightKg: 78.5, bodyFatPct: 0 }).success).toBe(true);
    expect(bodyMetricInputSchema.safeParse({ weightKg: 78.5, bodyFatPct: 100 }).success).toBe(true);
  });

  it("rechaza un peso ausente, cero, negativo, no numérico o infinito", () => {
    expect(bodyMetricInputSchema.safeParse({}).success).toBe(false);
    expect(bodyMetricInputSchema.safeParse({ weightKg: 0 }).success).toBe(false);
    expect(bodyMetricInputSchema.safeParse({ weightKg: -70 }).success).toBe(false);
    expect(bodyMetricInputSchema.safeParse({ weightKg: "78,5" }).success).toBe(false);
    expect(bodyMetricInputSchema.safeParse({ weightKg: Infinity }).success).toBe(false);
    expect(bodyMetricInputSchema.safeParse({ weightKg: NaN }).success).toBe(false);
  });

  it("rechaza una grasa fuera de 0–100 o no numérica", () => {
    expect(bodyMetricInputSchema.safeParse({ weightKg: 78.5, bodyFatPct: -0.1 }).success).toBe(false);
    expect(bodyMetricInputSchema.safeParse({ weightKg: 78.5, bodyFatPct: 100.1 }).success).toBe(false);
    expect(bodyMetricInputSchema.safeParse({ weightKg: 78.5, bodyFatPct: "18" }).success).toBe(false);
  });
});

describe("hookKeyInputSchema", () => {
  it("acepta una etiqueta y uno o varios permisos, recorta la etiqueta y quita los repetidos", () => {
    expect(hookKeyInputSchema.parse({ label: " NFC ", scopes: ["creatine"] })).toEqual({
      label: "NFC",
      scopes: ["creatine"],
    });
    expect(hookKeyInputSchema.parse({ label: "Todo", scopes: ["steps", "creatine", "steps"] }).scopes).toEqual([
      "steps",
      "creatine",
    ]);
  });

  it("rechaza permisos vacíos, desconocidos o ausentes y etiquetas vacías o larguísimas", () => {
    expect(hookKeyInputSchema.safeParse({ label: "x", scopes: [] }).success).toBe(false);
    expect(hookKeyInputSchema.safeParse({ label: "x", scopes: ["weight"] }).success).toBe(false);
    expect(hookKeyInputSchema.safeParse({ label: "x" }).success).toBe(false);
    expect(hookKeyInputSchema.safeParse({ label: "  ", scopes: ["steps"] }).success).toBe(false);
    expect(hookKeyInputSchema.safeParse({ label: "x".repeat(101), scopes: ["steps"] }).success).toBe(false);
  });
});

describe("stepsHookSchema", () => {
  it("acepta pasos enteros de 0 a 200000", () => {
    expect(stepsHookSchema.safeParse({ steps: 0 }).success).toBe(true);
    expect(stepsHookSchema.safeParse({ steps: 8432 }).success).toBe(true);
    expect(stepsHookSchema.safeParse({ steps: 200000 }).success).toBe(true);
  });

  it("rechaza 250000, negativos, decimales y texto", () => {
    expect(stepsHookSchema.safeParse({ steps: 250000 }).success).toBe(false);
    expect(stepsHookSchema.safeParse({ steps: 200001 }).success).toBe(false);
    expect(stepsHookSchema.safeParse({ steps: -1 }).success).toBe(false);
    expect(stepsHookSchema.safeParse({ steps: 8432.5 }).success).toBe(false);
    expect(stepsHookSchema.safeParse({ steps: "8432" }).success).toBe(false);
    expect(stepsHookSchema.safeParse({}).success).toBe(false);
  });

  it("acepta una fecha opcional YYYY-MM-DD real", () => {
    expect(stepsHookSchema.safeParse({ steps: 100, date: "2026-11-09" }).success).toBe(true);
    expect(stepsHookSchema.safeParse({ steps: 100, date: "2026-02-30" }).success).toBe(false);
    expect(stepsHookSchema.safeParse({ steps: 100, date: "9/11/2026" }).success).toBe(false);
  });
});

describe("creatineHookSchema", () => {
  it("acepta un cuerpo sin gramos o con gramos positivos", () => {
    expect(creatineHookSchema.safeParse({}).success).toBe(true);
    expect(creatineHookSchema.safeParse({ grams: 5 }).success).toBe(true);
    expect(creatineHookSchema.safeParse({ grams: 2.5 }).success).toBe(true);
  });

  it("rechaza gramos cero, negativos o no numéricos", () => {
    expect(creatineHookSchema.safeParse({ grams: 0 }).success).toBe(false);
    expect(creatineHookSchema.safeParse({ grams: -5 }).success).toBe(false);
    expect(creatineHookSchema.safeParse({ grams: "5" }).success).toBe(false);
    expect(creatineHookSchema.safeParse({ grams: Infinity }).success).toBe(false);
  });
});

describe("backupSchema", () => {
  const validBackup = {
    version: 1,
    exportedAt: "2026-11-09T20:00:00.000Z",
    exercises: [{ ...validExercise, id: "bench_press", isCustom: false, archived: false }],
    routines: [validRoutine],
    workouts: [validWorkout],
    bodyMetrics: [{ localDate: "2026-11-09", weightKg: 78.5, bodyFatPct: null }],
    dailySteps: [{ localDate: "2026-11-09", steps: 8432 }],
    creatineLogs: [{ localDate: "2026-11-09", grams: 5, source: "nfc" }],
    settings: validSettings,
  };

  it("acepta una copia completa y una vacía", () => {
    expect(backupSchema.safeParse(validBackup).success).toBe(true);
    expect(
      backupSchema.safeParse({
        ...validBackup,
        exercises: [],
        routines: [],
        workouts: [],
        bodyMetrics: [],
        dailySteps: [],
        creatineLogs: [],
      }).success,
    ).toBe(true);
  });

  it("rechaza otra versión", () => {
    expect(backupSchema.safeParse({ ...validBackup, version: 2 }).success).toBe(false);
    expect(backupSchema.safeParse({ ...validBackup, version: "1" }).success).toBe(false);
  });

  it("rechaza datos corruptos dentro de las listas", () => {
    const badWorkout = { ...validWorkout, exercises: [{ exerciseId: "bench_press", sets: [{ ...validSet, reps: -1 }] }] };
    expect(backupSchema.safeParse({ ...validBackup, workouts: [badWorkout] }).success).toBe(false);
    expect(backupSchema.safeParse({ ...validBackup, dailySteps: [{ localDate: "2026-11-09", steps: 250000 }] }).success).toBe(
      false,
    );
    expect(
      backupSchema.safeParse({ ...validBackup, creatineLogs: [{ localDate: "2026-11-09", grams: 5, source: "api" }] }).success,
    ).toBe(false);
    expect(
      backupSchema.safeParse({ ...validBackup, bodyMetrics: [{ localDate: "2026-11-09", weightKg: -1, bodyFatPct: null }] })
        .success,
    ).toBe(false);
  });

  it("rechaza una copia sin ajustes", () => {
    const { settings: _omitted, ...withoutSettings } = validBackup;
    expect(backupSchema.safeParse(withoutSettings).success).toBe(false);
  });
});
