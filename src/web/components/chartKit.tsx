import type { ReactElement } from "react";
import { ResponsiveContainer, type TooltipContentProps } from "recharts";
import { NBSP, formatDecimal, formatMediumDate } from "../format";

// Piezas que comparten las gráficas de línea (ExerciseChart y WeightChart).

export const CHART_HEIGHT = 200;
export const CHART_MARGIN = { top: 8, right: 12, bottom: 0, left: 0 };
export const AXIS_TICK = { fill: "var(--chart-text)", fontSize: 12 };
export const TOOLTIP_CURSOR = { stroke: "var(--chart-text)", strokeWidth: 1 };

/** Una serie de la gráfica: qué dato dibuja, cómo se llama en la leyenda y con qué unidad se lee. */
export type Series<K extends string> = {
  key: K;
  label: string;
  unit: string;
  /** Variable CSS del color (definidas en styles.css, con su variante oscura). */
  color: string;
  /** Clase de la muestra de color de la leyenda y del tooltip. */
  swatch: string;
};

/** Solo un número finito se dibuja: lo demás es un hueco, nunca NaN ni Infinity. */
export function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function valueText(value: number | null, unit: string): string {
  return value === null ? "—" : `${formatDecimal(value)}${NBSP}${unit}`;
}

// Pasos de eje, de menor a mayor: el primero con el que el rango cabe en 4 tramos.
const AXIS_STEPS = [0.5, 1, 2, 5, 10, 20, 50, 100];

/**
 * Eje con marcas redondas y a la misma distancia (72, 74, 76, 78) en lugar de las que calcula "auto"
 * (76,65, 75,6...). Cubre los valores con como mucho 5 marcas. `values` tiene al menos un número finito.
 */
export function roundAxis(values: readonly number[]): { domain: [number, number]; ticks: number[] } {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const step = AXIS_STEPS.find((candidate) => Math.ceil(max / candidate) - Math.floor(min / candidate) <= 4) ?? 100;
  let start = Math.floor(min / step) * step;
  let end = Math.ceil(max / step) * step;
  // Una línea plana sobre una marca exacta: un tramo por encima y otro por debajo.
  if (start === end) {
    start -= step;
    end += step;
  }
  const ticks: number[] = [];
  for (let tick = start; tick <= end + step / 1000; tick += step) ticks.push(Math.round(tick * 100) / 100);
  return { domain: [start, end], ticks };
}

/** La fecha del punto sobre el que está el cursor. Cada punto de datos trae la suya en `date`. */
function dateOfPoint(payload: TooltipContentProps["payload"] | undefined): string {
  const point: unknown = payload?.[0]?.payload;
  if (typeof point === "object" && point !== null && "date" in point && typeof point.date === "string") return point.date;
  return "";
}

/** Tooltip con la fecha del punto y el valor de cada serie. */
export function ChartTooltip<K extends string>({
  active,
  payload,
  series,
}: Partial<TooltipContentProps> & { series: readonly Series<K>[] }) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-date">{formatMediumDate(dateOfPoint(payload))}</p>
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

type FigureProps<K extends string> = {
  title: string;
  /** Con dos o más series hay leyenda: la identidad nunca va solo en el color. */
  series: readonly Series<K>[];
  /** Lo que lee un lector de pantalla en lugar del dibujo. */
  label: string;
  /** La gráfica de recharts. */
  children: ReactElement;
};

/** Título, leyenda y marco accesible de una gráfica de línea. */
export function ChartFigure<K extends string>({ title, series, label, children }: FigureProps<K>) {
  return (
    <figure className="chart">
      <figcaption className="chart-title">{title}</figcaption>
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
      <div className="chart-frame" role="img" aria-label={label}>
        <ResponsiveContainer width="100%" height={CHART_HEIGHT} initialDimension={{ width: 320, height: CHART_HEIGHT }}>
          {children}
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
