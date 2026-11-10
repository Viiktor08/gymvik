import { Hono } from "hono";
import { addDays, localDate } from "../../shared/dates";
import { estimateDurationMin, nextRoutine } from "../../shared/rotation";
import { streakWeeks, weekProgress } from "../../shared/streak";
import type { Routine } from "../../shared/types";
import { listExercises } from "../db/exercises";
import { getSteps, hasCreatine, latestBodyMetricOnOrBefore, round2 } from "../db/metrics";
import type { BodyMetric } from "../db/metrics";
import { listRoutines } from "../db/routines";
import { getSettings } from "../db/settings";
import { listWorkoutRefs } from "../db/workouts";
import type { Env } from "../env";
import { parseLocalDate } from "../http";

type TodayResponse = {
  date: string;
  displayName: string;
  streak: number;
  next: { routine: Routine; estimatedMin: number } | null;
  steps: number | null;
  stepsGoal: number;
  lastWeight: BodyMetric | null;
  weekWeightDelta: number | null;
  creatineToday: boolean;
  week: { count: number; goal: number; days: boolean[] };
};

/** Ruta /api/today: todo lo que pinta la pantalla Hoy, en una sola respuesta. */
export function todayRoutes(): Hono<{ Bindings: Env }> {
  const today = new Hono<{ Bindings: Env }>();

  // `?date=` (YYYY-MM-DD) es opcional: por defecto, hoy en la zona horaria de los ajustes.
  today.get("/", async (c) => {
    const db = c.env.DB;
    const settings = await getSettings(db);
    const requested = c.req.query("date");
    const date = requested === undefined ? localDate(new Date(), settings.timezone) : parseLocalDate(requested);
    const weekAgo = addDays(date, -7);

    const [workouts, routines, exercises, steps, lastWeight, weightWeekAgo, creatineToday] = await Promise.all([
      listWorkoutRefs(db),
      listRoutines(db),
      listExercises(db, true),
      getSteps(db, date),
      latestBodyMetricOnOrBefore(db, date),
      latestBodyMetricOnOrBefore(db, weekAgo),
      hasCreatine(db, date),
    ]);

    const workoutDates = workouts.map((workout) => workout.localDate);
    const routine = nextRoutine(routines, workouts);
    const week = weekProgress(workoutDates, date);

    const response: TodayResponse = {
      date,
      displayName: settings.displayName,
      streak: streakWeeks(workoutDates, settings.weeklyGoal, date),
      next:
        routine === null
          ? null
          : {
              routine,
              estimatedMin: estimateDurationMin(routine, new Map(exercises.map((exercise) => [exercise.id, exercise]))),
            },
      steps,
      stepsGoal: settings.stepsGoal,
      lastWeight,
      // Los dos pesos se toman "hasta" su fecha: si falta alguno no hay tendencia.
      weekWeightDelta:
        lastWeight === null || weightWeekAgo === null ? null : round2(lastWeight.weightKg - weightWeekAgo.weightKg),
      creatineToday,
      week: { count: week.count, goal: settings.weeklyGoal, days: week.days },
    };
    return c.json(response);
  });

  return today;
}
