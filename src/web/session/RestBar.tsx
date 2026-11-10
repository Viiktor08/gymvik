import { formatClock } from "../format";

type Props = {
  remaining: number;
  onAdd: () => void;
  onSkip: () => void;
};

/** Cuenta atrás del descanso, fija encima de la barra de pestañas. */
export function RestBar({ remaining, onAdd, onSkip }: Props) {
  return (
    <div className="rest-bar" role="timer" aria-label="Descanso">
      <span className="rest-bar-label">Descanso</span>
      <span className="rest-bar-time">{formatClock(remaining)}</span>
      <button type="button" className="button" onClick={onAdd}>
        +15 s
      </button>
      <button type="button" className="button button-primary" onClick={onSkip}>
        Saltar
      </button>
    </div>
  );
}
