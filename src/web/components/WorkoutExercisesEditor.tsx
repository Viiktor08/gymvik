import { useId, useState } from "react";
import type { Exercise, WorkoutExercise } from "../../shared/types";
import type { SetField } from "../session/draftOps";
import { addExerciseTo, addSetTo, removeExerciseAt, removeSetFrom, setSetField } from "../workoutEdit";
import { ExercisePicker } from "./ExercisePicker";
import { CloseIcon, PlusIcon } from "./icons";
import { NumberInput } from "./NumberInput";
import { Sheet } from "./Sheet";

type Props = {
  exercises: WorkoutExercise[];
  /** Nombre y categoría de los ejercicios que ya vienen en el entreno. Los que se añaden aquí no hacen falta. */
  catalog: ReadonlyMap<string, Exercise>;
  onChange: (exercises: WorkoutExercise[]) => void;
};

type CardProps = {
  exercise: WorkoutExercise;
  info: Exercise | undefined;
  onField: (setIndex: number, field: SetField, value: number | null) => void;
  onAddSet: () => void;
  onRemoveSet: (setIndex: number) => void;
  onRemove: () => void;
};

/** Un ejercicio del entreno con una fila editable por serie. El RIR, opcional, va plegado salvo que alguna serie lo tenga. */
function ExerciseEditor({ exercise, info, onField, onAddSet, onRemoveSet, onRemove }: CardProps) {
  const headingId = useId();
  const name = info?.name ?? "Ejercicio";
  const cardio = info?.category === "cardio";
  const [rirToggled, setRirToggled] = useState(false);
  // Con algún RIR escrito la columna no se pliega: no se esconden datos.
  const rirOpen = rirToggled || exercise.sets.some((set) => set.rir !== null);
  const columns = cardio ? "session-sets-cardio" : rirOpen ? "session-sets-rir" : "session-sets-strength";

  return (
    <section className="card session-card" aria-labelledby={headingId}>
      <div className="session-card-head">
        <div className="session-card-title">
          <h2 id={headingId}>{name}</h2>
        </div>
        <button type="button" className="icon-button" aria-label={`Quitar ${name}`} onClick={onRemove}>
          <CloseIcon />
        </button>
      </div>

      {exercise.sets.length === 0 ? <p className="muted">Sin series.</p> : null}
      {exercise.sets.length > 0 ? (
        <ol className={`session-sets ${columns}`}>
          <li className="session-set session-set-head" aria-hidden="true">
            <span>Nº</span>
            {cardio ? (
              <>
                <span>Min</span>
                <span>Km</span>
              </>
            ) : (
              <>
                <span>Kg</span>
                <span>Reps</span>
                {rirOpen ? <span>RIR</span> : null}
              </>
            )}
            <span />
          </li>
          {exercise.sets.map((set, index) => {
            const n = index + 1;
            return (
              <li key={index} className="session-set">
                <span className="session-set-number" aria-hidden="true">
                  {n}
                </span>
                {cardio ? (
                  <>
                    <NumberInput
                      className="session-input"
                      aria-label={`Minutos, serie ${n} de ${name}`}
                      value={set.durationMin}
                      onChange={(value) => onField(index, "durationMin", value)}
                    />
                    <NumberInput
                      className="session-input"
                      aria-label={`Distancia (km), serie ${n} de ${name}`}
                      value={set.distanceKm}
                      onChange={(value) => onField(index, "distanceKm", value)}
                    />
                  </>
                ) : (
                  <>
                    <NumberInput
                      className="session-input"
                      aria-label={`Peso, serie ${n} de ${name}`}
                      value={set.weightKg}
                      onChange={(value) => onField(index, "weightKg", value)}
                    />
                    <NumberInput
                      className="session-input"
                      aria-label={`Repeticiones, serie ${n} de ${name}`}
                      decimals={0}
                      value={set.reps}
                      onChange={(value) => onField(index, "reps", value)}
                    />
                    {rirOpen ? (
                      <NumberInput
                        className="session-input"
                        aria-label={`RIR, serie ${n} de ${name}`}
                        decimals={0}
                        value={set.rir}
                        onChange={(value) => onField(index, "rir", value)}
                      />
                    ) : null}
                  </>
                )}
                <button
                  type="button"
                  className="session-check"
                  aria-label={`Quitar serie ${n} de ${name}`}
                  onClick={() => onRemoveSet(index)}
                >
                  <CloseIcon />
                </button>
              </li>
            );
          })}
        </ol>
      ) : null}

      <div className="card-actions">
        <button type="button" className="button" onClick={onAddSet}>
          <PlusIcon />
          Añadir serie
        </button>
        {cardio ? null : (
          <button type="button" className="link-quiet session-rir-toggle" aria-expanded={rirOpen} onClick={() => setRirToggled((open) => !open)}>
            RIR
          </button>
        )}
      </div>
    </section>
  );
}

/**
 * Los ejercicios y series de un entreno ya hecho, editables: valores, series y ejercicios que se añaden o se
 * quitan. Abre su propia hoja para elegir ejercicio, así que no debe ir dentro de otra hoja.
 */
export function WorkoutExercisesEditor({ exercises, catalog, onChange }: Props) {
  const [picking, setPicking] = useState(false);
  // Los ejercicios elegidos aquí: el `catalog` del padre no los conoce.
  const [picked, setPicked] = useState<ReadonlyMap<string, Exercise>>(() => new Map());

  function pick(exercise: Exercise) {
    setPicked((current) => new Map(current).set(exercise.id, exercise));
    onChange(addExerciseTo(exercises, exercise.id));
    setPicking(false);
  }

  return (
    <div className="stack">
      {exercises.map((exercise, index) => (
        <ExerciseEditor
          key={index}
          exercise={exercise}
          info={catalog.get(exercise.exerciseId) ?? picked.get(exercise.exerciseId)}
          onField={(setIndex, field, value) => onChange(setSetField(exercises, index, setIndex, field, value))}
          onAddSet={() => onChange(addSetTo(exercises, index))}
          onRemoveSet={(setIndex) => onChange(removeSetFrom(exercises, index, setIndex))}
          onRemove={() => onChange(removeExerciseAt(exercises, index))}
        />
      ))}
      <button type="button" className="button session-add" onClick={() => setPicking(true)}>
        <PlusIcon />
        Añadir ejercicio
      </button>
      <Sheet open={picking} title="Añadir ejercicio" onClose={() => setPicking(false)}>
        <ExercisePicker onPick={pick} />
      </Sheet>
    </div>
  );
}
