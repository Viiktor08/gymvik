import { useId } from "react";
import { Sheet } from "../components/Sheet";
import type { SessionTotals } from "./finish";
import { Totals } from "./Totals";

type Props = {
  open: boolean;
  totals: SessionTotals;
  notes: string;
  onNotes: (notes: string) => void;
  /** La estructura de la sesión difiere de la rutina de origen: se pregunta qué hacer con ella. */
  structureChanged: boolean;
  busy: boolean;
  error: string | null;
  onFinish: (saveToRoutine: boolean) => void;
  onClose: () => void;
};

/** Resumen previo a guardar, con las notas y, si cambió la estructura, la pregunta sobre la rutina (spec §5.3). */
export function FinishSheet({ open, totals, notes, onNotes, structureChanged, busy, error, onFinish, onClose }: Props) {
  const notesId = useId();
  return (
    <Sheet open={open} title="Terminar entreno" onClose={onClose}>
      <div className="stack">
        <Totals totals={totals} />
        <div>
          <label className="field-label" htmlFor={notesId}>
            Notas
          </label>
          <textarea
            id={notesId}
            className="input textarea"
            maxLength={5000}
            value={notes}
            onChange={(event) => onNotes(event.target.value)}
          />
        </div>
        {error ? (
          <p role="alert" className="form-error">
            {error}
          </p>
        ) : null}
        {structureChanged ? (
          <>
            <p className="finish-question">¿Guardar estos cambios en la rutina o solo para hoy?</p>
            <div className="actions">
              <button type="button" className="button button-primary" disabled={busy} onClick={() => onFinish(true)}>
                Guardar en la rutina
              </button>
              <button type="button" className="button" disabled={busy} onClick={() => onFinish(false)}>
                Solo para hoy
              </button>
            </div>
          </>
        ) : (
          <div className="actions">
            <button type="button" className="button button-primary" disabled={busy} onClick={() => onFinish(false)}>
              Guardar entreno
            </button>
          </div>
        )}
      </div>
    </Sheet>
  );
}
