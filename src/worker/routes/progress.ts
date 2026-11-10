import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { addDays, localDate, weekStart } from "../../shared/dates";
import { CARDIO_KINDS, STRENGTH_KINDS, exerciseRecords, sessionStats } from "../../shared/records";
import type { RecordKind } from "../../shared/records";
import { streakWeeks } from "../../shared/streak";
import { weeklySummary } from "../../shared/weekly";
import type { WeeklySummary } from "../../shared/weekly";
import { findExercise, listExercises } from "../db/exercises";
import { listBodyMetrics, listCreatineDates, listSteps, round2 } from "../db/metrics";
import type { BodyMetric } from "../db/metrics";
import { getSettings } from "../db/settings";
import { listWorkoutRefs, listWorkoutsBetween, listWorkoutsOfExercise } from "../db/workouts";
import type { Env } from "../env";
import { parseLocalDate } from "../http";

// Semanas que abarca cada rango (el último solo se acota con "all"). Sin `range`, 12 semanas.
const rangeSchema = z.enum(["4w", "12w", "all"]).default("12w");
const RANGE_WEEKS = { "4w": 4, "12w": 12 } as const;

// La media móvil abarca el día del punto y los 6 anteriores.
const AVERAGE_DAYS = 7;

/**
 * Media de los pesos de la ventana de 7 días naturales que acaba en `point`, que es `metrics[index]`
 * (ordenados por fecha), a 2 decimales.
 */
function movingAverage(metrics: BodyMetric[], index: number, point: BodyMetric): number {
  const windowStart = addDays(point.localDate, -(AVERAGE_DAYS - 1));
  let sum = 0;
  let count = 0;
  for (let i = index; i >= 0; i--) {
    const metric = metrics[i];
    if (metric === undefined || metric.localDate < windowStart) break;
    sum += metric.weightKg;
    count += 1;
  }
  // El propio punto siempre está en la ventana: count >= 1.
  return round2(sum / count);
}

/** Cifras de la semana sin el ruido de la suma en coma flotante (8,299999999999999 km). */
function tidy(summary: WeeklySummary): WeeklySummary {
  return {
    workouts: summary.workouts,
    volumeKg: round2(summary.volumeKg),
    cardioMin: round2(summary.cardioMin),
    cardioKm: round2(summary.cardioKm),
    avgSteps: summary.avgSteps === null ? null : round2(summary.avgSteps),
    creatineDays: summary.creatineDays,
  };
}

/** Rutas /api/progress: datos agregados de las pantallas de progreso. */
export function progressRoutes(): Hono<{ Bindings: Env }> {
  const progress = new Hono<{ Bindings: Env }>();

  // Peso con media móvil de 7 días. `range`: 4w o 12w (los últimos 28 u 84 días, hoy incluido) o all.
  progress.get("/weight", async (c) => {
    const range = rangeSchema.safeParse(c.req.query("range"));
    if (!range.success) throw new HTTPException(400, { message: "Rango no válido (4w, 12w o all)" });

    const db = c.env.DB;
    const { timezone } = await getSettings(db);
    const weeks = range.data === "all" ? null : RANGE_WEEKS[range.data];
    const from = weeks === null ? null : addDays(localDate(new Date(), timezone), -(weeks * 7 - 1));

    // Se cargan también los 6 días anteriores al rango: la media del primer punto los necesita.
    const metrics = await listBodyMetrics(db, from === null ? undefined : addDays(from, -(AVERAGE_DAYS - 1)));
    const points = metrics.flatMap((metric, index) =>
      from !== null && metric.localDate < from ? [] : [{ ...metric, avg7: movingAverage(metrics, index, metric) }],
    );
    return c.json({ points });
  });

  // La semana que empieza en `start` (por defecto la actual) frente a la anterior. Si `start` no es lunes,
  // se usa el lunes de su semana. La racha es la de hoy, sea cual sea la semana consultada.
  progress.get("/week", async (c) => {
    const db = c.env.DB;
    const requested = c.req.query("start");
    const settings = await getSettings(db);
    const today = localDate(new Date(), settings.timezone);
    const current = weekStart(requested === undefined ? today : parseLocalDate(requested));
    const previous = addDays(current, -7);
    const end = addDays(current, 6);

    const [workouts, steps, creatineDates, exercises, refs] = await Promise.all([
      listWorkoutsBetween(db, previous, end),
      listSteps(db, previous, end),
      listCreatineDates(db, previous, end),
      listExercises(db, true),
      listWorkoutRefs(db),
    ]);
    const data = {
      workouts,
      steps,
      creatineDates,
      exercises: new Map(exercises.map((exercise) => [exercise.id, exercise])),
    };

    return c.json({
      current: tidy(weeklySummary(current, data)),
      previous: tidy(weeklySummary(previous, data)),
      streak: streakWeeks(
        refs.map((ref) => ref.localDate),
        settings.weeklyGoal,
        today,
      ),
      goal: settings.weeklyGoal,
    });
  });

  // Una sesión por entreno en el que se hizo el ejercicio, de menor a mayor fecha, y sus récords.
  progress.get("/exercise/:id", async (c) => {
    const db = c.env.DB;
    const id = c.req.param("id");
    const exercise = await findExercise(db, id);
    if (exercise === null) throw new HTTPException(404, { message: "Ejercicio no encontrado" });

    const workouts = await listWorkoutsOfExercise(db, id);
    const chronological = [...workouts].sort(
      (a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    const sessions = chronological.flatMap((workout) => {
      // Si el ejercicio sale dos veces en el entreno, sus series cuentan como una sola sesión.
      const sets = workout.exercises.filter((entry) => entry.exerciseId === id).flatMap((entry) => entry.sets);
      const stats = sessionStats({ exerciseId: id, sets });
      // Sin ninguna serie válida (peso y repeticiones, o distancia) la sesión no aporta nada que dibujar.
      if (stats.maxWeight === null && stats.maxDistance === null) return [];
      return [{ localDate: workout.localDate, ...stats }];
    });

    const all = exerciseRecords(id, workouts);
    const kinds: readonly RecordKind[] = exercise.category === "cardio" ? CARDIO_KINDS : STRENGTH_KINDS;
    const records = Object.fromEntries(kinds.flatMap((kind) => (all[kind] ? [[kind, all[kind]]] : [])));

    return c.json({ sessions, records });
  });

  return progress;
}
