import { useId } from "react";
import { formatThousands } from "../../shared/dates";
import type { WeeklySummary } from "../../shared/weekly";
import { NBSP, formatDecimal, formatMinutes } from "../format";
import type { WeekProgress } from "../progressData";

type Props = {
  data: WeekProgress;
};

type Direction = "up" | "down" | "same";

type Metric = {
  label: string;
  /** El valor tal como se enseña (ya redondeado), o `null` si no hay dato. */
  read: (summary: WeeklySummary) => number | null;
  show: (value: number) => string;
};

const ARROWS: Record<Direction, { glyph: string; label: string; className: string }> = {
  up: { glyph: "↑", label: "Más que la semana anterior", className: "delta delta-up" },
  down: { glyph: "↓", label: "Menos que la semana anterior", className: "delta delta-down" },
  same: { glyph: "=", label: "Igual que la semana anterior", className: "delta" },
};

function rounded(value: number | null, decimals: 0 | 1): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = decimals === 0 ? 1 : 10;
  return Math.round(value * factor) / factor;
}

function metrics(goal: number): readonly Metric[] {
  return [
    { label: "Entrenos", read: (s) => rounded(s.workouts, 0), show: (n) => `${n}/${goal}` },
    { label: "Volumen", read: (s) => rounded(s.volumeKg, 1), show: (n) => `${formatThousands(n)}${NBSP}kg` },
    { label: "Cardio (tiempo)", read: (s) => rounded(s.cardioMin, 0), show: formatMinutes },
    { label: "Cardio (distancia)", read: (s) => rounded(s.cardioKm, 1), show: (n) => `${formatDecimal(n)}${NBSP}km` },
    { label: "Pasos medios", read: (s) => rounded(s.avgSteps, 0), show: formatThousands },
    { label: "Días con creatina", read: (s) => rounded(s.creatineDays, 0), show: (n) => `${n}/7` },
  ];
}

/** Se compara lo que se enseña, así una flecha nunca contradice los dos números que tiene al lado. */
function direction(current: number | null, previous: number | null): Direction | null {
  if (current === null || previous === null) return null;
  if (current > previous) return "up";
  return current < previous ? "down" : "same";
}

function hasData(summary: WeeklySummary): boolean {
  return (
    summary.workouts > 0 ||
    summary.volumeKg > 0 ||
    summary.cardioMin > 0 ||
    summary.cardioKm > 0 ||
    summary.avgSteps !== null ||
    summary.creatineDays > 0
  );
}

function entrenos(n: number): string {
  return n === 1 ? "1 entreno" : `${n} entrenos`;
}

function semanas(n: number): string {
  return n === 1 ? "1 semana" : `${n} semanas`;
}

/** La semana actual frente a la anterior, con una flecha ↑/↓ en cada métrica, y la racha. */
export function WeekCompare({ data }: Props) {
  const streakId = useId();
  const { current, previous, streak, goal } = data;

  if (!hasData(current) && !hasData(previous)) return <p className="muted">Sin datos todavía</p>;

  return (
    <>
      <section className="card" aria-labelledby={streakId}>
        <h2 id={streakId} className="card-title">
          Racha
        </h2>
        <p className="metric">{streak > 0 ? semanas(streak) : "Sin racha todavía"}</p>
        <p className="muted">Semanas seguidas cumpliendo el objetivo.</p>
        <p className="muted">{`Objetivo: ${entrenos(goal)} por semana`}</p>
      </section>

      <div className="card">
        <table className="compare">
          <caption className="card-title">Esta semana frente a la anterior</caption>
          <thead>
            <tr>
              <th scope="col">
                <span className="visually-hidden">Métrica</span>
              </th>
              <th scope="col">Esta semana</th>
              <th scope="col">Anterior</th>
            </tr>
          </thead>
          <tbody>
            {metrics(goal).map((metric) => {
              const now = metric.read(current);
              const before = metric.read(previous);
              const change = direction(now, before);
              const arrow = change === null ? null : ARROWS[change];
              return (
                <tr key={metric.label}>
                  <th scope="row">{metric.label}</th>
                  <td className="compare-now">
                    <span>{now === null ? "—" : metric.show(now)}</span>
                    {arrow ? (
                      <span className={arrow.className} role="img" aria-label={arrow.label}>
                        {arrow.glyph}
                      </span>
                    ) : null}
                  </td>
                  <td className="compare-before">{before === null ? "—" : metric.show(before)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
