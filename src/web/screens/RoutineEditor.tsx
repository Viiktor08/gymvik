import { useId, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { NEW_REPS_TARGET, NEW_REST_SECONDS } from "../../shared/routineDiff";
import type { Exercise, Routine } from "../../shared/types";
import { ApiError, api } from "../api";
import { ArrowDownIcon, ArrowUpIcon, ChevronLeftIcon, CloseIcon, PlusIcon } from "../components/icons";
import { ExercisePicker } from "../components/ExercisePicker";
import { LoadError } from "../components/LoadError";
import { NumberInput } from "../components/NumberInput";
import { Sheet } from "../components/Sheet";
import { failureMessage, useLoad } from "../useLoad";

/** Series de un ejercicio recién añadido; repeticiones y descanso son los mismos que al guardar una sesión. */
const NEW_ITEM_SETS = 3;
const MAX_SETS = 20;
const MAX_REST_SECONDS = 3600;
const MAX_REPS_LENGTH = 30;
const MAX_NAME_LENGTH = 100;

/** Un ejercicio de la rutina mientras se edita: lo escrito a medias puede estar vacío. */
type Row = {
  /** Identifica la fila al reordenar; no es la `position` que se guarda. */
  key: number;
  exerciseId: string;
  sets: number | null;
  repsTarget: string;
  restSeconds: number | null;
};

type Loaded = {
  routines: Routine[];
  /** Nombre de cada ejercicio por id; `null` si no se pudieron cargar. */
  names: ReadonlyMap<string, string> | null;
};

async function fetchLoaded(): Promise<Loaded> {
  // Con los archivados: una rutina puede conservar un ejercicio archivado y hay que poder nombrarlo.
  const [routines, exercises] = await Promise.all([
    api<Routine[]>("/api/routines"),
    api<Exercise[]>("/api/exercises?archived=1").catch(() => null),
  ]);
  return { routines, names: exercises === null ? null : new Map(exercises.map((e) => [e.id, e.name])) };
}

/** El orden que le toca a una rutina que entra en la rotación: detrás de las que ya están. */
function nextRotationOrder(routines: readonly Routine[], exceptId: string | null): number {
  const orders = routines.filter((r) => r.inRotation && r.id !== exceptId).map((r) => r.rotationOrder);
  return orders.length === 0 ? 0 : Math.max(...orders) + 1;
}

function rowsOf(routine: Routine | null): Row[] {
  if (routine === null) return [];
  return [...routine.items]
    .sort((a, b) => a.position - b.position)
    .map((item, key) => ({
      key,
      exerciseId: item.exerciseId,
      sets: item.sets,
      repsTarget: item.repsTarget,
      restSeconds: item.restSeconds,
    }));
}

function isIntegerBetween(value: number | null, min: number, max: number): value is number {
  return value !== null && Number.isInteger(value) && value >= min && value <= max;
}

/** El primer fallo del formulario, o `null` si se puede guardar. */
function validate(name: string, rows: readonly Row[], nameOf: (exerciseId: string) => string): string | null {
  const trimmed = name.trim();
  if (trimmed === "") return "Escribe un nombre para la rutina.";
  if (trimmed.length > MAX_NAME_LENGTH) return `El nombre no puede tener más de ${MAX_NAME_LENGTH} caracteres.`;
  for (const row of rows) {
    const label = nameOf(row.exerciseId);
    if (!isIntegerBetween(row.sets, 1, MAX_SETS)) return `${label}: las series son un número entero de 1 a ${MAX_SETS}.`;
    const reps = row.repsTarget.trim();
    if (reps === "" || reps.length > MAX_REPS_LENGTH) {
      return `${label}: escribe las repeticiones (hasta ${MAX_REPS_LENGTH} caracteres, por ejemplo "8-10").`;
    }
    if (!isIntegerBetween(row.restSeconds, 0, MAX_REST_SECONDS)) {
      return `${label}: el descanso va de 0 a ${MAX_REST_SECONDS} segundos.`;
    }
  }
  return null;
}

type FormProps = {
  /** `null` crea una rutina nueva. */
  routine: Routine | null;
  routines: readonly Routine[];
  names: ReadonlyMap<string, string> | null;
};

function RoutineForm({ routine, routines, names }: FormProps) {
  const navigate = useNavigate();
  const [name, setName] = useState(routine?.name ?? "");
  const [inRotation, setInRotation] = useState(routine?.inRotation ?? true);
  const [rows, setRows] = useState<Row[]>(() => rowsOf(routine));
  const nextKey = useRef(rows.length);
  // Nombres de los ejercicios añadidos en esta pantalla (el mapa de la carga no los trae si son nuevos).
  const [added, setAdded] = useState<ReadonlyMap<string, string>>(new Map());
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const switchLabelId = useId();
  const switchHintId = useId();

  const nameOf = (exerciseId: string): string => names?.get(exerciseId) ?? added.get(exerciseId) ?? "Ejercicio";

  function update(key: number, changes: Partial<Omit<Row, "key" | "exerciseId">>) {
    setRows((previous) => previous.map((row) => (row.key === key ? { ...row, ...changes } : row)));
  }

  function move(index: number, by: -1 | 1) {
    setRows((previous) => {
      const target = index + by;
      const moved = previous[index];
      const other = previous[target];
      if (moved === undefined || other === undefined) return previous;
      const copy = [...previous];
      copy[index] = other;
      copy[target] = moved;
      return copy;
    });
  }

  function add(exercise: Exercise) {
    setAdded((previous) => new Map(previous).set(exercise.id, exercise.name));
    setRows((previous) => [
      ...previous,
      {
        key: nextKey.current++,
        exerciseId: exercise.id,
        sets: NEW_ITEM_SETS,
        repsTarget: NEW_REPS_TARGET,
        restSeconds: NEW_REST_SECONDS,
      },
    ]);
    setPicking(false);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving || archiving) return;
    const problem = validate(name, rows, nameOf);
    if (problem !== null) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);

    const body = {
      name: name.trim(),
      inRotation,
      // Una rutina que ya estaba en la rotación conserva su sitio; la que entra ahora va al final.
      rotationOrder:
        routine === null || (inRotation && !routine.inRotation)
          ? nextRotationOrder(routines, routine?.id ?? null)
          : routine.rotationOrder,
      archived: false,
      items: rows.map((row, position) => ({
        exerciseId: row.exerciseId,
        position,
        sets: row.sets,
        repsTarget: row.repsTarget.trim(),
        restSeconds: row.restSeconds,
      })),
    };
    try {
      if (routine === null) {
        await api("/api/routines", { method: "POST", body: JSON.stringify(body) });
      } else {
        await api(`/api/routines/${encodeURIComponent(routine.id)}`, {
          method: "PUT",
          body: JSON.stringify({ id: routine.id, ...body }),
        });
      }
      navigate("/entreno");
    } catch (failure) {
      setError(failureMessage(failure, "No se pudo guardar la rutina"));
      setSaving(false);
    }
  }

  async function archive() {
    if (routine === null || archiving) return;
    setArchiving(true);
    setArchiveError(null);
    try {
      await api(`/api/routines/${encodeURIComponent(routine.id)}`, { method: "DELETE" });
    } catch (failure) {
      // Un 404 es que ya no existe (se archivó desde otro sitio): el resultado es el que se quería.
      if (!(failure instanceof ApiError && failure.status === 404)) {
        setArchiveError(failureMessage(failure, "No se pudo archivar la rutina"));
        setArchiving(false);
        return;
      }
    }
    // La rutina deja de existir para las listas: volver atrás a su editor no tiene sentido.
    navigate("/entreno", { replace: true });
  }

  function closeArchiveConfirmation() {
    if (archiving) return;
    setConfirmingArchive(false);
    setArchiveError(null);
  }

  return (
    <>
      <form className="stack" onSubmit={(event) => void save(event)} noValidate>
        <div className="field">
          <label className="field-label" htmlFor="routine-name">
            Nombre
          </label>
          <input
            id="routine-name"
            className="input"
            type="text"
            autoComplete="off"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={inRotation}
          aria-labelledby={switchLabelId}
          aria-describedby={switchHintId}
          className="switch-row"
          onClick={() => setInRotation(!inRotation)}
        >
          <span className="switch-text">
            <strong id={switchLabelId}>En rotación</strong>
            <span id={switchHintId} className="muted">
              Entra en el orden de "te toca hoy".
            </span>
          </span>
          <span className="switch-track" aria-hidden="true">
            <span className="switch-thumb" />
          </span>
        </button>

        <h2>Ejercicios</h2>
        {rows.length === 0 ? <p className="muted">Todavía no hay ejercicios. Añade el primero.</p> : null}
        {rows.length > 0 ? (
          <ol className="routine-items">
            {rows.map((row, index) => {
              const exerciseName = nameOf(row.exerciseId);
              return (
                <li key={row.key} className="card routine-item">
                  <div className="routine-item-head">
                    <h3>{exerciseName}</h3>
                    <div className="routine-item-tools">
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Subir ${exerciseName}`}
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                      >
                        <ArrowUpIcon />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Bajar ${exerciseName}`}
                        disabled={index === rows.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        <ArrowDownIcon />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Quitar ${exerciseName}`}
                        onClick={() => setRows((previous) => previous.filter((r) => r.key !== row.key))}
                      >
                        <CloseIcon />
                      </button>
                    </div>
                  </div>
                  <div className="routine-item-fields">
                    <label className="mini-field">
                      <span className="mini-label">Series</span>
                      <NumberInput
                        decimals={0}
                        aria-label={`Series de ${exerciseName}`}
                        value={row.sets}
                        onChange={(sets) => update(row.key, { sets })}
                      />
                    </label>
                    <label className="mini-field">
                      <span className="mini-label">Repeticiones</span>
                      <input
                        className="input"
                        type="text"
                        autoComplete="off"
                        aria-label={`Repeticiones de ${exerciseName}`}
                        value={row.repsTarget}
                        onChange={(event) => update(row.key, { repsTarget: event.target.value })}
                      />
                    </label>
                    <label className="mini-field">
                      <span className="mini-label">Descanso (s)</span>
                      <NumberInput
                        decimals={0}
                        aria-label={`Descanso de ${exerciseName} (s)`}
                        value={row.restSeconds}
                        onChange={(restSeconds) => update(row.key, { restSeconds })}
                      />
                    </label>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : null}

        <button type="button" className="button" onClick={() => setPicking(true)}>
          <PlusIcon />
          Añadir ejercicio
        </button>

        {error ? (
          <p role="alert" className="form-error">
            {error}
          </p>
        ) : null}
        <div className="actions">
          <button type="submit" className="button button-primary" disabled={saving || archiving}>
            Guardar
          </button>
          {routine !== null ? (
            <button
              type="button"
              className="button button-danger"
              disabled={saving}
              onClick={() => setConfirmingArchive(true)}
            >
              Archivar rutina
            </button>
          ) : null}
        </div>
      </form>

      <Sheet open={confirmingArchive} title="¿Archivar esta rutina?" onClose={closeArchiveConfirmation}>
        <p>
          La rutina desaparecerá de las listas y de la rotación, pero el historial se conserva: tus entrenos anteriores
          seguirán ahí.
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
          <button type="button" className="button" disabled={archiving} onClick={closeArchiveConfirmation}>
            Cancelar
          </button>
        </div>
      </Sheet>

      <Sheet open={picking} title="Añadir ejercicio" onClose={() => setPicking(false)}>
        <ExercisePicker onPick={add} />
      </Sheet>
    </>
  );
}

/** Crear (`/entreno/rutina/nueva`) o editar (`/entreno/rutina/:id`) una rutina (spec §5.2). */
export function RoutineEditor() {
  const { id = "" } = useParams();
  const isNew = id === "nueva";
  const { state, reload } = useLoad(fetchLoaded);

  const routine = state.status === "ready" && !isNew ? (state.data.routines.find((r) => r.id === id) ?? null) : null;

  return (
    <section className="screen stack" aria-busy={state.status === "loading"}>
      <Link to="/entreno" className="back-link">
        <ChevronLeftIcon />
        Entreno
      </Link>
      <h1>{isNew ? "Nueva rutina" : "Rutina"}</h1>

      {state.status === "loading" ? <p className="muted">Cargando…</p> : null}
      {state.status === "error" ? (
        <LoadError message={state.message} offline={state.offline} onRetry={() => void reload()} />
      ) : null}
      {state.status === "ready" && !isNew && routine === null ? (
        <div className="card">
          <p className="card-title">Rutina no encontrada</p>
          <p className="muted">Puede que se haya archivado.</p>
          <Link to="/entreno" className="button">
            Volver a Entreno
          </Link>
        </div>
      ) : null}
      {state.status === "ready" && (isNew || routine !== null) ? (
        <RoutineForm key={id} routine={routine} routines={state.data.routines} names={state.data.names} />
      ) : null}
    </section>
  );
}
