import { useId, useState } from "react";
import type { Category } from "../../shared/types";
import { MoreIcon, CheckIcon } from "../components/icons";
import { NumberInput } from "../components/NumberInput";
import type { SetField } from "./draftOps";
import type { Draft } from "./draftStore";

type Props = {
  exercise: Draft["exercises"][number];
  name: string;
  category: Category;
  /** "60×10 · 60×9", o "" si nunca se hizo. */
  lastText: string;
  onField: (setIndex: number, field: SetField, value: number | null) => void;
  onToggle: (setIndex: number) => void;
  onMenu: () => void;
};

/** Un ejercicio de la sesión: su nombre, la última vez y una fila por serie con su ✓. */
export function ExerciseCard({ exercise, name, category, lastText, onField, onToggle, onMenu }: Props) {
  const headingId = useId();
  const cardio = category === "cardio";
  // El RIR es opcional: plegado salvo que alguna serie ya lo tenga.
  const [rirOpen, setRirOpen] = useState(() => exercise.sets.some((set) => set.rir !== null));
  const columns = cardio ? "session-sets-cardio" : rirOpen ? "session-sets-rir" : "session-sets-strength";

  return (
    <section className="card session-card" aria-labelledby={headingId}>
      <div className="session-card-head">
        <div className="session-card-title">
          <h2 id={headingId}>{name}</h2>
          {lastText === "" ? null : <p className="muted">{`Última vez: ${lastText}`}</p>}
        </div>
        <button type="button" className="icon-button" aria-label={`Opciones de ${name}`} onClick={onMenu}>
          <MoreIcon />
        </button>
      </div>

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
            <li key={index} className={set.done ? "session-set session-set-done" : "session-set"}>
              <span className="session-set-number" aria-hidden="true">
                {n}
              </span>
              {cardio ? (
                <>
                  <NumberInput
                    className="session-input"
                    aria-label={`Minutos, serie ${n}`}
                    value={set.durationMin}
                    onChange={(value) => onField(index, "durationMin", value)}
                  />
                  <NumberInput
                    className="session-input"
                    aria-label={`Distancia (km), serie ${n}`}
                    value={set.distanceKm}
                    onChange={(value) => onField(index, "distanceKm", value)}
                  />
                </>
              ) : (
                <>
                  <NumberInput
                    className="session-input"
                    aria-label={`Peso, serie ${n}`}
                    value={set.weightKg}
                    onChange={(value) => onField(index, "weightKg", value)}
                  />
                  <NumberInput
                    className="session-input"
                    aria-label={`Repeticiones, serie ${n}`}
                    decimals={0}
                    value={set.reps}
                    onChange={(value) => onField(index, "reps", value)}
                  />
                  {rirOpen ? (
                    <NumberInput
                      className="session-input"
                      aria-label={`RIR, serie ${n}`}
                      decimals={0}
                      value={set.rir}
                      onChange={(value) => onField(index, "rir", value)}
                    />
                  ) : null}
                </>
              )}
              <button
                type="button"
                className={set.done ? "session-check session-check-done" : "session-check"}
                aria-label={set.done ? `Desmarcar serie ${n}` : `Marcar serie ${n} como hecha`}
                onClick={() => onToggle(index)}
              >
                <CheckIcon />
              </button>
            </li>
          );
        })}
      </ol>

      {cardio ? null : (
        <button type="button" className="link-quiet session-rir-toggle" aria-expanded={rirOpen} onClick={() => setRirOpen((open) => !open)}>
          RIR
        </button>
      )}
    </section>
  );
}
