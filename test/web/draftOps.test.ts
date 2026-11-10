import { describe, expect, it } from "vitest";
import type { DraftSet, Exercise, Routine, SetEntry } from "../../src/shared/types";
import type { Draft } from "../../src/web/session/draftStore";
import {
  addSet,
  appendExercise,
  draftFromRoutine,
  moveExercise,
  newExerciseSets,
  removeExercise,
  removeLastSet,
  replaceExercise,
  setField,
  toggleDone,
} from "../../src/web/session/draftOps";

function row(weightKg: number | null, reps: number | null, done = false): DraftSet {
  return { weightKg, reps, rir: null, durationMin: null, distanceKm: null, done };
}

function set(weightKg: number, reps: number): SetEntry {
  return { weightKg, reps, rir: null, durationMin: null, distanceKm: null };
}

function exercise(id: string, category: Exercise["category"] = "strength"): Exercise {
  return { id, name: id, category, muscle: "", description: "", mediaUrl: null, isCustom: false, archived: false };
}

const DRAFT: Draft = {
  id: "w-1",
  routineId: "r-1",
  startedAt: "2026-11-10T08:00:00.000Z",
  exercises: [
    { exerciseId: "a", restSeconds: 90, sets: [row(60, 10), row(60, 9)] },
    { exerciseId: "b", restSeconds: 60, sets: [row(20, 12)] },
    { exerciseId: "c", restSeconds: 45, sets: [row(null, 8)] },
  ],
};

describe("setField", () => {
  it("cambia un campo de una serie sin tocar el resto ni el original", () => {
    const next = setField(DRAFT, 0, 1, "weightKg", 62.5);

    expect(next.exercises[0]?.sets[1]?.weightKg).toBe(62.5);
    expect(next.exercises[0]?.sets[0]?.weightKg).toBe(60);
    expect(next.exercises[1]).toBe(DRAFT.exercises[1]);
    expect(DRAFT.exercises[0]?.sets[1]?.weightKg).toBe(60);
  });

  it("acepta vaciar el campo (null)", () => {
    expect(setField(DRAFT, 0, 0, "reps", null).exercises[0]?.sets[0]?.reps).toBeNull();
  });

  it("un índice que no existe deja el borrador como estaba", () => {
    expect(setField(DRAFT, 9, 0, "reps", 1)).toBe(DRAFT);
    expect(setField(DRAFT, 0, 9, "reps", 1)).toBe(DRAFT);
  });
});

describe("toggleDone", () => {
  it("marca y desmarca", () => {
    const done = toggleDone(DRAFT, 0, 0);
    expect(done.exercises[0]?.sets[0]?.done).toBe(true);
    expect(toggleDone(done, 0, 0).exercises[0]?.sets[0]?.done).toBe(false);
  });
});

describe("addSet", () => {
  it("repite la última serie, sin hacer", () => {
    const next = addSet(toggleDone(DRAFT, 0, 1), 0);

    expect(next.exercises[0]?.sets).toHaveLength(3);
    expect(next.exercises[0]?.sets[2]).toEqual(row(60, 9, false));
  });

  it("en un ejercicio sin series añade una vacía", () => {
    const empty: Draft = { ...DRAFT, exercises: [{ exerciseId: "a", restSeconds: 90, sets: [] }] };

    expect(addSet(empty, 0).exercises[0]?.sets).toEqual([row(null, null, false)]);
  });
});

describe("removeLastSet", () => {
  it("quita la última serie", () => {
    expect(removeLastSet(DRAFT, 0).exercises[0]?.sets).toEqual([row(60, 10)]);
  });

  it("no deja un ejercicio sin series", () => {
    expect(removeLastSet(DRAFT, 1)).toBe(DRAFT);
  });
});

describe("moveExercise", () => {
  it("sube y baja", () => {
    expect(moveExercise(DRAFT, 1, -1).exercises.map((e) => e.exerciseId)).toEqual(["b", "a", "c"]);
    expect(moveExercise(DRAFT, 1, 1).exercises.map((e) => e.exerciseId)).toEqual(["a", "c", "b"]);
  });

  it("en los extremos no hace nada", () => {
    expect(moveExercise(DRAFT, 0, -1)).toBe(DRAFT);
    expect(moveExercise(DRAFT, 2, 1)).toBe(DRAFT);
  });
});

describe("removeExercise", () => {
  it("quita el ejercicio y sus series", () => {
    expect(removeExercise(DRAFT, 1).exercises.map((e) => e.exerciseId)).toEqual(["a", "c"]);
  });
});

describe("replaceExercise", () => {
  it("cambia el ejercicio y sus series, y conserva el descanso", () => {
    const next = replaceExercise(DRAFT, 0, "z", [row(null, 10)]);

    expect(next.exercises[0]).toEqual({ exerciseId: "z", restSeconds: 90, sets: [row(null, 10)] });
    expect(next.exercises).toHaveLength(3);
  });
});

describe("appendExercise", () => {
  it("añade al final", () => {
    const next = appendExercise(DRAFT, { exerciseId: "d", restSeconds: 90, sets: [row(null, 10)] });

    expect(next.exercises.map((e) => e.exerciseId)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("newExerciseSets", () => {
  it("fuerza sin historial: 3 series con 10 repeticiones y sin peso", () => {
    expect(newExerciseSets("strength", null)).toEqual([row(null, 10), row(null, 10), row(null, 10)]);
  });

  it("fuerza con historial: 3 series, la última repetida si hubo menos", () => {
    expect(newExerciseSets("strength", [set(60, 10), set(57.5, 8)])).toEqual([row(60, 10), row(57.5, 8), row(57.5, 8)]);
  });

  it("cardio sin historial: una fila vacía; con historial, la de la última vez", () => {
    expect(newExerciseSets("cardio", null)).toEqual([{ ...row(null, null), durationMin: null }]);
    const last: SetEntry = { weightKg: null, reps: null, rir: null, durationMin: 30, distanceKm: 5 };
    expect(newExerciseSets("cardio", [last])).toEqual([{ ...last, done: false }]);
  });
});

describe("draftFromRoutine", () => {
  const routine: Routine = {
    id: "r-1",
    name: "Pecho",
    inRotation: true,
    rotationOrder: 0,
    archived: false,
    items: [
      { exerciseId: "b", position: 1, sets: 2, repsTarget: "12", restSeconds: 60 },
      { exerciseId: "a", position: 0, sets: 3, repsTarget: "8-10", restSeconds: 120 },
      { exerciseId: "run", position: 2, sets: 1, repsTarget: "20 min", restSeconds: 0 },
    ],
  };
  const catalog = new Map([exercise("a"), exercise("b"), exercise("run", "cardio")].map((e) => [e.id, e]));

  it("ordena por posición, prerrellena con la última vez y con el objetivo cuando no la hay", () => {
    const draft = draftFromRoutine(routine, catalog, { a: [set(60, 10), set(60, 9)], b: null }, "w-9", new Date("2026-11-10T08:00:00Z"));

    expect(draft.id).toBe("w-9");
    expect(draft.routineId).toBe("r-1");
    expect(draft.startedAt).toBe("2026-11-10T08:00:00.000Z");
    expect(draft.exercises.map((e) => e.exerciseId)).toEqual(["a", "b", "run"]);
    // Con historial: copia, y repite la última si la rutina pide más series.
    expect(draft.exercises[0]?.sets).toEqual([row(60, 10), row(60, 9), row(60, 9)]);
    expect(draft.exercises[0]?.restSeconds).toBe(120);
    // Sin historial: repeticiones = primer número del objetivo.
    expect(draft.exercises[1]?.sets).toEqual([row(null, 12), row(null, 12)]);
    // Cardio sin historial: minutos del objetivo.
    expect(draft.exercises[2]?.sets).toEqual([{ weightKg: null, reps: null, rir: null, durationMin: 20, distanceKm: null, done: false }]);
  });

  it("un ejercicio que no está en el catálogo se trata como de fuerza", () => {
    const draft = draftFromRoutine(routine, new Map(), {}, "w-9", new Date("2026-11-10T08:00:00Z"));

    expect(draft.exercises[2]?.sets).toEqual([row(null, 20)]);
  });
});
