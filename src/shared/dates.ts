// Fechas y números sin librerías. Funciona igual en la web y en el Worker.
//
// Una fecha local es una cadena YYYY-MM-DD. La aritmética de fechas se hace
// interpretándola en UTC (donde todos los días duran 24 h), así que no le afectan
// los cambios de hora. Para saber qué fecha es "hoy" en una zona, usa localDate().

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

// Un formateador por zona y tipo: construirlos es caro y se llama una vez por entreno listado.
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string, kind: "date" | "time"): Intl.DateTimeFormat {
  const key = `${kind}|${timeZone}`;
  let cached = formatters.get(key);
  if (!cached) {
    cached =
      kind === "date"
        ? new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
        : // h23, no hour12: false, que en algunos motores da "24:05" a medianoche.
          new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    formatters.set(key, cached);
  }
  return cached;
}

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  const found = parts.find((p) => p.type === type);
  if (!found) throw new Error(`Intl no devolvió ${type}`);
  return found.value;
}

/** Fecha (YYYY-MM-DD) que marca el reloj de la zona `tz` en el instante dado. */
export function localDate(instant: Date, tz: string): string {
  const parts = formatter(tz, "date").formatToParts(instant);
  return `${part(parts, "year")}-${part(parts, "month")}-${part(parts, "day")}`;
}

/** Hora (HH:MM, 00:00–23:59) que marca el reloj de la zona `tz` en el instante dado. */
export function localTime(instant: Date, tz: string): string {
  const parts = formatter(tz, "time").formatToParts(instant);
  return `${part(parts, "hour")}:${part(parts, "minute")}`;
}

// Milisegundos UTC de la medianoche de la fecha, o null si no es una fecha real.
function utcMs(date: string): number | null {
  const match = DATE_PATTERN.exec(date);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const ms = Date.UTC(year, month - 1, day);
  // Date.UTC desborda (31 de febrero → marzo) y trata los años 0–99 como 1900–1999: se descartan.
  const check = new Date(ms);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return ms;
}

function requireUtcMs(date: string): number {
  const ms = utcMs(date);
  if (ms === null) throw new RangeError(`Fecha no válida: "${date}" (se esperaba YYYY-MM-DD)`);
  return ms;
}

function formatUtc(ms: number): string {
  const d = new Date(ms);
  const year = String(d.getUTCFullYear()).padStart(4, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** true si es una fecha real en formato YYYY-MM-DD ("2026-02-30" no lo es). */
export function isValidLocalDate(date: string): boolean {
  return utcMs(date) !== null;
}

/** Suma `n` días (puede ser negativo) a una fecha YYYY-MM-DD. Lanza RangeError si la fecha no es válida. */
export function addDays(date: string, n: number): string {
  return formatUtc(requireUtcMs(date) + n * DAY_MS);
}

// Días desde el lunes: lunes = 0 … domingo = 6.
function daysSinceMonday(date: string): number {
  const sunday0 = new Date(requireUtcMs(date)).getUTCDay();
  return (sunday0 + 6) % 7;
}

/** Lunes de la semana a la que pertenece la fecha (la semana empieza en lunes). */
export function weekStart(date: string): string {
  return addDays(date, -daysSinceMonday(date));
}

/** Días que quedan de semana contando hoy: lunes = 7 … domingo = 1. */
export function daysLeftInWeek(date: string): number {
  return 7 - daysSinceMonday(date);
}

/** Las 7 fechas de la semana, de lunes a domingo, a partir del lunes dado. */
export function weekDays(weekStartDate: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStartDate, i));
}

// Admite coma o punto decimal, un signo menos y formas a medias como "5," o ",5".
// No admite separador de miles, notación científica, Infinity ni NaN.
const DECIMAL_PATTERN = /^-?(\d+([.,]\d*)?|[.,]\d+)$/;

/** Convierte lo que escribe el usuario ("57,5") en número, o null si está vacío o no es un número. */
export function parseDecimal(input: string): number | null {
  const text = input.trim();
  if (!DECIMAL_PATTERN.test(text)) return null;
  const value = Number(text.replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

// useGrouping: "always" porque con es-ES "auto" no agrupa los números de 4 cifras (4210, no 4.210).
const thousands = new Intl.NumberFormat("es-ES", { useGrouping: "always" });

/** Formatea con punto de millares: 4210 → "4.210". */
export function formatThousands(n: number): string {
  return thousands.format(n);
}
