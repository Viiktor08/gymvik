import { useId, useState } from "react";
import { PlusIcon } from "../components/icons";
import { ManualWorkoutForm } from "../components/ManualWorkoutForm";

/**
 * Entreno pasado: el mismo formulario del Historial, en línea. El formulario abre su propia hoja
 * para elegir ejercicios, así que no puede vivir dentro de otra hoja.
 */
export function PastWorkoutSection() {
  const titleId = useId();
  const [adding, setAdding] = useState(false);
  const [saved, setSaved] = useState(false);

  return (
    <section className="stack" aria-labelledby={titleId}>
      <h2 id={titleId}>Entreno pasado</h2>
      {adding ? (
        <div className="card">
          <ManualWorkoutForm
            onSaved={() => {
              setAdding(false);
              setSaved(true);
            }}
          />
          {/* Fuera del formulario: si no carga las rutinas (sin red) también hay salida. */}
          <button type="button" className="button" onClick={() => setAdding(false)}>
            Cancelar
          </button>
        </div>
      ) : (
        <div className="card">
          <p className="muted">Apunta un entreno que hiciste sin la app: fecha, rutina, duración y, si quieres, las series.</p>
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
        </div>
      )}
    </section>
  );
}
