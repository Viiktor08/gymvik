// Prerrelleno de las series de la sesión en directo con lo último que se hizo. Funciones puras.
import type { Category, DraftSet, RoutineItem, SetEntry, Workout } from "./types";

const SEPARATOR = " · ";

// Los instantes se comparan como tales, no como texto: "…+02:00" y "…Z" no se ordenan igual como cadenas.
function startTime(workout: Workout): number {
  const time = Date.parse(workout.startedAt);
  return Number.isNaN(time) ? -Infinity : time;
}

/**
 * Las series del ejercicio en la sesión más reciente (por startedAt) en la que aparece, o null si nunca se
 * hizo. Si el ejercicio se repite dentro de ese entreno, se usa su primera aparición.
 */
export function lastPerformance(exerciseId: string, workouts: Workout[]): SetEntry[] | null {
  let found: SetEntry[] | null = null;
  let foundAt = -Infinity;
  for (const workout of workouts) {
    const exercise = workout.exercises.find((e) => e.exerciseId === exerciseId);
    if (!exercise) continue;
    const time = startTime(workout);
    if (found === null || time > foundAt) {
      found = exercise.sets;
      foundAt = time;
    }
  }
  return found;
}

// Primer entero del objetivo: "8-10" -> 8, "20 min" -> 20. Null si no hay ninguno.
function firstInteger(text: string): number | null {
  const found = text.match(/\d+/);
  if (!found) return null;
  const value = Number(found[0]);
  return Number.isFinite(value) ? value : null;
}

function draft(set: SetEntry): DraftSet {
  return {
    weightKg: set.weightKg,
    reps: set.reps,
    rir: set.rir,
    durationMin: set.durationMin,
    distanceKm: set.distanceKm,
    done: false,
  };
}

/**
 * Las series de una sesión en directo para un ejercicio de la rutina: exactamente `item.sets` filas, todas
 * sin hacer. Con historial se copian las series de la última vez; si la rutina pide más, se repite la
 * última, y si pide menos, se recortan. Sin historial el peso va vacío y las repeticiones (o los minutos,
 * en cardio) salen del primer entero del objetivo.
 */
export function prefillSets(
  item: Pick<RoutineItem, "sets" | "repsTarget">,
  last: SetEntry[] | null,
  category: Category,
): DraftSet[] {
  const count = Number.isFinite(item.sets) ? Math.max(0, Math.floor(item.sets)) : 0;
  const lastSet = last?.[last.length - 1];
  if (last && lastSet) {
    return Array.from({ length: count }, (_, index) => draft(last[index] ?? lastSet));
  }
  const target = firstInteger(item.repsTarget);
  const empty: SetEntry = {
    weightKg: null,
    reps: category === "cardio" ? null : target,
    rir: null,
    durationMin: category === "cardio" ? target : null,
    distanceKm: null,
  };
  return Array.from({ length: count }, () => draft(empty));
}

// Un valor solo se muestra si es un número finito mayor que 0 (el 0 cuenta como "sin valor").
function positive(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

// Coma decimal y sin ceros de más: 57.5 -> "57,5", 60 -> "60". Se redondea a 2 decimales.
function decimal(value: number): string {
  return String(Number(value.toFixed(2))).replace(".", ",");
}

function strengthSet(set: SetEntry): string | null {
  const reps = set.reps !== null && Number.isFinite(set.reps) ? set.reps : null;
  if (positive(set.weightKg)) {
    return reps === null ? `${decimal(set.weightKg)} kg` : `${decimal(set.weightKg)}×${reps}`;
  }
  return reps === null ? null : `${reps} reps`;
}

function cardioSet(set: SetEntry): string | null {
  const parts: string[] = [];
  if (positive(set.durationMin)) parts.push(`${decimal(set.durationMin)} min`);
  if (positive(set.distanceKm)) parts.push(`${decimal(set.distanceKm)} km`);
  return parts.length === 0 ? null : parts.join(SEPARATOR);
}

/**
 * El texto de "Última vez". Fuerza: "60×10 · 60×9 · 57,5×8" (sin peso, "12 reps"). Cardio: "30 min · 5 km"
 * (sin distancia, solo "30 min"). Las series sin nada que mostrar se omiten; sin series, "".
 */
export function formatLast(sets: SetEntry[], category: Category): string {
  const format = category === "cardio" ? cardioSet : strengthSet;
  return sets
    .map(format)
    .filter((text): text is string => text !== null)
    .join(SEPARATOR);
}
