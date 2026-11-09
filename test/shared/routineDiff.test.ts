import { describe, expect, it } from "vitest";
import { applyWorkoutToRoutine, hasStructuralChanges } from "../../src/shared/routineDiff";
import type { Routine, RoutineItem } from "../../src/shared/types";

function item(exerciseId: string, position: number, sets: number, repsTarget = "8-10", restSeconds = 120): RoutineItem {
  return { exerciseId, position, sets, repsTarget, restSeconds };
}

const ROUTINE: Routine = {
  id: "push",
  name: "Empuje",
  inRotation: true,
  rotationOrder: 0,
  archived: false,
  items: [item("bench", 0, 3), item("press", 1, 3, "12", 60), item("fly", 2, 2)],
};

// Una sesión con `n` series de cada ejercicio; los valores no importan para la estructura.
function session(...entries: [string, number][]): { exerciseId: string; sets: unknown[] }[] {
  return entries.map(([exerciseId, n]) => ({
    exerciseId,
    sets: Array.from({ length: n }, (_, i) => ({ weightKg: 50 + i, reps: 10 })),
  }));
}

describe("hasStructuralChanges", () => {
  it("false con los mismos ejercicios y series aunque cambien los pesos", () => {
    const same = [
      { exerciseId: "bench", sets: [{ weightKg: 100, reps: 3 }, { weightKg: 90, reps: 5 }, { weightKg: 80, reps: 8 }] },
      { exerciseId: "press", sets: [{ weightKg: 20, reps: 15 }, { weightKg: 20, reps: 14 }, { weightKg: 20, reps: 12 }] },
      { exerciseId: "fly", sets: [{ weightKg: 10, reps: 12 }, { weightKg: 10, reps: 12 }] },
    ];
    expect(hasStructuralChanges(ROUTINE, same)).toBe(false);
  });

  it("true si un ejercicio tiene una serie más", () => {
    expect(hasStructuralChanges(ROUTINE, session(["bench", 4], ["press", 3], ["fly", 2]))).toBe(true);
  });

  it("true si un ejercicio tiene una serie menos", () => {
    expect(hasStructuralChanges(ROUTINE, session(["bench", 3], ["press", 3], ["fly", 1]))).toBe(true);
  });

  it("true si se cambia un ejercicio por otro", () => {
    expect(hasStructuralChanges(ROUTINE, session(["bench", 3], ["dips", 3], ["fly", 2]))).toBe(true);
  });

  it("true si un ejercicio se mueve de sitio", () => {
    expect(hasStructuralChanges(ROUTINE, session(["press", 3], ["bench", 3], ["fly", 2]))).toBe(true);
  });

  it("true si se añade o se quita un ejercicio", () => {
    expect(hasStructuralChanges(ROUTINE, session(["bench", 3], ["press", 3], ["fly", 2], ["dips", 3]))).toBe(true);
    expect(hasStructuralChanges(ROUTINE, session(["bench", 3], ["press", 3]))).toBe(true);
  });

  it("ordena los ejercicios de la rutina por position, no por el orden del array", () => {
    const shuffled: Routine = { ...ROUTINE, items: [ROUTINE.items[2]!, ROUTINE.items[0]!, ROUTINE.items[1]!] };
    expect(hasStructuralChanges(shuffled, session(["bench", 3], ["press", 3], ["fly", 2]))).toBe(false);
  });

  it("no modifica la rutina que recibe", () => {
    const shuffled: Routine = { ...ROUTINE, items: [ROUTINE.items[2]!, ROUTINE.items[0]!, ROUTINE.items[1]!] };
    const before = shuffled.items.map((i) => i.exerciseId);
    hasStructuralChanges(shuffled, session(["bench", 3], ["press", 3], ["fly", 2]));
    expect(shuffled.items.map((i) => i.exerciseId)).toEqual(before);
  });
});

describe("applyWorkoutToRoutine", () => {
  it("mantiene objetivo y descanso de los ejercicios que ya estaban y pone 10 y 90 s a los nuevos", () => {
    const result = applyWorkoutToRoutine(ROUTINE, session(["bench", 4], ["dips", 3], ["press", 3]));
    expect(result).toEqual([
      { exerciseId: "bench", position: 0, sets: 4, repsTarget: "8-10", restSeconds: 120 },
      { exerciseId: "dips", position: 1, sets: 3, repsTarget: "10", restSeconds: 90 },
      { exerciseId: "press", position: 2, sets: 3, repsTarget: "12", restSeconds: 60 },
    ]);
  });

  it("el número de series es el de las series hechas y position sigue el orden de la sesión", () => {
    const result = applyWorkoutToRoutine(ROUTINE, session(["fly", 1], ["bench", 5]));
    expect(result.map((i) => [i.exerciseId, i.position, i.sets])).toEqual([
      ["fly", 0, 1],
      ["bench", 1, 5],
    ]);
  });

  it("sin ejercicios devuelve una lista vacía", () => {
    expect(applyWorkoutToRoutine(ROUTINE, [])).toEqual([]);
  });

  it("no modifica la rutina que recibe", () => {
    const copy = structuredClone(ROUTINE);
    applyWorkoutToRoutine(ROUTINE, session(["dips", 3]));
    expect(ROUTINE).toEqual(copy);
  });

  it("el resultado deja de tener cambios estructurales respecto a la sesión", () => {
    const exercises = session(["fly", 4], ["bench", 3], ["dips", 2]);
    const updated: Routine = { ...ROUTINE, items: applyWorkoutToRoutine(ROUTINE, exercises) };
    expect(hasStructuralChanges(updated, exercises)).toBe(false);
  });
});
