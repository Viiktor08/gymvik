import type { RecordKind } from "../shared/records";
import type { SetEntry } from "../shared/types";
import type { WeeklySummary } from "../shared/weekly";

/** Una sesión de un ejercicio en `GET /api/progress/exercise/:id`. Más antigua primero. */
export type ExerciseSession = {
  localDate: string;
  maxWeight: number | null;
  best1RM: number | null;
  /** 0 en cardio. */
  volume: number;
  maxDistance: number | null;
  /** min/km: menos es mejor. */
  bestPace: number | null;
};

export type ExerciseProgress = {
  sessions: ExerciseSession[];
  /** Solo trae los récords de la categoría del ejercicio, y una clave sin valor no está. */
  records: Partial<Record<RecordKind, { value: number; localDate: string }>>;
};

/** Una entrada de `GET /api/exercises/:id/history`. Más reciente primero. */
export type ExerciseHistoryEntry = {
  workoutId: string;
  localDate: string;
  sets: SetEntry[];
};

/** Los rangos de `GET /api/progress/weight?range=`. */
export type WeightRange = "4w" | "12w" | "all";

/** Un punto de `GET /api/progress/weight`. Más antiguo primero; `avg7` es la media móvil de 7 días. */
export type WeightPoint = {
  localDate: string;
  weightKg: number;
  bodyFatPct: number | null;
  avg7: number | null;
};

/** Respuesta de `GET /api/progress/week`. */
export type WeekProgress = {
  current: WeeklySummary;
  previous: WeeklySummary;
  /** Semanas consecutivas con el objetivo cumplido. */
  streak: number;
  /** Entrenos por semana. */
  goal: number;
};
