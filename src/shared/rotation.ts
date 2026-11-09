// Qué rutina toca y cuánto dura. Funciones puras: las usan la pantalla de hoy y las notificaciones.
import { parseDecimal } from "./dates";
import type { Exercise, Routine, Workout } from "./types";

/**
 * La rutina que toca hacer. La rotación son las rutinas con `inRotation` y sin archivar, ordenadas por
 * `rotationOrder`. Toca la siguiente (circular) a la del entreno más reciente que pertenezca a la rotación;
 * los entrenos libres o de rutinas fuera de la rotación no cuentan. Sin ese entreno, toca la primera.
 * Devuelve null si no hay ninguna rutina en rotación.
 */
export function nextRoutine(
  routines: Routine[],
  workouts: Pick<Workout, "routineId" | "startedAt">[],
): Routine | null {
  const rotation = routines
    .filter((r) => r.inRotation && !r.archived)
    .sort((a, b) => a.rotationOrder - b.rotationOrder);
  const first = rotation[0];
  if (!first) return null;

  const indexById = new Map(rotation.map((r, index) => [r.id, index]));
  let lastIndex = -1;
  let lastStart = -Infinity;
  for (const workout of workouts) {
    const index = workout.routineId === null ? undefined : indexById.get(workout.routineId);
    if (index === undefined) continue;
    // Se comparan instantes, no texto: "…+02:00" y "…Z" no se ordenan igual como cadenas.
    const start = Date.parse(workout.startedAt);
    if (start > lastStart) {
      lastStart = start;
      lastIndex = index;
    }
  }
  if (lastIndex === -1) return first;
  return rotation[(lastIndex + 1) % rotation.length] ?? first;
}

// Una serie de fuerza dura unos 45 s; a eso se suma el descanso de la rutina.
const SET_SECONDS = 45;
// Minutos de cardio cuando repsTarget no trae ningún número.
const DEFAULT_CARDIO_MIN = 10;
const ROUND_TO_MIN = 5;

function cardioMinutes(repsTarget: string): number {
  const found = repsTarget.match(/\d+(?:[.,]\d+)?/);
  return (found && parseDecimal(found[0])) ?? DEFAULT_CARDIO_MIN;
}

/**
 * Duración estimada de una rutina en minutos, redondeada al múltiplo de 5 más cercano (mínimo 5).
 * Fuerza (cualquier categoría que no sea cardio, y los ejercicios que no estén en el mapa):
 * series × (45 s + descanso). Cardio: los minutos que diga repsTarget ("20 min"), o 10 si no hay número.
 */
export function estimateDurationMin(routine: Routine, exercises: Map<string, Exercise>): number {
  let minutes = 0;
  for (const item of routine.items) {
    if (exercises.get(item.exerciseId)?.category === "cardio") {
      minutes += cardioMinutes(item.repsTarget);
    } else {
      minutes += (item.sets * (SET_SECONDS + item.restSeconds)) / 60;
    }
  }
  return Math.max(ROUND_TO_MIN, Math.round(minutes / ROUND_TO_MIN) * ROUND_TO_MIN);
}
