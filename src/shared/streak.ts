// Progreso de la semana y racha de semanas cumplidas. Funciones puras: las usan la pantalla de hoy,
// la de progreso y las notificaciones. Todas las fechas son YYYY-MM-DD (ver dates.ts) y la semana
// empieza el lunes.
import { addDays, weekDays, weekStart } from "./dates";

/**
 * Entrenos de la semana a la que pertenece `today` y qué días (lunes a domingo) tienen alguno.
 * `workoutDates` puede venir desordenado y repetir fechas: dos entrenos el mismo día cuentan 2
 * en `count`, aunque el día solo se marca una vez en `days`.
 */
export function weekProgress(workoutDates: string[], today: string): { count: number; days: boolean[] } {
  const week = weekDays(weekStart(today));
  const perDay = new Map(week.map((date) => [date, 0]));
  let count = 0;
  for (const date of workoutDates) {
    const n = perDay.get(date);
    if (n === undefined) continue;
    perDay.set(date, n + 1);
    count += 1;
  }
  return { count, days: week.map((date) => (perDay.get(date) ?? 0) > 0) };
}

/**
 * Semanas cumplidas consecutivas. Una semana está cumplida si tiene al menos `goal` entrenos (4/3 vale).
 * Se cuenta hacia atrás desde la última semana cerrada y se suma 1 si la semana actual ya está cumplida;
 * una semana actual sin cumplir no rompe la racha. Las semanas futuras no cuentan.
 * Con un objetivo menor que 1 (o no numérico) no hay racha: todas las semanas estarían cumplidas.
 */
export function streakWeeks(workoutDates: string[], goal: number, today: string): number {
  if (!(goal >= 1)) return 0;

  const perWeek = new Map<string, number>();
  for (const date of workoutDates) {
    const monday = weekStart(date);
    perWeek.set(monday, (perWeek.get(monday) ?? 0) + 1);
  }
  const met = (monday: string) => (perWeek.get(monday) ?? 0) >= goal;

  const currentWeek = weekStart(today);
  let streak = met(currentWeek) ? 1 : 0;
  // Con goal ≥ 1 una semana sin entrenos no está cumplida, así que el bucle termina siempre.
  for (let monday = addDays(currentWeek, -7); met(monday); monday = addDays(monday, -7)) {
    streak += 1;
  }
  return streak;
}
