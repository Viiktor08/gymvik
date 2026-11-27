import type { ReactNode } from "react";
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import type { Category } from "../../shared/types";
import { formatDecimal, formatShortDate } from "../format";
import type { ExerciseSession } from "../progressData";
import { AXIS_TICK, CHART_MARGIN, ChartFigure, ChartTooltip, TOOLTIP_CURSOR, finite, valueText, type Series } from "./chartKit";

type Props = {
  sessions: readonly ExerciseSession[];
  category: Category;
};

type SeriesKey = "maxWeight" | "best1RM" | "maxDistance";

// Fuerza: peso máximo y 1RM estimado por sesión. Cardio: distancia máxima.
const STRENGTH: readonly Series<SeriesKey>[] = [
  { key: "maxWeight", label: "Peso máximo", unit: "kg", color: "var(--series-1)", swatch: "chart-key-1" },
  { key: "best1RM", label: "1RM estimado", unit: "kg", color: "var(--series-2)", swatch: "chart-key-2" },
];
const CARDIO: readonly Series<SeriesKey>[] = [{ key: "maxDistance", label: "Distancia máxima", unit: "km", color: "var(--series-1)", swatch: "chart-key-1" }];

/** `x` es el puesto de la sesión: dos sesiones del mismo día no comparten posición en el eje. */
type Point = { x: number; date: string } & Record<SeriesKey, number | null>;

/** Lo que lee un lector de pantalla en lugar del dibujo. */
function summary(series: readonly Series<SeriesKey>[], points: readonly Point[]): string {
  const last = points[points.length - 1];
  const sessions = points.length === 1 ? "1 sesión" : `${points.length} sesiones`;
  const latest = series.map((item) => `${item.label} ${valueText(last?.[item.key] ?? null, item.unit)}`);
  return `${series.map((item) => item.label).join(" y ")} por sesión, ${sessions}. Última: ${latest.join(", ")}.`;
}

/** La fecha corta del puesto `x`; una segunda sesión del mismo día no la repite. */
function tickLabel(points: readonly Point[], x: number): string {
  const date = points[x]?.date;
  if (date === undefined || points[x - 1]?.date === date) return "";
  return formatShortDate(date);
}

/** Evolución de un ejercicio sesión a sesión. Sin ningún dato dibujable, "Sin datos todavía". */
export function ExerciseChart({ sessions, category }: Props): ReactNode {
  const series = category === "cardio" ? CARDIO : STRENGTH;
  const values = sessions.map((session) => ({
    date: session.localDate,
    maxWeight: finite(session.maxWeight),
    best1RM: finite(session.best1RM),
    maxDistance: finite(session.maxDistance),
  }));
  // Una sesión sin ningún valor de esta gráfica (por ejemplo, solo repeticiones) no aporta un punto.
  const drawable: Point[] = values
    .filter((point) => series.some((item) => point[item.key] !== null))
    .map((point, x) => ({ ...point, x }));

  if (drawable.length === 0) return <p className="muted">Sin datos todavía</p>;

  return (
    <ChartFigure title={series.map((item) => item.label).join(" y ")} series={series} label={summary(series, drawable)}>
      <LineChart data={drawable} margin={CHART_MARGIN}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis
          dataKey="x"
          tickFormatter={(x: number) => tickLabel(drawable, x)}
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
        <Tooltip content={(props) => <ChartTooltip {...props} series={series} />} cursor={TOOLTIP_CURSOR} />
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
    </ChartFigure>
  );
}
