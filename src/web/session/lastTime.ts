import { lastPerformance } from "../../shared/prefill";
import type { SetEntry, Workout } from "../../shared/types";
import type { ExerciseHistoryEntry } from "../progressData";

/**
 * Las series de la última vez que se hizo el ejercicio, a partir de `GET /api/exercises/:id/history`
 * (de la sesión más nueva a la más antigua). Reutiliza `lastPerformance`: el historial se presenta como
 * entrenos con la fecha local como instante; a igualdad de fecha gana la primera de la lista, la más reciente.
 * Una sesión en la que el ejercicio no guardó series no cuenta como "última vez".
 */
export function lastFromHistory(exerciseId: string, entries: ExerciseHistoryEntry[]): SetEntry[] | null {
  const workouts: Workout[] = entries
    .filter((entry) => entry.sets.length > 0)
    .map((entry) => ({
      id: entry.workoutId,
      routineId: null,
      startedAt: `${entry.localDate}T00:00:00.000Z`,
      endedAt: `${entry.localDate}T00:00:00.000Z`,
      localDate: entry.localDate,
      notes: "",
      source: "live",
      exercises: [{ exerciseId, sets: entry.sets }],
    }));
  return lastPerformance(exerciseId, workouts);
}
