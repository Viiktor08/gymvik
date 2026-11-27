import { useId, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { Exercise, Workout } from "../../shared/types";
import { ApiError, api } from "../api";
import { ChevronLeftIcon } from "../components/icons";
import { LoadError } from "../components/LoadError";
import { Sheet } from "../components/Sheet";
import { WorkoutExercisesEditor } from "../components/WorkoutExercisesEditor";
import { formatLongDate } from "../format";
import { workoutBody, type WorkoutSummary } from "../historyData";
import { refreshSnapshot } from "../session/offlineCache";
import { sessionTotals } from "../session/finish";
import { Totals } from "../session/Totals";
import { failureMessage, useLoad } from "../useLoad";
import { cleanExercises } from "../workoutEdit";

type Loaded = {
  /** `null` si no existe. */
  workout: Workout | null;
  /** Con los archivados: un entreno antiguo puede llevar ejercicios que ya no están en la biblioteca. */
  catalog: Map<string, Exercise>;
  /** `null` para un entreno libre o si no se pudo saber. */
  routineName: string | null;
};

async function fetchLoaded(id: string): Promise<Loaded> {
  const [workout, exercises] = await Promise.all([
    api<Workout>(`/api/workouts/${encodeURIComponent(id)}`).catch((failure: unknown) => {
      if (failure instanceof ApiError && failure.status === 404) return null;
      throw failure;
    }),
    api<Exercise[]>("/api/exercises?archived=1"),
  ]);
  const catalog = new Map(exercises.map((exercise) => [exercise.id, exercise]));

  // El nombre de la rutina solo lo da el listado (también si la rutina ya está archivada). Solo completa el título.
  let routineName: string | null = null;
  if (workout !== null && workout.routineId !== null) {
    const day = workout.localDate;
    routineName = await api<WorkoutSummary[]>(`/api/workouts?from=${day}&to=${day}`)
      .then((summaries) => summaries.find((summary) => summary.id === workout.id)?.routineName ?? null)
      .catch(() => null);
  }
  return { workout, catalog, routineName };
}

type BodyProps = {
  initial: Workout;
  catalog: Map<string, Exercise>;
  routineName: string | null;
};

function WorkoutBody({ initial, catalog, routineName }: BodyProps) {
  const navigate = useNavigate();
  const notesId = useId();
  // Lo último guardado en el servidor; lo que se edita vive aparte hasta pulsar "Guardar cambios".
  const [saved, setSaved] = useState(initial);
  const [exercises, setExercises] = useState(initial.exercises);
  const [notes, setNotes] = useState(initial.notes);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const dirty =
    notes !== saved.notes || JSON.stringify(cleanExercises(exercises)) !== JSON.stringify(cleanExercises(saved.exercises));
  const title = routineName ?? (saved.routineId === null ? "Entreno libre" : "Entreno");

  async function save() {
    if (saving || !dirty) return;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await api<{ workout: Workout }>(`/api/workouts/${encodeURIComponent(saved.id)}`, {
        method: "PUT",
        body: JSON.stringify(workoutBody({ ...saved, notes, exercises })),
      });
      setSaved(result.workout);
      setExercises(result.workout.exercises);
      setNotes(result.workout.notes);
      setJustSaved(true);
      // Cambiar series cambia la "última vez" de la copia sin conexión.
      void refreshSnapshot().catch(() => undefined);
    } catch (failure) {
      setSaveError(failureMessage(failure, "No se pudieron guardar los cambios"));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api(`/api/workouts/${encodeURIComponent(saved.id)}`, { method: "DELETE" });
    } catch (failure) {
      // Un 404 es que ya no existe (se borró desde otro sitio): el resultado es el que se quería.
      if (!(failure instanceof ApiError && failure.status === 404)) {
        setDeleteError(failureMessage(failure, "No se pudo borrar el entreno"));
        setDeleting(false);
        return;
      }
    }
    void refreshSnapshot().catch(() => undefined);
    navigate("/entreno/historial", { replace: true });
  }

  function closeConfirm() {
    setConfirming(false);
    setDeleteError(null);
  }

  return (
    <>
      <header>
        <h1>{title}</h1>
        <p className="muted">{formatLongDate(saved.localDate)}</p>
      </header>

      <section className="card" aria-label="Resumen">
        <Totals totals={sessionTotals(saved, catalog)} />
      </section>

      <WorkoutExercisesEditor
        exercises={exercises}
        catalog={catalog}
        onChange={(next) => {
          setExercises(next);
          setJustSaved(false);
        }}
      />

      <div>
        <label className="field-label" htmlFor={notesId}>
          Notas
        </label>
        <textarea
          id={notesId}
          className="input textarea"
          maxLength={5000}
          value={notes}
          onChange={(event) => {
            setNotes(event.target.value);
            setJustSaved(false);
          }}
        />
      </div>

      {saveError ? (
        <p role="alert" className="form-error">
          {saveError}
        </p>
      ) : null}
      {justSaved ? (
        <p role="status" className="notice">
          Cambios guardados.
        </p>
      ) : null}

      <div className="actions">
        <button type="button" className="button button-primary" disabled={!dirty || saving} onClick={() => void save()}>
          Guardar cambios
        </button>
        <button type="button" className="button button-danger" onClick={() => setConfirming(true)}>
          Borrar entreno
        </button>
      </div>

      <Sheet open={confirming} title="¿Borrar este entreno?" onClose={closeConfirm}>
        <p>Se borrará con todas sus series y no se podrá recuperar.</p>
        {deleteError ? (
          <p role="alert" className="form-error">
            {deleteError}
          </p>
        ) : null}
        <div className="actions">
          <button type="button" className="button button-danger" disabled={deleting} onClick={() => void remove()}>
            Sí, borrar
          </button>
          <button type="button" className="button" disabled={deleting} onClick={closeConfirm}>
            Cancelar
          </button>
        </div>
      </Sheet>
    </>
  );
}

/** Detalle de un entreno: sus series y notas se editan y el entreno se borra con confirmación. */
export function WorkoutDetail() {
  const { id = "" } = useParams();
  const { state, reload } = useLoad(() => fetchLoaded(id), id);

  return (
    <section className="screen stack" aria-busy={state.status === "loading"}>
      <Link to="/entreno/historial" className="back-link">
        <ChevronLeftIcon />
        Historial
      </Link>

      {state.status === "loading" ? (
        <>
          <h1>Entreno</h1>
          <p className="muted">Cargando…</p>
        </>
      ) : null}
      {state.status === "error" ? (
        <>
          <h1>Entreno</h1>
          <LoadError message={state.message} offline={state.offline} onRetry={() => void reload()} />
        </>
      ) : null}
      {state.status === "ready" && state.data.workout === null ? (
        <>
          <h1>Entreno</h1>
          <div className="card">
            <p className="card-title">Entreno no encontrado</p>
            <Link to="/entreno/historial" className="button">
              Volver al historial
            </Link>
          </div>
        </>
      ) : null}
      {state.status === "ready" && state.data.workout !== null ? (
        <WorkoutBody
          key={state.data.workout.id}
          initial={state.data.workout}
          catalog={state.data.catalog}
          routineName={state.data.routineName}
        />
      ) : null}
    </section>
  );
}
