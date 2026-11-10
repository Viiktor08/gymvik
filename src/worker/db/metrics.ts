// Peso y grasa corporal, pasos y creatina: lo que cuelga de un día (`local_date`, YYYY-MM-DD).

export type BodyMetric = {
  localDate: string;
  weightKg: number;
  bodyFatPct: number | null;
};

export type CreatineLog = {
  localDate: string;
  grams: number;
  source: "nfc" | "manual";
};

type BodyMetricRow = {
  local_date: string;
  weight_kg: number;
  body_fat_pct: number | null;
};

type CreatineRow = {
  local_date: string;
  grams: number;
  source: "nfc" | "manual";
};

function toBodyMetric(row: BodyMetricRow): BodyMetric {
  return { localDate: row.local_date, weightKg: row.weight_kg, bodyFatPct: row.body_fat_pct };
}

/** Redondea a 2 decimales, para que la suma en coma flotante no deje ruido (79,7 − 80,5 = −0,7999…). */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// --- Peso y grasa corporal ---

/** Guarda el peso del día reemplazando el que hubiera (grasa incluida) y devuelve lo guardado. */
export async function upsertBodyMetric(
  db: D1Database,
  localDate: string,
  weightKg: number,
  bodyFatPct: number | null,
): Promise<BodyMetric> {
  const row = await db
    .prepare(
      `INSERT INTO body_metrics (local_date, weight_kg, body_fat_pct) VALUES (?1, ?2, ?3)
       ON CONFLICT (local_date) DO UPDATE SET weight_kg = excluded.weight_kg, body_fat_pct = excluded.body_fat_pct
       RETURNING local_date, weight_kg, body_fat_pct`,
    )
    .bind(localDate, weightKg, bodyFatPct)
    .first<BodyMetricRow>();
  if (row === null) throw new Error(`El peso del ${localDate} desapareció tras guardarlo`);
  return toBodyMetric(row);
}

/** Borra el peso del día. False si no había. */
export async function deleteBodyMetric(db: D1Database, localDate: string): Promise<boolean> {
  const { results } = await db
    .prepare("DELETE FROM body_metrics WHERE local_date = ? RETURNING local_date")
    .bind(localDate)
    .all();
  return results.length === 1;
}

/** El último peso con fecha igual o anterior a `localDate`, o null si no hay ninguno. */
export async function latestBodyMetricOnOrBefore(db: D1Database, localDate: string): Promise<BodyMetric | null> {
  const row = await db
    .prepare(
      `SELECT local_date, weight_kg, body_fat_pct FROM body_metrics
        WHERE local_date <= ? ORDER BY local_date DESC LIMIT 1`,
    )
    .bind(localDate)
    .first<BodyMetricRow>();
  return row === null ? null : toBodyMetric(row);
}

/** Los pesos de menor a mayor fecha. Con `from` (YYYY-MM-DD), solo los de esa fecha en adelante. */
export async function listBodyMetrics(db: D1Database, from?: string): Promise<BodyMetric[]> {
  const { results } = await db
    .prepare(
      `SELECT local_date, weight_kg, body_fat_pct FROM body_metrics
        WHERE (?1 IS NULL OR local_date >= ?1) ORDER BY local_date`,
    )
    .bind(from ?? null)
    .all<BodyMetricRow>();
  return results.map(toBodyMetric);
}

// --- Pasos (los escribe el Atajo de iOS) ---

/** Los pasos del día, o null si no hay dato. 0 es un dato. */
export async function getSteps(db: D1Database, localDate: string): Promise<number | null> {
  const row = await db
    .prepare("SELECT steps FROM daily_steps WHERE local_date = ?")
    .bind(localDate)
    .first<{ steps: number }>();
  return row?.steps ?? null;
}

/** Guarda los pasos del día reemplazando los que hubiera (el último valor enviado es el que vale). */
export async function upsertSteps(db: D1Database, localDate: string, steps: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO daily_steps (local_date, steps) VALUES (?1, ?2)
       ON CONFLICT (local_date) DO UPDATE SET
         steps = excluded.steps, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    )
    .bind(localDate, steps)
    .run();
}

/** Los pasos de todos los días, de menor a mayor fecha. */
export async function listAllSteps(db: D1Database): Promise<{ localDate: string; steps: number }[]> {
  const { results } = await db
    .prepare("SELECT local_date, steps FROM daily_steps ORDER BY local_date")
    .all<{ local_date: string; steps: number }>();
  return results.map((row) => ({ localDate: row.local_date, steps: row.steps }));
}

/** Los pasos de los días entre `from` y `to` (YYYY-MM-DD, ambos incluidos). */
export async function listSteps(
  db: D1Database,
  from: string,
  to: string,
): Promise<{ localDate: string; steps: number }[]> {
  const { results } = await db
    .prepare("SELECT local_date, steps FROM daily_steps WHERE local_date >= ? AND local_date <= ? ORDER BY local_date")
    .bind(from, to)
    .all<{ local_date: string; steps: number }>();
  return results.map((row) => ({ localDate: row.local_date, steps: row.steps }));
}

// --- Creatina ---

/** Si hay toma de creatina ese día. */
export async function hasCreatine(db: D1Database, localDate: string): Promise<boolean> {
  const row = await db.prepare("SELECT 1 AS found FROM creatine_logs WHERE local_date = ?").bind(localDate).first();
  return row !== null;
}

/** Todas las tomas de creatina, de menor a mayor fecha. */
export async function listCreatineLogs(db: D1Database): Promise<CreatineLog[]> {
  const { results } = await db
    .prepare("SELECT local_date, grams, source FROM creatine_logs ORDER BY local_date")
    .all<CreatineRow>();
  return results.map((row) => ({ localDate: row.local_date, grams: row.grams, source: row.source }));
}

/** Los días con toma entre `from` y `to` (YYYY-MM-DD, ambos incluidos). */
export async function listCreatineDates(db: D1Database, from: string, to: string): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT local_date FROM creatine_logs WHERE local_date >= ? AND local_date <= ? ORDER BY local_date")
    .bind(from, to)
    .all<{ local_date: string }>();
  return results.map((row) => row.local_date);
}

/** Marca el día reemplazando la toma que hubiera (gramos y origen) y devuelve lo guardado. */
export async function upsertCreatine(
  db: D1Database,
  localDate: string,
  grams: number,
  source: CreatineLog["source"],
): Promise<CreatineLog> {
  const row = await db
    .prepare(
      `INSERT INTO creatine_logs (local_date, grams, source) VALUES (?1, ?2, ?3)
       ON CONFLICT (local_date) DO UPDATE SET grams = excluded.grams, source = excluded.source
       RETURNING local_date, grams, source`,
    )
    .bind(localDate, grams, source)
    .first<CreatineRow>();
  if (row === null) throw new Error(`La creatina del ${localDate} desapareció tras guardarla`);
  return { localDate: row.local_date, grams: row.grams, source: row.source };
}

/**
 * Marca el día solo si no estaba marcado, en una única sentencia (atómica aunque lleguen dos peticiones a la
 * vez). Devuelve la toma creada, o null si ya existía una: esa no se toca.
 */
export async function insertCreatineIfAbsent(
  db: D1Database,
  localDate: string,
  grams: number,
  source: CreatineLog["source"],
): Promise<CreatineLog | null> {
  const row = await db
    .prepare(
      `INSERT INTO creatine_logs (local_date, grams, source) VALUES (?1, ?2, ?3)
       ON CONFLICT (local_date) DO NOTHING
       RETURNING local_date, grams, source`,
    )
    .bind(localDate, grams, source)
    .first<CreatineRow>();
  return row === null ? null : { localDate: row.local_date, grams: row.grams, source: row.source };
}

/** Desmarca el día. False si no había toma. */
export async function deleteCreatine(db: D1Database, localDate: string): Promise<boolean> {
  const { results } = await db
    .prepare("DELETE FROM creatine_logs WHERE local_date = ? RETURNING local_date")
    .bind(localDate)
    .all();
  return results.length === 1;
}
