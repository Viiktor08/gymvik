import { isValidLocalDate } from "../shared/dates";

/** Espacio duro: que "74,3 kg" y "18,5 %" no se partan en dos líneas. */
export const NBSP = " ";

const decimal = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2, useGrouping: false });

/** 74.3 → "74,3". Lo que no es un número finito sale como "—", nunca como NaN o Infinity. */
export function formatDecimal(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  // -0 se escribiría "-0".
  return decimal.format(value === 0 ? 0 : value);
}

/** Diferencia con signo: 0.4 → "+0,4", -0.4 → "−0,4" (signo menos de verdad), 0 → "0". */
export function formatSigned(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const rounded = Math.round(value * 100) / 100;
  if (rounded === 0) return "0";
  return `${rounded > 0 ? "+" : "−"}${formatDecimal(Math.abs(rounded))}`;
}

// La fecha del servidor es un día de calendario, no un instante: se interpreta en UTC y se formatea en UTC,
// así la zona horaria del móvil no la mueve un día.
const longDate = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const shortDate = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", timeZone: "UTC" });

function utcInstant(localDate: string): Date | null {
  return isValidLocalDate(localDate) ? new Date(`${localDate}T00:00:00Z`) : null;
}

/** "2026-11-10" → "Martes, 10 de noviembre". Una fecha no válida sale vacía. */
export function formatLongDate(localDate: string): string {
  const instant = utcInstant(localDate);
  if (!instant) return "";
  const text = longDate.format(instant);
  return text.charAt(0).toLocaleUpperCase("es") + text.slice(1);
}

/** "2026-11-09" → "9 nov". Una fecha no válida sale vacía. */
export function formatShortDate(localDate: string): string {
  const instant = utcInstant(localDate);
  return instant ? shortDate.format(instant).replace(".", "") : "";
}

const mediumDate = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** "2026-11-09" → "9 nov 2026". Una fecha no válida sale vacía. */
export function formatMediumDate(localDate: string): string {
  const instant = utcInstant(localDate);
  return instant ? mediumDate.format(instant).replaceAll(".", "") : "";
}

/** 90 → "1:30", 3723 → "1:02:03". Lo que no es un número finito o es negativo sale como "0:00". */
export function formatClock(totalSeconds: number): string {
  const seconds = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.floor(totalSeconds) : 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Ritmo en min/km: 5.5 → "5:30 min/km". Un ritmo que no es un número finito mayor que 0 sale como "—". */
export function formatPace(minPerKm: number): string {
  if (!Number.isFinite(minPerKm) || minPerKm <= 0) return "—";
  const total = Math.round(minPerKm * 60);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")} min/km`;
}

/** 45 → "45 min", 65 → "1 h 05 min". Lo que no es un número finito o es negativo sale como "0 min". */
export function formatMinutes(minutes: number): string {
  const total = Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : 0;
  if (total < 60) return `${total} min`;
  return `${Math.floor(total / 60)} h ${String(total % 60).padStart(2, "0")} min`;
}
