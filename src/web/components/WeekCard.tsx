import { useId } from "react";
import { isValidLocalDate, weekDays, weekStart } from "../../shared/dates";
import { CheckIcon } from "./icons";

type Props = {
  /** Fecha de hoy (YYYY-MM-DD), la del servidor. */
  date: string;
  count: number;
  goal: number;
  /** De lunes a domingo: `true` si ese día hubo entreno. */
  days: readonly boolean[];
};

const DAYS = [
  { initial: "L", name: "Lunes" },
  { initial: "M", name: "Martes" },
  { initial: "X", name: "Miércoles" },
  { initial: "J", name: "Jueves" },
  { initial: "V", name: "Viernes" },
  { initial: "S", name: "Sábado" },
  { initial: "D", name: "Domingo" },
] as const;

/** La semana de lunes a domingo, con los días con entreno y el contador "N/objetivo" (4/3 se enseña tal cual). */
export function WeekCard({ date, count, goal, days }: Props) {
  const titleId = useId();
  const todayIndex = isValidLocalDate(date) ? weekDays(weekStart(date)).indexOf(date) : -1;
  const met = goal > 0 && count >= goal;

  return (
    <section className="card" aria-labelledby={titleId}>
      <div className="card-row">
        <h2 id={titleId} className="card-title">
          Esta semana
        </h2>
        <span className="week-count">{`${count}/${goal}`}</span>
      </div>
      <ol className="week">
        {DAYS.map((day, index) => {
          const trained = days[index] === true;
          return (
            <li
              key={day.name}
              className={trained ? "week-day week-day-done" : "week-day"}
              aria-label={`${day.name}: ${trained ? "con entreno" : "sin entreno"}`}
              aria-current={index === todayIndex ? "date" : undefined}
            >
              <span className="week-dot" aria-hidden="true">
                {trained ? <CheckIcon /> : null}
              </span>
              <span className="week-initial" aria-hidden="true">
                {day.initial}
              </span>
            </li>
          );
        })}
      </ol>
      {met ? <p className="week-met">Objetivo cumplido</p> : null}
    </section>
  );
}
