import type { ReactNode } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import type { Category } from "../../shared/types";
import { NBSP, formatDecimal, formatMediumDate, formatShortDate } from "../format";
import type { ExerciseSession } from "../progressData";

type Props = {
  sessions: readonly ExerciseSession[];
  category: Category;
};

type SeriesKey = "maxWeight" | "best1RM" | "maxDistance";

type Series = {
  key: SeriesKey;
  label: string;
  unit: string;
  /** Variable CSS del color (definidas en styles.css, con su variante oscura). */
  color: string;
  /** Clase de la muestra de color de la leyenda y del tooltip. */
  swatch: string;
};

// Fuerza: peso máximo y 1RM estimado por sesión (spec §5.6). Cardio: distancia máxima.
const STRENGTH: readonly Series[] = [
  { key: "maxWeight", label: "Peso máximo", unit: "kg", color: "var(--series-1)", swatch: "chart-key-1" },
  { key: "best1RM", label: "1RM estimado", unit: "kg", color: "var(--series-2)", swatch: "chart-key-2" },
];
const CARDIO: readonly Series[] = [{ key: "maxDistance", label: "Distancia máxima", unit: "km", color: "var(--series-1)", swatch: "chart-key-1" }];

const HEIGHT = 200;
const AXIS_TICK = { fill: "var(--chart-text)", fontSize: 12 };

type Point = { date: string } & Record<SeriesKey, number | null>;

/** Solo un número finito se dibuja: lo demás es un hueco, nunca NaN ni Infinity. */
function finite(value: number | null): number | null {
  return value !== null && Number.isFinite(value) ? value : null;
}

function valueText(value: number | null, unit: string): string {
  return value === null ? "—" : `${formatDecimal(value)}${NBSP}${unit}`;
}

function ChartTooltip({ active, payload, label, series }: Partial<TooltipContentProps> & { series: readonly Series[] }) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-date">{typeof label === "string" ? formatMediumDate(label) : ""}</p>
      {series.map((item) => {
        const entry = payload.find((p) => p.dataKey === item.key);
        const value = typeof entry?.value === "number" ? entry.value : null;
        return (
          <p key={item.key} className="chart-tooltip-row">
            <span className={`chart-key ${item.swatch}`} aria-hidden="true" />
            {item.label}: <strong>{valueText(value, item.unit)}</strong>
          </p>
        );
      })}
    </div>
  );
}

/** Lo que lee un lector de pantalla en lugar del dibujo. */
function summary(series: readonly Series[], points: readonly Point[]): string {
  const last = points[points.length - 1];
  const sessions = points.length === 1 ? "1 sesión" : `${points.length} sesiones`;
  const latest = series.map((item) => `${item.label} ${valueText(last?.[item.key] ?? null, item.unit)}`);
  return `${series.map((item) => item.label).join(" y ")} por sesión, ${sessions}. Última: ${latest.join(", ")}.`;
}

/** Evolución de un ejercicio sesión a sesión. Sin ningún dato dibujable, "Sin datos todavía". */
export function ExerciseChart({ sessions, category }: Props): ReactNode {
  const series = category === "cardio" ? CARDIO : STRENGTH;
  const points: Point[] = sessions.map((session) => ({
    date: session.localDate,
    maxWeight: finite(session.maxWeight),
    best1RM: finite(session.best1RM),
    maxDistance: finite(session.maxDistance),
  }));
  // Una sesión sin ningún valor de esta gráfica (por ejemplo, solo repeticiones) no aporta un punto.
  const drawable = points.filter((point) => series.some((item) => point[item.key] !== null));

  if (drawable.length === 0) return <p className="muted">Sin datos todavía</p>;

  return (
    <figure className="chart">
      <figcaption className="chart-title">{series.map((item) => item.label).join(" y ")}</figcaption>
      {series.length > 1 ? (
        <ul className="chart-legend">
          {series.map((item) => (
            <li key={item.key}>
              <span className={`chart-key ${item.swatch}`} aria-hidden="true" />
              {item.label}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="chart-frame" role="img" aria-label={summary(series, drawable)}>
        <ResponsiveContainer width="100%" height={HEIGHT} initialDimension={{ width: 320, height: HEIGHT }}>
          <LineChart data={drawable} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis
              dataKey="date"
              tickFormatter={formatShortDate}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={24}
              padding={{ left: 8, right: 8 }}
              tick={AXIS_TICK}
            />
            <YAxis
              width={44}
              tickFormatter={(value: number) => formatDecimal(value)}
              tickLine={false}
              axisLine={false}
              domain={["auto", "auto"]}
              tick={AXIS_TICK}
            />
            <Tooltip content={(props) => <ChartTooltip {...props} series={series} />} cursor={{ stroke: "var(--chart-text)", strokeWidth: 1 }} />
            {series.map((item) => (
              <Line
                key={item.key}
                type="linear"
                dataKey={item.key}
                name={item.label}
                stroke={item.color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                connectNulls
                dot={{ r: 4, fill: item.color, stroke: "var(--surface)", strokeWidth: 2 }}
                activeDot={{ r: 6, fill: item.color, stroke: "var(--surface)", strokeWidth: 2 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
