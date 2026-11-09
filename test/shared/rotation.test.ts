import { describe, expect, it } from "vitest";
import { estimateDurationMin, nextRoutine } from "../../src/shared/rotation";
import type { Category, Exercise, Routine, RoutineItem, Workout } from "../../src/shared/types";

function routine(id: string, rotationOrder: number, overrides: Partial<Routine> = {}): Routine {
  return {
    id,
    name: id,
    inRotation: true,
    rotationOrder,
    archived: false,
    items: [],
    ...overrides,
  };
}

type HistoryEntry = Pick<Workout, "routineId" | "startedAt">;

function done(routineId: string | null, startedAt: string): HistoryEntry {
  return { routineId, startedAt };
}

const A = routine("A", 1);
const B = routine("B", 2);
const C = routine("C", 3);
const ABC = [A, B, C];

describe("nextRoutine", () => {
  it("sin entrenos empieza por la primera de la rotación", () => {
    expect(nextRoutine(ABC, [])?.id).toBe("A");
  });

  it("tras B toca C", () => {
    expect(nextRoutine(ABC, [done("B", "2026-11-02T08:00:00Z")])?.id).toBe("C");
  });

  it("tras la última vuelve a la primera", () => {
    expect(nextRoutine(ABC, [done("C", "2026-11-02T08:00:00Z")])?.id).toBe("A");
  });

  it("se guía por el entreno más reciente aunque el historial venga desordenado", () => {
    const history = [
      done("C", "2026-11-05T08:00:00Z"),
      done("A", "2026-11-03T08:00:00Z"),
      done("B", "2026-11-07T08:00:00Z"),
      done("A", "2026-11-01T08:00:00Z"),
    ];
    expect(nextRoutine(ABC, history)?.id).toBe("C");
  });

  it("compara los instantes, no el texto, cuando llevan distinto formato", () => {
    // 10:00+02:00 son las 08:00 UTC: es anterior a las 09:00 UTC aunque como texto sea posterior.
    const history = [done("A", "2026-11-02T10:00:00+02:00"), done("B", "2026-11-02T09:00:00Z")];
    expect(nextRoutine(ABC, history)?.id).toBe("C");
  });

  it("ordena por rotationOrder, no por la posición en el array", () => {
    expect(nextRoutine([C, A, B], [])?.id).toBe("A");
    expect(nextRoutine([C, A, B], [done("A", "2026-11-02T08:00:00Z")])?.id).toBe("B");
    expect(nextRoutine([C, A, B], [done("C", "2026-11-02T08:00:00Z")])?.id).toBe("A");
  });

  it("no modifica los arrays que recibe", () => {
    const routines = [C, A, B];
    const history = [done("A", "2026-11-03T08:00:00Z"), done("B", "2026-11-01T08:00:00Z")];
    nextRoutine(routines, history);
    expect(routines.map((r) => r.id)).toEqual(["C", "A", "B"]);
    expect(history.map((w) => w.routineId)).toEqual(["A", "B"]);
  });

  it("un entreno libre (sin rutina) después de B no cambia el turno: toca C", () => {
    const history = [done("B", "2026-11-02T08:00:00Z"), done(null, "2026-11-03T08:00:00Z")];
    expect(nextRoutine(ABC, history)?.id).toBe("C");
  });

  it("una rutina que no rota (Brazos) hecha después de A no cambia el turno: toca B", () => {
    const arms = routine("Brazos", 4, { inRotation: false });
    const history = [done("A", "2026-11-02T08:00:00Z"), done("Brazos", "2026-11-03T08:00:00Z")];
    expect(nextRoutine([...ABC, arms], history)?.id).toBe("B");
  });

  it("ignora un entreno de una rutina que ya no existe", () => {
    const history = [done("A", "2026-11-02T08:00:00Z"), done("borrada", "2026-11-03T08:00:00Z")];
    expect(nextRoutine(ABC, history)?.id).toBe("B");
  });

  it("con B fuera de la rotación y el historial A y luego B, toca C", () => {
    const history = [done("A", "2026-11-02T08:00:00Z"), done("B", "2026-11-03T08:00:00Z")];
    const rotation = [A, routine("B", 2, { inRotation: false }), C];
    // La última válida es A, y la siguiente de A en la rotación (A, C) es C.
    expect(nextRoutine(rotation, history)?.id).toBe("C");
  });

  it("con B fuera de la rotación y solo B en el historial, empieza por A", () => {
    const rotation = [A, routine("B", 2, { inRotation: false }), C];
    expect(nextRoutine(rotation, [done("B", "2026-11-03T08:00:00Z")])?.id).toBe("A");
  });

  it("una rutina archivada nunca entra en la rotación aunque tenga inRotation", () => {
    const rotation = [A, routine("B", 2, { archived: true }), C];
    expect(nextRoutine(rotation, [])?.id).toBe("A");
    expect(nextRoutine(rotation, [done("A", "2026-11-02T08:00:00Z")])?.id).toBe("C");
    // El entreno de B (archivada) tampoco marca el turno.
    const history = [done("A", "2026-11-02T08:00:00Z"), done("B", "2026-11-03T08:00:00Z")];
    expect(nextRoutine(rotation, history)?.id).toBe("C");
  });

  it("si la primera de la rotación está archivada, empieza por la siguiente", () => {
    const rotation = [routine("A", 1, { archived: true }), B, C];
    expect(nextRoutine(rotation, [])?.id).toBe("B");
  });

  it("con una sola rutina en rotación, siempre toca esa", () => {
    expect(nextRoutine([A], [])?.id).toBe("A");
    expect(nextRoutine([A], [done("A", "2026-11-02T08:00:00Z")])?.id).toBe("A");
  });

  it("sin rutinas en rotación devuelve null", () => {
    expect(nextRoutine([], [])).toBeNull();
    expect(nextRoutine([], [done("A", "2026-11-02T08:00:00Z")])).toBeNull();
    const none = [routine("A", 1, { inRotation: false }), routine("B", 2, { archived: true })];
    expect(nextRoutine(none, [done("A", "2026-11-02T08:00:00Z")])).toBeNull();
  });
});

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

function item(exerciseId: string, overrides: Partial<RoutineItem> = {}): RoutineItem {
  return { exerciseId, position: 0, sets: 3, repsTarget: "8-10", restSeconds: 90, ...overrides };
}

function catalog(...exercises: Exercise[]): Map<string, Exercise> {
  return new Map(exercises.map((e) => [e.id, e]));
}

function withItems(items: RoutineItem[]): Routine {
  return routine("R", 1, { items });
}

describe("estimateDurationMin", () => {
  it("3 ejercicios de fuerza de 3 series con 90 s de descanso: 3·3·135 s = 20,25 min → 20", () => {
    const exercises = catalog(
      exercise("press", "strength"),
      exercise("remo", "strength"),
      exercise("sentadilla", "strength"),
    );
    const items = [item("press"), item("remo"), item("sentadilla")];
    expect(estimateDurationMin(withItems(items), exercises)).toBe(20);
  });

  it("el cardio suma los minutos de repsTarget", () => {
    const exercises = catalog(exercise("cinta", "cardio"));
    const items = [item("cinta", { repsTarget: "20 min" })];
    expect(estimateDurationMin(withItems(items), exercises)).toBe(20);
  });

  it("el cardio sin número en repsTarget cuenta 10 minutos", () => {
    const exercises = catalog(exercise("cinta", "cardio"));
    expect(estimateDurationMin(withItems([item("cinta", { repsTarget: "suave" })]), exercises)).toBe(10);
    expect(estimateDurationMin(withItems([item("cinta", { repsTarget: "" })]), exercises)).toBe(10);
  });

  it("el cardio no multiplica por series ni suma descanso", () => {
    const exercises = catalog(exercise("cinta", "cardio"));
    const items = [item("cinta", { sets: 4, repsTarget: "15 min", restSeconds: 120 })];
    expect(estimateDurationMin(withItems(items), exercises)).toBe(15);
  });

  it("el cardio acepta coma decimal en los minutos", () => {
    const exercises = catalog(exercise("cinta", "cardio"));
    // 12,5 min → 12,5, que redondea a 15 (múltiplo de 5 más cercano, empate hacia arriba).
    expect(estimateDurationMin(withItems([item("cinta", { repsTarget: "12,5 min" })]), exercises)).toBe(15);
    expect(estimateDurationMin(withItems([item("cinta", { repsTarget: "12,4 min" })]), exercises)).toBe(10);
  });

  it("mezcla fuerza y cardio: cualquier categoría que no sea cardio cuenta como fuerza", () => {
    const exercises = catalog(
      exercise("press", "strength"),
      exercise("plancha", "core"),
      exercise("salto", "power"),
      exercise("movilidad", "mobility"),
      exercise("pies", "feet"),
      exercise("cinta", "cardio"),
    );
    // Cinco ejercicios de 2 series con 60 s de descanso: 5·2·105 s = 17,5 min. Más 10 min de cardio = 27,5 → 30.
    const items = ["press", "plancha", "salto", "movilidad", "pies"].map((id) =>
      item(id, { sets: 2, restSeconds: 60 }),
    );
    items.push(item("cinta", { repsTarget: "10 min" }));
    expect(estimateDurationMin(withItems(items), exercises)).toBe(30);
  });

  it("un ejercicio que no está en el mapa cuenta como fuerza", () => {
    const items = [item("desconocido"), item("otro"), item("más")];
    expect(estimateDurationMin(withItems(items), new Map())).toBe(20);
  });

  it("redondea al múltiplo de 5 más cercano", () => {
    const exercises = catalog(exercise("press", "strength"));
    // Una serie de 45 + 60 = 105 s por ejercicio. 6 ejercicios = 10,5 min → 10; 7 = 12,25 → 10; 8 = 14 → 15.
    const many = (n: number) => withItems(Array.from({ length: n }, () => item("press", { sets: 1, restSeconds: 60 })));
    expect(estimateDurationMin(many(6), exercises)).toBe(10);
    expect(estimateDurationMin(many(7), exercises)).toBe(10);
    expect(estimateDurationMin(many(8), exercises)).toBe(15);
  });

  it("el mínimo es 5 minutos, también sin ejercicios", () => {
    const exercises = catalog(exercise("press", "strength"));
    expect(estimateDurationMin(withItems([]), exercises)).toBe(5);
    expect(estimateDurationMin(withItems([item("press", { sets: 1, restSeconds: 0 })]), exercises)).toBe(5);
  });
});
