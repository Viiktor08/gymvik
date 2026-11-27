import { useId, useState, type FormEvent } from "react";
import type { Exercise, Routine, Workout, WorkoutExercise } from "../../shared/types";
import { api } from "../api";
import { buildManualWorkout, deviceToday, manualError, workoutBody } from "../historyData";
import { refreshSnapshot } from "../session/offlineCache";
import { failureMessage, useLoad } from "../useLoad";
import { LoadError } from "./LoadError";
import { NumberInput } from "./NumberInput";
import { WorkoutExercisesEditor } from "./WorkoutExercisesEditor";

// Los ejercicios se eligen en el propio formulario: no hay nombres que conocer de antemano.
const NO_CATALOG: ReadonlyMap<string, Exercise> = new Map();

type Props = {
  /** Se llama con el entreno que guardó el servidor. El formulario se vacía solo para el siguiente. */
  onSaved: (workout: Workout) => void;
  /** Si se pasa, se ofrece "Cancelar". */
  onCancel?: () => void;
};

/**
 * Apunta un entreno ya hecho: fecha (hoy o pasada), rutina o libre, duración y, si se quiere,
 * las series. Sirve en el Historial y en Ajustes. Abre una hoja para elegir ejercicios: no lo metas en otra hoja.
 */
export function ManualWorkoutForm({ onSaved, onCancel }: Props) {
  const ids = useId();
  const routines = useLoad(() => api<Routine[]>("/api/routines"));
  const [date, setDate] = useState(() => deviceToday());
  const [routineId, setRoutineId] = useState("");
  const [durationMin, setDurationMin] = useState<number | null>(null);
  const [exercises, setExercises] = useState<WorkoutExercise[]>([]);
  // El id se genera una vez: si el aviso de guardado se pierde y se vuelve a pulsar, el PUT es el mismo entreno.
  const [workoutId, setWorkoutId] = useState(() => crypto.randomUUID());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const problem = manualError({ date, today: deviceToday(), durationMin });
    if (problem !== null || durationMin === null) {
      setError(problem ?? "Indica la duración en minutos.");
      return;
    }

    const workout = buildManualWorkout({
      id: workoutId,
      date,
      routineId: routineId === "" ? null : routineId,
      durationMin,
      exercises,
    });
    setSaving(true);
    setError(null);
    try {
      const saved = await api<{ workout: Workout }>(`/api/workouts/${encodeURIComponent(workout.id)}`, {
        method: "PUT",
        body: JSON.stringify(workoutBody(workout)),
      });
      // Lo que se acaba de guardar puede cambiar la "última vez" de la copia sin conexión.
      void refreshSnapshot().catch(() => undefined);
      setDate(deviceToday());
      setRoutineId("");
      setDurationMin(null);
      setExercises([]);
      setWorkoutId(crypto.randomUUID());
      onSaved(saved.workout);
    } catch (failure) {
      setError(failureMessage(failure, "No se pudo guardar el entreno"));
    } finally {
      setSaving(false);
    }
  }

  if (routines.state.status === "loading") return <p className="muted">Cargando…</p>;
  if (routines.state.status === "error") {
    return <LoadError message={routines.state.message} offline={routines.state.offline} onRetry={() => void routines.reload()} />;
  }

  return (
    <form className="stack" onSubmit={(event) => void submit(event)} noValidate>
      <div>
        <label className="field-label" htmlFor={`${ids}-date`}>
          Fecha
        </label>
        <input
          id={`${ids}-date`}
          className="input"
          type="date"
          max={deviceToday()}
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
      </div>

      <div>
        <label className="field-label" htmlFor={`${ids}-routine`}>
          Rutina
        </label>
        <select id={`${ids}-routine`} className="input" value={routineId} onChange={(event) => setRoutineId(event.target.value)}>
          <option value="">Entreno libre</option>
          {routines.state.data.map((routine) => (
            <option key={routine.id} value={routine.id}>
              {routine.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="field-label" htmlFor={`${ids}-duration`}>
          Duración (min)
        </label>
        <NumberInput id={`${ids}-duration`} decimals={0} placeholder="45" value={durationMin} onChange={setDurationMin} />
      </div>

      <section className="stack" aria-labelledby={`${ids}-sets`}>
        <h2 id={`${ids}-sets`}>Series (opcional)</h2>
        <WorkoutExercisesEditor exercises={exercises} catalog={NO_CATALOG} onChange={setExercises} />
      </section>

      {error ? (
        <p role="alert" className="form-error">
          {error}
        </p>
      ) : null}

      <div className="actions">
        <button type="submit" className="button button-primary" disabled={saving}>
          Guardar entreno
        </button>
        {onCancel ? (
          <button type="button" className="button" disabled={saving} onClick={onCancel}>
            Cancelar
          </button>
        ) : null}
      </div>
    </form>
  );
}
