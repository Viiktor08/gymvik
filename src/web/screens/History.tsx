import { useState } from "react";
import { Link } from "react-router";
import { api } from "../api";
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from "../components/icons";
import { LoadError } from "../components/LoadError";
import { ManualWorkoutForm } from "../components/ManualWorkoutForm";
import { deviceToday, groupByWeek, summaryLine, weekLabel, type WorkoutSummary } from "../historyData";
import { useLoad } from "../useLoad";

function workoutCount(n: number): string {
  return n === 1 ? "1 entreno" : `${n} entrenos`;
}

/** Historial (spec §5.4): los entrenos agrupados por semana y el registro de un entreno pasado. */
export function History() {
  const { state, reload } = useLoad(() => api<WorkoutSummary[]>("/api/workouts"));
  const [adding, setAdding] = useState(false);
  const [saved, setSaved] = useState(false);

  if (adding) {
    return (
      <section className="screen stack">
        <h1>Entreno pasado</h1>
        <ManualWorkoutForm
          onCancel={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            setSaved(true);
            void reload();
          }}
        />
      </section>
    );
  }

  const weeks = state.status === "ready" ? groupByWeek(state.data) : [];
  const currentYear = Number(deviceToday().slice(0, 4));

  return (
    <section className="screen stack" aria-busy={state.status === "loading"}>
      <Link to="/entreno" className="back-link">
        <ChevronLeftIcon />
        Entreno
      </Link>
      <h1>Historial</h1>

      <button
        type="button"
        className="button"
        onClick={() => {
          setSaved(false);
          setAdding(true);
        }}
      >
        <PlusIcon />
        Apuntar entreno pasado
      </button>

      {saved ? (
        <p role="status" className="notice">
          Entreno guardado.
        </p>
      ) : null}

      {state.status === "loading" ? <p className="muted">Cargando…</p> : null}
      {state.status === "error" ? (
        <LoadError message={state.message} offline={state.offline} onRetry={() => void reload()} />
      ) : null}

      {state.status === "ready" && state.data.length === 0 ? (
        <div className="card">
          <p className="card-title">Todavía no hay entrenos</p>
          <p className="muted">Cuando termines uno aparecerá aquí. Si ya hiciste alguno, apúntalo con el botón de arriba.</p>
        </div>
      ) : null}

      {weeks.map((week) => {
        const headingId = `week-${week.weekStart}`;
        return (
          <section key={week.weekStart} className="stack" aria-labelledby={headingId}>
            <div className="history-week-head">
              <h2 id={headingId}>{weekLabel(week.weekStart, currentYear)}</h2>
              <span className="muted">{workoutCount(week.workouts.length)}</span>
            </div>
            <ul className="list">
              {week.workouts.map((workout) => (
                <li key={workout.id}>
                  <Link to={`/entreno/historial/${encodeURIComponent(workout.id)}`} className="list-row">
                    <span className="history-row-text">
                      <span className="list-row-main">{workout.routineName ?? "Entreno libre"}</span>
                      <span className="muted">{summaryLine(workout)}</span>
                    </span>
                    <ChevronRightIcon />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </section>
  );
}
