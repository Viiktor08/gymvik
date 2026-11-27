import { Sheet } from "../components/Sheet";

type Props = {
  title: string;
  /** Qué ejercicio es (su sitio entre `count` y cuántas series tiene); `null` con el menú cerrado. */
  position: { index: number; count: number; sets: number } | null;
  onAddSet: () => void;
  onRemoveSet: () => void;
  onSwap: () => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
  onClose: () => void;
};

/**
 * Menú ⋯ de un ejercicio. Añadir o quitar serie y mover no lo cierran, para poder repetirlos;
 * cambiar por otro ejercicio y quitar sí.
 */
export function ExerciseMenu({ title, position, onAddSet, onRemoveSet, onSwap, onMove, onRemove, onClose }: Props) {
  return (
    <Sheet open={position !== null} title={title} onClose={onClose}>
      {position === null ? null : (
        <ul className="list">
          <li>
            <button type="button" className="list-row" onClick={onAddSet}>
              <span className="list-row-main">Añadir serie</span>
            </button>
          </li>
          <li>
            <button type="button" className="list-row" disabled={position.sets <= 1} onClick={onRemoveSet}>
              <span className="list-row-main">Quitar última serie</span>
            </button>
          </li>
          <li>
            <button type="button" className="list-row" onClick={onSwap}>
              <span className="list-row-main">Cambiar por otro ejercicio</span>
            </button>
          </li>
          <li>
            <button type="button" className="list-row" disabled={position.index === 0} onClick={() => onMove(-1)}>
              <span className="list-row-main">Subir</span>
            </button>
          </li>
          <li>
            <button type="button" className="list-row" disabled={position.index >= position.count - 1} onClick={() => onMove(1)}>
              <span className="list-row-main">Bajar</span>
            </button>
          </li>
          <li>
            <button type="button" className="list-row session-danger" onClick={onRemove}>
              <span className="list-row-main">Quitar ejercicio</span>
            </button>
          </li>
        </ul>
      )}
    </Sheet>
  );
}
