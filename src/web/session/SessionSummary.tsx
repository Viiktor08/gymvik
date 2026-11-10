import type { SessionTotals } from "./finish";
import { Totals } from "./Totals";

export type Finished = {
  routineName: string | null;
  totals: SessionTotals;
  notes: string;
  /** Los récords que devolvió el servidor; `null` si no se conocen (aún sin enviar, o se envió en otro momento). */
  records: { name: string; labels: string[] }[] | null;
  /** El entreno sigue en la cola, esperando conexión o sesión. */
  pending: boolean;
  /** El servidor lo ha rechazado: no está en la cuenta, pero sigue guardado en el móvil (Hoy deja reintentarlo). */
  rejected: boolean;
};

type Props = Finished & { onDone: () => void };

/** Lo que se enseña al terminar: los números, los récords (🏆) y si el entreno ya está en la cuenta. */
export function SessionSummary({ routineName, totals, notes, records, pending, rejected, onDone }: Props) {
  return (
    <section className="screen stack">
      <h1>{rejected ? "Entreno sin guardar" : "Entreno terminado"}</h1>
      <p className="muted">{routineName ?? "Entreno libre"}</p>

      {rejected ? (
        <>
          <p role="alert" className="form-error">
            No se ha podido guardar este entreno; sigue guardado en este móvil.
          </p>
          <p className="muted">Podrás reintentarlo desde Hoy.</p>
        </>
      ) : null}

      {pending ? (
        <p role="status" className="notice">
          Guardado en el móvil. Se enviará solo cuando vuelva la conexión.
        </p>
      ) : null}

      <section className="card" aria-label="Resumen">
        <Totals totals={totals} />
        {notes === "" ? null : (
          <>
            <p className="card-title">Notas</p>
            <p className="session-notes">{notes}</p>
          </>
        )}
      </section>

      {pending ? <p className="muted">Récords pendientes de sincronizar</p> : null}
      {!pending && !rejected && records !== null && records.length === 0 ? <p className="muted">Sin récords nuevos esta vez.</p> : null}
      {!pending && !rejected && records !== null && records.length > 0 ? (
        <section className="card" aria-label="Récords nuevos">
          <h2>
            <span aria-hidden="true">🏆 </span>Récords nuevos
          </h2>
          <ul className="record-list">
            {records.map((record) => (
              <li key={record.name}>
                <span className="record-name">{record.name}</span>
                <ul className="record-labels">
                  {record.labels.map((label) => (
                    <li key={label}>{label}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="actions">
        <button type="button" className="button button-primary" onClick={onDone}>
          Listo
        </button>
      </div>
    </section>
  );
}
