// Resumen de una semana para la pantalla de progreso. Función pura sobre datos ya cargados.
import { weekDays } from "./dates";
import type { Exercise, Workout } from "./types";

export interface WeeklySummary {
  workouts: number;
  volumeKg: number;
  cardioMin: number;
  cardioKm: number;
  /** Media de pasos de los días con datos, o null si no hay ninguno. */
  avgSteps: number | null;
  creatineDays: number;
}

// Un valor solo suma si es un número finito mayor que 0; null o NaN no aportan nada.
function positive(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

/**
 * Resume la semana de 7 días que empieza en `weekStartDate` (el lunes). Solo suma lo que cae en esos días.
 * - Volumen: Σ peso × repeticiones de las series con ambos valores > 0 en ejercicios que no son de cardio.
 * - Cardio: Σ minutos y Σ km de los ejercicios con `category === "cardio"`.
 *   Un ejercicio que no esté en `exercises` no cuenta como cardio.
 * - Pasos medios: media de los días con datos (un día con 0 pasos es un día con datos).
 * - Creatina: días distintos con toma.
 */
export function weeklySummary(
  weekStartDate: string,
  data: {
    workouts: Workout[];
    steps: { localDate: string; steps: number }[];
    creatineDates: string[];
    exercises: Map<string, Exercise>;
  },
): WeeklySummary {
  const days = new Set(weekDays(weekStartDate));

  let workouts = 0;
  let volumeKg = 0;
  let cardioMin = 0;
  let cardioKm = 0;
  for (const workout of data.workouts) {
    if (!days.has(workout.localDate)) continue;
    workouts += 1;
    for (const { exerciseId, sets } of workout.exercises) {
      const isCardio = data.exercises.get(exerciseId)?.category === "cardio";
      for (const set of sets) {
        if (isCardio) {
          if (positive(set.durationMin)) cardioMin += set.durationMin;
          if (positive(set.distanceKm)) cardioKm += set.distanceKm;
        } else if (positive(set.weightKg) && positive(set.reps)) {
          volumeKg += set.weightKg * set.reps;
        }
      }
    }
  }

  const weekSteps = data.steps.filter((day) => days.has(day.localDate) && Number.isFinite(day.steps));
  const avgSteps =
    weekSteps.length === 0 ? null : weekSteps.reduce((sum, day) => sum + day.steps, 0) / weekSteps.length;

  const creatineDays = new Set(data.creatineDates.filter((date) => days.has(date))).size;

  return { workouts, volumeKg, cardioMin, cardioKm, avgSteps, creatineDays };
}
