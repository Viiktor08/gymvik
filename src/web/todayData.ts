import type { Routine } from "../shared/types";

/** Respuesta de `GET /api/today`. */
export type TodayData = {
  /** YYYY-MM-DD de hoy en la zona horaria de los ajustes. */
  date: string;
  displayName: string;
  /** Semanas consecutivas con el objetivo cumplido. */
  streak: number;
  next: { routine: Routine; estimatedMin: number } | null;
  /** `null` es "sin datos"; `0` es un dato real. */
  steps: number | null;
  stepsGoal: number;
  lastWeight: { localDate: string; weightKg: number; bodyFatPct: number | null } | null;
  /** Kilos de diferencia con hace una semana (negativo = ha bajado); `null` si no hay con qué comparar. */
  weekWeightDelta: number | null;
  creatineToday: boolean;
  /** `days` va de lunes a domingo. `count` puede superar a `goal`. */
  week: { count: number; goal: number; days: boolean[] };
};
