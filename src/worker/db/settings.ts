import type { NotificationType, Settings, Theme } from "../../shared/types";

const DEFAULT_TIMEZONE = "Europe/Madrid";

// El orden es el de las claves de `notifications` en la respuesta.
const NOTIFICATION_TYPES: NotificationType[] = ["today", "creatine", "steps", "streak", "weight"];

type SettingsRow = {
  display_name: string;
  theme: string;
  timezone: string;
  weekly_goal: number;
  steps_goal: number;
  creatine_grams: number;
  shortcut_name: string;
  notify_today_enabled: number;
  notify_today_time: string;
  notify_creatine_enabled: number;
  notify_creatine_time: string;
  notify_steps_enabled: number;
  notify_steps_time: string;
  notify_streak_enabled: number;
  notify_streak_time: string;
  notify_weight_enabled: number;
  notify_weight_time: string;
};

/** Cambios de ajustes: todo opcional. En `notifications` solo el aviso y el campo que cambian. */
export type SettingsPatch = Partial<Omit<Settings, "notifications">> & {
  notifications?: Partial<Record<NotificationType, Partial<Settings["notifications"][NotificationType]>>>;
};

// Columna de cada ajuste simple. Los nombres de columna salen de aquí, nunca del cliente: los valores van
// siempre como parámetros.
const COLUMNS = {
  displayName: "display_name",
  theme: "theme",
  timezone: "timezone",
  weeklyGoal: "weekly_goal",
  stepsGoal: "steps_goal",
  creatineGrams: "creatine_grams",
  shortcutName: "shortcut_name",
} as const satisfies Record<Exclude<keyof Settings, "notifications">, string>;

/** La zona horaria de los ajustes (fila única). */
export async function getTimezone(db: D1Database): Promise<string> {
  const row = await db.prepare("SELECT timezone FROM settings WHERE id = 1").first<{ timezone: string }>();
  return row?.timezone ?? DEFAULT_TIMEZONE;
}

/** Los ajustes, con las columnas `notify_<tipo>_*` agrupadas en `notifications`. */
export async function getSettings(db: D1Database): Promise<Settings> {
  const row = await db.prepare("SELECT * FROM settings WHERE id = 1").first<SettingsRow>();
  // La migración inicial inserta la fila y nada la borra: si falta, la base de datos está rota.
  if (row === null) throw new Error("Falta la fila de ajustes");

  const notifications = Object.fromEntries(
    NOTIFICATION_TYPES.map((type) => [
      type,
      {
        enabled: row[`notify_${type}_enabled`] === 1,
        time: row[`notify_${type}_time`],
      },
    ]),
  ) as Settings["notifications"];

  return {
    displayName: row.display_name,
    theme: row.theme as Theme,
    timezone: row.timezone,
    weeklyGoal: row.weekly_goal,
    stepsGoal: row.steps_goal,
    creatineGrams: row.creatine_grams,
    shortcutName: row.shortcut_name,
    notifications,
  };
}

/** La sentencia UPDATE que aplica el parche (solo toca las columnas enviadas), o null si el parche está vacío. */
function updateStatement(db: D1Database, patch: SettingsPatch): D1PreparedStatement | null {
  const assignments: string[] = [];
  const values: (string | number)[] = [];

  for (const [key, column] of Object.entries(COLUMNS) as [keyof typeof COLUMNS, string][]) {
    const value = patch[key];
    if (value === undefined) continue;
    assignments.push(`${column} = ?`);
    values.push(value);
  }
  for (const type of NOTIFICATION_TYPES) {
    const change = patch.notifications?.[type];
    if (change?.enabled !== undefined) {
      assignments.push(`notify_${type}_enabled = ?`);
      values.push(change.enabled ? 1 : 0);
    }
    if (change?.time !== undefined) {
      assignments.push(`notify_${type}_time = ?`);
      values.push(change.time);
    }
  }

  if (assignments.length === 0) return null;
  return db.prepare(`UPDATE settings SET ${assignments.join(", ")} WHERE id = 1`).bind(...values);
}

/**
 * Aplica el parche en una sola sentencia UPDATE (solo toca las columnas enviadas) y devuelve los ajustes
 * resultantes. Un parche vacío no escribe nada.
 */
export async function updateSettings(db: D1Database, patch: SettingsPatch): Promise<Settings> {
  await updateStatement(db, patch)?.run();
  return getSettings(db);
}

/**
 * La sentencia que deja la fila de ajustes (la única) con estos valores, sin ejecutarla: la copia de
 * seguridad la mezcla en su lote. Es un UPDATE, nunca un borrado, porque `getSettings` falla sin la fila.
 */
export function replaceSettingsStatement(db: D1Database, settings: Settings): D1PreparedStatement {
  const statement = updateStatement(db, settings);
  // Unos ajustes completos siempre tienen columnas que asignar.
  if (statement === null) throw new Error("Ajustes sin ningún campo");
  return statement;
}
