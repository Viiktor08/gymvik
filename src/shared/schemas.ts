// Esquemas zod equivalentes a los tipos de types.ts. El Worker los usa para validar toda la entrada.
// Los que tienen tipo propio llevan `satisfies z.ZodType<…>`: si el esquema deja de encajar con el tipo,
// el typecheck falla.
//
// workoutSchema y routineSchema son objetos sin refine() a propósito: zod no deja usar .omit() ni .pick()
// sobre un objeto con refinamientos, y los endpoints quitan campos (p. ej. localDate, que calcula el servidor).

import { z } from "zod";
import { isValidLocalDate } from "./dates";
import type { Exercise, Routine, Settings, Workout } from "./types";

// --- Piezas comunes ---

const idSchema = z.string().min(1).max(100);

const localDateSchema = z.string().refine(isValidLocalDate, "Fecha no válida (se espera YYYY-MM-DD)");

// Instante en UTC, como lo da Date.toISOString().
const instantSchema = z.iso.datetime();

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora no válida (se espera HH:MM)");

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

const timezoneSchema = z.string().refine(isValidTimeZone, "Zona horaria no válida");

const nonNegative = z.number().min(0);

const gramsSchema = z.number().positive().max(100);

const MAX_STEPS = 200_000;

const stepsSchema = z.number().int().min(0).max(MAX_STEPS);

// --- Ejercicios ---

const categorySchema = z.enum(["strength", "cardio", "core", "power", "mobility", "feet"]);

const exerciseNameSchema = z.string().trim().min(1).max(100);

// Solo https://, que es lo que exige también el CHECK de la columna media_url. Se recortan los espacios
// de un enlace pegado antes de comprobarlo.
const mediaUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .regex(/^https:\/\//i, "Solo se admiten enlaces https://")
  .pipe(z.url({ protocol: /^https$/ }));

/** Ejercicio completo, tal como se lista y se exporta. */
export const exerciseSchema = z.object({
  id: idSchema,
  name: exerciseNameSchema,
  category: categorySchema,
  muscle: z.string().max(100),
  description: z.string().max(2000),
  mediaUrl: mediaUrlSchema.nullable(),
  isCustom: z.boolean(),
  archived: z.boolean(),
}) satisfies z.ZodType<Exercise>;

/** Cuerpo para crear o editar un ejercicio. El id y isCustom los pone el servidor. */
export const exerciseInputSchema = z.object({
  name: exerciseNameSchema,
  category: categorySchema,
  muscle: z.string().trim().max(100).default(""),
  description: z.string().trim().max(2000).default(""),
  mediaUrl: mediaUrlSchema.nullable().default(null),
  archived: z.boolean().optional(),
});

// --- Rutinas ---

const routineItemSchema = z.object({
  exerciseId: idSchema,
  position: z.number().int().min(0),
  sets: z.number().int().min(1).max(20),
  repsTarget: z.string().trim().min(1).max(30),
  restSeconds: z.number().int().min(0).max(3600),
});

export const routineSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(100),
  inRotation: z.boolean(),
  rotationOrder: z.number().int().min(0),
  archived: z.boolean(),
  items: z.array(routineItemSchema),
}) satisfies z.ZodType<Routine>;

// --- Entrenos ---

// Peso, repeticiones, minutos y kilómetros nunca son negativos. Todo es opcional (null): una fila de
// fuerza no tiene distancia ni una de cardio tiene RIR.
const setEntrySchema = z.object({
  weightKg: nonNegative.nullable(),
  reps: z.number().int().min(0).nullable(),
  rir: z.number().int().min(0).max(10).nullable(),
  durationMin: nonNegative.nullable(),
  distanceKm: nonNegative.nullable(),
});

export const workoutSchema = z.object({
  id: idSchema,
  routineId: idSchema.nullable(),
  startedAt: instantSchema,
  endedAt: instantSchema,
  localDate: localDateSchema,
  notes: z.string().max(5000),
  source: z.enum(["live", "manual"]),
  exercises: z.array(
    z.object({
      exerciseId: idSchema,
      sets: z.array(setEntrySchema),
    }),
  ),
}) satisfies z.ZodType<Workout>;

// --- Ajustes ---

const notificationTypeSchema = z.enum(["today", "creatine", "steps", "streak", "weight"]);

const notificationShape = {
  enabled: z.boolean(),
  time: timeSchema,
};

const notificationSchema = z.object(notificationShape);
const notificationPatchSchema = z.strictObject(notificationShape).partial();

const themeSchema = z.enum(["green", "blue", "purple", "red", "orange", "pink", "teal", "graphite"]);

const displayNameSchema = z.string().trim().min(1).max(50);
const weeklyGoalSchema = z.number().int().min(1).max(7);
const stepsGoalSchema = z.number().int().min(1).max(MAX_STEPS);
const shortcutNameSchema = z.string().trim().min(1).max(100);

export const settingsSchema = z.object({
  displayName: displayNameSchema,
  theme: themeSchema,
  timezone: timezoneSchema,
  weeklyGoal: weeklyGoalSchema,
  stepsGoal: stepsGoalSchema,
  creatineGrams: gramsSchema,
  shortcutName: shortcutNameSchema,
  notifications: z.record(notificationTypeSchema, notificationSchema),
}) satisfies z.ZodType<Settings>;

/**
 * Parche de ajustes: todo opcional y sin claves desconocidas. En `notifications` se puede mandar solo el
 * aviso que cambia, y de él solo `enabled` o `time`.
 */
export const settingsPatchSchema = z.strictObject({
  displayName: displayNameSchema.optional(),
  theme: themeSchema.optional(),
  timezone: timezoneSchema.optional(),
  weeklyGoal: weeklyGoalSchema.optional(),
  stepsGoal: stepsGoalSchema.optional(),
  creatineGrams: gramsSchema.optional(),
  shortcutName: shortcutNameSchema.optional(),
  notifications: z.partialRecord(notificationTypeSchema, notificationPatchSchema).optional(),
});

// --- Atajos de iOS y NFC ---

export const stepsHookSchema = z.object({
  steps: stepsSchema,
  date: localDateSchema.optional(),
});

export const creatineHookSchema = z.object({
  grams: gramsSchema.optional(),
});

// --- Copia de seguridad ---

export const backupSchema = z.object({
  version: z.literal(1),
  exportedAt: instantSchema,
  exercises: z.array(exerciseSchema),
  routines: z.array(routineSchema),
  workouts: z.array(workoutSchema),
  bodyMetrics: z.array(
    z.object({
      localDate: localDateSchema,
      weightKg: z.number().positive(),
      bodyFatPct: z.number().min(0).max(100).nullable(),
    }),
  ),
  dailySteps: z.array(
    z.object({
      localDate: localDateSchema,
      steps: stepsSchema,
    }),
  ),
  creatineLogs: z.array(
    z.object({
      localDate: localDateSchema,
      grams: gramsSchema,
      source: z.enum(["nfc", "manual"]),
    }),
  ),
  settings: settingsSchema,
});
