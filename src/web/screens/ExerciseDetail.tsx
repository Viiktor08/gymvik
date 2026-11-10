import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { formatLast } from "../../shared/prefill";
import type { Exercise } from "../../shared/types";
import { ApiError, api } from "../api";
import { ExerciseForm } from "../components/ExerciseForm";
import { ChevronLeftIcon } from "../components/icons";
import { LazyExerciseChart } from "../components/LazyCharts";
import { LoadError } from "../components/LoadError";
import { Sheet } from "../components/Sheet";
import { CATEGORY_LABELS, mediaKind } from "../exerciseUtils";
import { formatMediumDate } from "../format";
import type { ExerciseHistoryEntry, ExerciseProgress } from "../progressData";
import { refreshSnapshotInBackground } from "../session/sync";
import { failureMessage, useLoad } from "../useLoad";

type Loaded = {
  /** `null` si no existe. */
  exercise: Exercise | null;
  /** `null` si no se pudo cargar: el resto de la ficha se enseña igual. */
  history: ExerciseHistoryEntry[] | null;
  progress: ExerciseProgress | null;
};

async function fetchLoaded(id: string): Promise<Loaded> {
  const path = encodeURIComponent(id);
  // Con los archivados: al historial se llega también desde ejercicios que ya no están en la biblioteca.
  // El ejercicio es lo imprescindible; historial y gráfica solo completan la ficha.
  const [exercises, history, progress] = await Promise.all([
    api<Exercise[]>("/api/exercises?archived=1"),
    api<ExerciseHistoryEntry[]>(`/api/exercises/${path}/history`).catch((failure: unknown) =>
      failure instanceof ApiError && failure.status === 404 ? [] : null,
    ),
    api<ExerciseProgress>(`/api/progress/exercise/${path}`).catch(() => null),
  ]);
  return { exercise: exercises.find((candidate) => candidate.id === id) ?? null, history, progress };
}

/** La imagen del ejercicio o, si no es una imagen (o no carga), un enlace al vídeo. */
function ExerciseMedia({ url, name }: { url: string; name: string }) {
  const [broken, setBroken] = useState(false);
  if (mediaKind(url) === "image" && !broken) {
    return <img className="exercise-media" src={url} alt={`Imagen de ${name}`} loading="lazy" onError={() => setBroken(true)} />;
  }
  return (
    <a className="button" href={url} target="_blank" rel="noopener noreferrer">
      Ver vídeo
    </a>
  );
}

/** Ficha de un ejercicio (spec §5.5): descripción, imagen o enlace, tu historial y su gráfica. */
export function ExerciseDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { state, reload, setData } = useLoad(() => fetchLoaded(id), id);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);

  async function archive() {
    if (archiving) return;
    setArchiving(true);
    setArchiveError(null);
    try {
      // Si algún entreno o rutina lo usa, el servidor lo archiva; si no, lo borra. Para el usuario es lo mismo.
      await api(`/api/exercises/${encodeURIComponent(id)}`, { method: "DELETE" });
      // El selector de ejercicios sin conexión sale de la copia guardada en el móvil: que no ofrezca el archivado.
      refreshSnapshotInBackground();
      navigate("/entreno/biblioteca");
    } catch (failure) {
      setArchiveError(failureMessage(failure, "No se pudo archivar el ejercicio"));
      setArchiving(false);
    }
  }

  function closeConfirm() {
    setConfirming(false);
    setArchiveError(null);
  }

  const loaded = state.status === "ready" ? state.data : null;
  const exercise = loaded?.exercise ?? null;

  return (
    <section className="screen stack" aria-busy={state.status === "loading"}>
      <Link to="/entreno/biblioteca" className="back-link">
        <ChevronLeftIcon />
        Biblioteca
      </Link>

      {state.status === "loading" ? (
        <>
          <h1>Ejercicio</h1>
          <p className="muted">Cargando…</p>
        </>
      ) : null}
      {state.status === "error" ? (
        <>
          <h1>Ejercicio</h1>
          <LoadError message={state.message} offline={state.offline} onRetry={() => void reload()} />
        </>
      ) : null}
      {loaded && exercise === null ? (
        <>
          <h1>Ejercicio</h1>
          <div className="card">
            <p className="card-title">Ejercicio no encontrado</p>
            <Link to="/entreno/biblioteca" className="button">
              Volver a la biblioteca
            </Link>
          </div>
        </>
      ) : null}

      {loaded && exercise ? (
        <>
          <header>
            <h1>{exercise.name}</h1>
            <p className="muted">
              {exercise.muscle === ""
                ? CATEGORY_LABELS[exercise.category]
                : `${CATEGORY_LABELS[exercise.category]} · ${exercise.muscle}`}
            </p>
            {exercise.archived ? <span className="badge">Archivado</span> : null}
          </header>

          {exercise.mediaUrl !== null ? <ExerciseMedia key={exercise.mediaUrl} url={exercise.mediaUrl} name={exercise.name} /> : null}

          <p className={exercise.description === "" ? "muted" : undefined}>
            {exercise.description === "" ? "Sin descripción." : exercise.description}
          </p>

          <div className="card-grid">
            <button type="button" className="button" onClick={() => setEditing(true)}>
              Editar
            </button>
            {exercise.archived ? null : (
              <button type="button" className="button button-danger" onClick={() => setConfirming(true)}>
                Archivar
              </button>
            )}
          </div>

          <section className="stack" aria-labelledby="exercise-chart-title">
            <h2 id="exercise-chart-title">Evolución</h2>
            {loaded.progress === null ? (
              <p className="muted">No se pudo cargar la gráfica.</p>
            ) : (
              <LazyExerciseChart sessions={loaded.progress.sessions} category={exercise.category} />
            )}
          </section>

          <section className="stack" aria-labelledby="exercise-history-title">
            <h2 id="exercise-history-title">Tu historial</h2>
            {loaded.history === null ? <p className="muted">No se pudo cargar tu historial.</p> : null}
            {loaded.history !== null && loaded.history.length === 0 ? (
              <p className="muted">Todavía no has hecho este ejercicio.</p>
            ) : null}
            {loaded.history !== null && loaded.history.length > 0 ? (
              <ul className="list">
                {loaded.history.map((entry) => (
                  <li key={entry.workoutId}>
                    <Link to={`/entreno/historial/${encodeURIComponent(entry.workoutId)}`} className="list-row list-row-stack">
                      <span className="list-row-main">{formatMediumDate(entry.localDate)}</span>
                      <span className="muted">{formatLast(entry.sets, exercise.category) || "Sin series"}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          {/* Se desmonta al cerrar: lo escrito a medias no vuelve la próxima vez. */}
          <Sheet open={editing} title="Editar ejercicio" onClose={() => setEditing(false)}>
            <ExerciseForm
              exercise={exercise}
              onSaved={(saved) => {
                setData({ ...loaded, exercise: saved });
                setEditing(false);
              }}
            />
          </Sheet>

          <Sheet open={confirming} title="¿Archivar este ejercicio?" onClose={closeConfirm}>
            <p>
              Dejará de salir en la biblioteca y en los selectores. Si lo has usado en algún entreno o rutina, tu historial lo
              conserva.
            </p>
            {archiveError ? (
              <p role="alert" className="form-error">
                {archiveError}
              </p>
            ) : null}
            <div className="actions">
              <button type="button" className="button button-danger" disabled={archiving} onClick={() => void archive()}>
                Sí, archivar
              </button>
              <button type="button" className="button" onClick={closeConfirm}>
                Cancelar
              </button>
            </div>
          </Sheet>
        </>
      ) : null}
    </section>
  );
}
