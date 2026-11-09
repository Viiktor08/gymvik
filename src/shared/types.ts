// Tipos de dominio compartidos entre la web y el Worker. Solo tipos: sin APIs de DOM ni de Workers.
// schemas.ts tiene los esquemas zod equivalentes que usa el Worker para validar la entrada.

export type Category = "strength" | "cardio" | "core" | "power" | "mobility" | "feet";

export type Exercise = {
  id: string;
  name: string;
  category: Category;
  muscle: string;
  description: string;
  mediaUrl: string | null;
  isCustom: boolean;
  archived: boolean;
};

export type RoutineItem = {
  exerciseId: string;
  position: number;
  sets: number;
  // Texto libre: "8-10", "12", "20 min".
  repsTarget: string;
  restSeconds: number;
};

export type Routine = {
  id: string;
  name: string;
  inRotation: boolean;
  rotationOrder: number;
  archived: boolean;
  items: RoutineItem[];
};

// Una serie guardada. Fuerza usa peso y repeticiones (RIR opcional); cardio, minutos y distancia.
export type SetEntry = {
  weightKg: number | null;
  reps: number | null;
  rir: number | null;
  durationMin: number | null;
  distanceKm: number | null;
};

// Serie de una sesión en curso: solo las marcadas como hechas se guardan y cuentan para estadísticas.
export type DraftSet = SetEntry & { done: boolean };

export type WorkoutExercise = {
  exerciseId: string;
  sets: SetEntry[];
};

export type Workout = {
  // Lo genera el cliente (uuid) para que reenviar el entreno sea idempotente.
  id: string;
  routineId: string | null;
  // Instantes en UTC (ISO 8601).
  startedAt: string;
  endedAt: string;
  // YYYY-MM-DD en la zona horaria del usuario.
  localDate: string;
  notes: string;
  source: "live" | "manual";
  exercises: WorkoutExercise[];
};

export type NotificationType = "today" | "creatine" | "steps" | "streak" | "weight";

export type Theme = "green" | "blue" | "purple" | "red" | "orange" | "pink" | "teal" | "graphite";

export type Settings = {
  displayName: string;
  theme: Theme;
  // Zona horaria IANA, por ejemplo "Europe/Madrid".
  timezone: string;
  weeklyGoal: number;
  stepsGoal: number;
  creatineGrams: number;
  shortcutName: string;
  // `time` es la hora local en formato HH:MM.
  notifications: Record<NotificationType, { enabled: boolean; time: string }>;
};
