import { useState } from "react";
import { ApiError, api } from "../api";
import { CheckIcon } from "./icons";

type Props = {
  /** Fecha de hoy (YYYY-MM-DD), la del servidor. */
  date: string;
  taken: boolean;
};

/**
 * Creatina de hoy: tomada o no. Se marca tocando la tarjeta (también la marca el NFC, desde el servidor) y se
 * desmarca tocando otra vez. El cambio se ve al instante y se deshace si el servidor no lo acepta.
 */
export function CreatineCard({ date, taken: serverTaken }: Props) {
  const [taken, setTaken] = useState(serverTaken);
  const [seen, setSeen] = useState(serverTaken);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Si Hoy se refresca (por ejemplo, el NFC la marcó mientras tanto), manda el servidor; menos a mitad de un toque.
  if (serverTaken !== seen) {
    setSeen(serverTaken);
    if (!pending) setTaken(serverTaken);
  }

  async function toggle() {
    if (pending) return;
    const next = !taken;
    setPending(true);
    setError(null);
    setTaken(next);
    try {
      await api(`/api/creatine/${date}`, { method: next ? "PUT" : "DELETE" });
    } catch (failure) {
      // Desmarcar algo que ya no estaba marcado (404) deja el resultado que se quería: no es un error.
      if (!next && failure instanceof ApiError && failure.status === 404) return;
      setTaken(!next);
      setError(failure instanceof ApiError ? failure.message : "No se pudo guardar la creatina");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="creatine">
      <button
        type="button"
        className={taken ? "card card-button card-done" : "card card-button"}
        aria-pressed={taken}
        onClick={() => void toggle()}
      >
        <span className="check-circle" aria-hidden="true">
          {taken ? <CheckIcon /> : null}
        </span>
        <span className="card-button-text">
          <span className="card-title">Creatina</span>
          <span>{taken ? "Tomada hoy" : "Sin tomar hoy"}</span>
          <span className="muted">{taken ? "Toca para desmarcarla" : "Toca para marcarla"}</span>
        </span>
      </button>
      {error ? (
        <p role="alert" className="form-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
