import { useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { formatThousands } from "../../shared/dates";
import { CARDIO_KINDS, STRENGTH_KINDS, type RecordKind } from "../../shared/records";
import type { Exercise } from "../../shared/types";
import { api } from "../api";
import { LazyExerciseChart, LazyWeightChart } from "../components/LazyCharts";
import { LoadError } from "../components/LoadError";
import { WeekCompare } from "../components/WeekCompare";
import { sortExercises } from "../exerciseUtils";
import { NBSP, formatDecimal, formatMediumDate, formatPace } from "../format";
import type { ExerciseProgress, WeekProgress, WeightPoint, WeightRange } from "../progressData";
import { useLoad } from "../useLoad";

const TABS = [
  { id: "peso", label: "Peso" },
  { id: "semana", label: "Semana" },
  { id: "ejercicios", label: "Ejercicios" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const TAB_PARAM = "tab";

const RANGES: readonly { id: WeightRange; label: string }[] = [
  { id: "4w", label: "4 semanas" },
  { id: "12w", label: "12 semanas" },
  { id: "all", label: "Todo" },
];

/** Cualquier valor de `?tab=` que no sea una pestaña cae en la primera. */
function tabFrom(value: string | null): TabId {
  return TABS.find((tab) => tab.id === value)?.id ?? "peso";
}

type LoadState<T> = ReturnType<typeof useLoad<T>>;

/** Los tres estados de una carga; lo que hay cuando está lista lo decide quien llama. */
function Loaded<T>({ load, children }: { load: LoadState<T>; children: (data: T) => ReactNode }) {
  const { state, reload } = load;
  if (state.status === "loading") return <p className="muted">Cargando…</p>;
  if (state.status === "error") return <LoadError message={state.message} offline={state.offline} onRetry={() => void reload()} />;
  return children(state.data);
}

function WeightPanel({ range, onRange }: { range: WeightRange; onRange: (range: WeightRange) => void }) {
  const load = useLoad(() => api<{ points: WeightPoint[] }>(`/api/progress/weight?range=${range}`), range);
  return (
    <>
      <div className="chips" role="group" aria-label="Periodo">
        {RANGES.map((option) => (
          <button
            key={option.id}
            type="button"
            className="chip"
            aria-pressed={option.id === range}
            onClick={() => onRange(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <Loaded load={load}>{(data) => <LazyWeightChart points={data.points} />}</Loaded>
    </>
  );
}

function WeekPanel() {
  const load = useLoad(() => api<WeekProgress>("/api/progress/week"));
  return <Loaded load={load}>{(data) => <WeekCompare data={data} />}</Loaded>;
}

const RECORD_LABELS: Record<RecordKind, string> = {
  maxWeight: "Mayor peso",
  best1RM: "Mejor 1RM estimado",
  volume: "Mayor volumen en una sesión",
  maxDistance: "Mayor distancia",
  bestPace: "Mejor ritmo",
};

function recordText(kind: RecordKind, value: number): string {
  switch (kind) {
    case "volume":
      return `${formatThousands(Math.round(value * 10) / 10)}${NBSP}kg`;
    case "maxDistance":
      return `${formatDecimal(value)}${NBSP}km`;
    case "bestPace":
      return formatPace(value);
    default:
      return `${formatDecimal(value)}${NBSP}kg`;
  }
}

/** Los récords de su categoría (fuerza o cardio) que tengan valor: nunca uno vacío. */
function ExerciseRecords({ exercise, records }: { exercise: Exercise; records: ExerciseProgress["records"] }) {
  const kinds = exercise.category === "cardio" ? CARDIO_KINDS : STRENGTH_KINDS;
  const items = kinds.flatMap((kind) => {
    const record = records[kind];
    return record && Number.isFinite(record.value) && record.value > 0 ? [{ kind, ...record }] : [];
  });
  if (items.length === 0) return null;
  return (
    <section className="stack" aria-labelledby="progress-records-title">
      <h2 id="progress-records-title">Récords</h2>
      <ul className="records">
        {items.map((item) => (
          <li key={item.kind} className="record">
            <span className="card-title">{RECORD_LABELS[item.kind]}</span>
            <span className="metric">{recordText(item.kind, item.value)}</span>
            <span className="muted">{formatMediumDate(item.localDate)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ExerciseProgressView({ exercise }: { exercise: Exercise }) {
  const load = useLoad(() => api<ExerciseProgress>(`/api/progress/exercise/${encodeURIComponent(exercise.id)}`), exercise.id);
  return (
    <Loaded load={load}>
      {(data) => (
        <>
          <LazyExerciseChart sessions={data.sessions} category={exercise.category} />
          <ExerciseRecords exercise={exercise} records={data.records} />
        </>
      )}
    </Loaded>
  );
}

function ExercisesPanel({ exerciseId, onExercise }: { exerciseId: string; onExercise: (id: string) => void }) {
  // Con los archivados: un ejercicio que ya no está en la biblioteca conserva su historial.
  const load = useLoad(() => api<Exercise[]>("/api/exercises?archived=1"));
  return (
    <Loaded load={load}>
      {(exercises) => {
        if (exercises.length === 0) return <p className="muted">Sin datos todavía</p>;
        const selected = exercises.find((candidate) => candidate.id === exerciseId);
        return (
          <>
            <div>
              <label className="field-label" htmlFor="progress-exercise">
                Ejercicio
              </label>
              <select
                id="progress-exercise"
                className="input"
                value={selected?.id ?? ""}
                onChange={(event) => onExercise(event.target.value)}
              >
                <option value="">Elige un ejercicio</option>
                {sortExercises(exercises).map((exercise) => (
                  <option key={exercise.id} value={exercise.id}>
                    {exercise.archived ? `${exercise.name} (archivado)` : exercise.name}
                  </option>
                ))}
              </select>
            </div>
            {selected ? (
              <ExerciseProgressView key={selected.id} exercise={selected} />
            ) : (
              <p className="muted">Elige un ejercicio para ver su evolución y sus récords.</p>
            )}
          </>
        );
      }}
    </Loaded>
  );
}

/** Progreso (spec §5.6): peso, comparación de semanas y evolución y récords por ejercicio. */
export function Progress() {
  const [params, setParams] = useSearchParams();
  const tab = tabFrom(params.get(TAB_PARAM));
  // Lo elegido vive aquí para que cambiar de pestaña y volver no lo pierda.
  const [range, setRange] = useState<WeightRange>("12w");
  const [exerciseId, setExerciseId] = useState("");

  function openTab(next: TabId) {
    setParams(
      (previous) => {
        const copy = new URLSearchParams(previous);
        copy.set(TAB_PARAM, next);
        return copy;
      },
      { replace: true },
    );
  }

  return (
    <section className="screen stack">
      <h1>Progreso</h1>

      <div className="tabs" role="tablist" aria-label="Secciones de progreso">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`progress-tab-${item.id}`}
            className="tabs-tab"
            aria-selected={item.id === tab}
            aria-controls={item.id === tab ? "progress-panel" : undefined}
            onClick={() => openTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="stack" role="tabpanel" id="progress-panel" aria-labelledby={`progress-tab-${tab}`}>
        {tab === "peso" ? <WeightPanel range={range} onRange={setRange} /> : null}
        {tab === "semana" ? <WeekPanel /> : null}
        {tab === "ejercicios" ? <ExercisesPanel exerciseId={exerciseId} onExercise={setExerciseId} /> : null}
      </div>
    </section>
  );
}
