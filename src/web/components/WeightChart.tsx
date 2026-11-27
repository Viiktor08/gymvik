import type { ReactNode } from "react";
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { formatDecimal, formatShortDate } from "../format";
import type { WeightPoint } from "../progressData";
import { AXIS_TICK, CHART_MARGIN, ChartFigure, ChartTooltip, TOOLTIP_CURSOR, finite, roundAxis, valueText, type Series } from "./chartKit";

type Props = {
  points: readonly WeightPoint[];
};

type WeightKey = "weightKg" | "avg7";
type FatKey = "bodyFatPct";

// El peso de cada día va fino y apagado; la línea gruesa y de color es la media de 7 días.
const WEIGHT: readonly Series<WeightKey>[] = [
  { key: "weightKg", label: "Peso diario", unit: "kg", color: "var(--chart-text)", swatch: "chart-key-thin" },
  { key: "avg7", label: "Media de 7 días", unit: "kg", color: "var(--series-1)", swatch: "chart-key-thick" },
];
// Otra magnitud, otra gráfica: nunca dos escalas en la misma.
const FAT: readonly Series<FatKey>[] = [{ key: "bodyFatPct", label: "% de grasa", unit: "%", color: "var(--series-2)", swatch: "chart-key-2" }];

const WEIGHT_KEYS: readonly WeightKey[] = ["weightKg", "avg7"];
const FAT_KEYS: readonly FatKey[] = ["bodyFatPct"];

const DAILY_WIDTH = 1.5;
const AVERAGE_WIDTH = 4;
/** Con más puntos que esto, los puntos del peso diario solo estorban. */
const MAX_DOTS = 31;

type Point = { date: string } & Record<WeightKey | FatKey, number | null>;

function SeriesLine({ item, width, dots }: { item: Series<string>; width: number; dots: boolean }) {
  return (
    <Line
      type="linear"
      dataKey={item.key}
      name={item.label}
      stroke={item.color}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      connectNulls
      dot={dots ? { r: 3, fill: item.color, stroke: "var(--surface)", strokeWidth: 2 } : false}
      activeDot={{ r: 5, fill: item.color, stroke: "var(--surface)", strokeWidth: 2 }}
      isAnimationActive={false}
    />
  );
}

type FrameProps = {
  data: Point[];
  /** Las series que se dibujan: de ellas sale el rango del eje Y. */
  keys: readonly (WeightKey | FatKey)[];
  tooltipSeries: readonly Series<string>[];
  children: ReactNode;
};

function LineFrame({ data, keys, tooltipSeries, children }: FrameProps) {
  const values = data.flatMap((point) => keys.map((key) => point[key]).filter((value) => value !== null));
  const axis = roundAxis(values);
  return (
    <LineChart data={data} margin={CHART_MARGIN}>
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
        domain={axis.domain}
        ticks={axis.ticks}
        tick={AXIS_TICK}
      />
      <Tooltip content={(props) => <ChartTooltip {...props} series={tooltipSeries} />} cursor={TOOLTIP_CURSOR} />
      {children}
    </LineChart>
  );
}

function plural(n: number): string {
  return n === 1 ? "1 registro" : `${n} registros`;
}

/**
 * Evolución del peso: cada día, su media móvil de 7 días (línea gruesa) y, si hay, el % de grasa en otra gráfica.
 * Sin ningún peso dibujable, "Sin datos todavía".
 */
export function WeightChart({ points }: Props): ReactNode {
  const data: Point[] = points
    .filter((point) => finite(point.weightKg) !== null)
    .map((point) => ({
      date: point.localDate,
      weightKg: finite(point.weightKg),
      avg7: finite(point.avg7),
      bodyFatPct: finite(point.bodyFatPct),
    }));

  if (data.length === 0) return <p className="muted">Sin datos todavía</p>;

  const last = data[data.length - 1];
  const weightLabel = `Peso y media de 7 días, ${plural(data.length)}. Último: Peso ${valueText(last?.weightKg ?? null, "kg")}, Media de 7 días ${valueText(last?.avg7 ?? null, "kg")}.`;

  const fatCount = data.filter((point) => point.bodyFatPct !== null).length;
  const lastFat = [...data].reverse().find((point) => point.bodyFatPct !== null);
  const fatLabel = `% de grasa, ${plural(fatCount)}. Último: ${valueText(lastFat?.bodyFatPct ?? null, "%")}.`;

  const [daily, average] = WEIGHT;
  const [fat] = FAT;

  return (
    <>
      <ChartFigure title="Peso y media de 7 días" series={WEIGHT} label={weightLabel}>
        <LineFrame data={data} keys={WEIGHT_KEYS} tooltipSeries={WEIGHT}>
          {daily ? <SeriesLine item={daily} width={DAILY_WIDTH} dots={data.length <= MAX_DOTS} /> : null}
          {average ? <SeriesLine item={average} width={AVERAGE_WIDTH} dots={false} /> : null}
        </LineFrame>
      </ChartFigure>

      {fatCount > 0 && fat ? (
        <ChartFigure title="% de grasa" series={FAT} label={fatLabel}>
          <LineFrame data={data} keys={FAT_KEYS} tooltipSeries={FAT}>
            <SeriesLine item={fat} width={2} dots={fatCount <= MAX_DOTS} />
          </LineFrame>
        </ChartFigure>
      ) : (
        <p className="muted">Sin % de grasa apuntado en este periodo.</p>
      )}
    </>
  );
}
