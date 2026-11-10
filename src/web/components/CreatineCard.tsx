import { useState } from "react";
import { ApiError, api } from "../api";
import { CheckIcon } from "./icons";

type Props = {
  /** Fecha de hoy (YYYY-MM-DD), la del servidor. */
  date: string;
  /** Lo que dice el servidor: es la única verdad cuando no hay un toque en curso. */
  taken: boolean;
  /** Se llama cuando el servidor ha confirmado el nuevo estado, para que Hoy lo guarde y vuelva a pedir sus datos. */
  onChange: (taken: boolean) => void;
};

/**
 * Creatina de hoy: tomada o no. Se marca tocando la tarjeta (también la marca el NFC, desde el servidor) y se
 * desmarca tocando otra vez. Mientras la petición está en vuelo se enseña el estado nuevo; si el servidor no lo
 * acepta, se vuelve al que dice `taken`. No guarda copia propia del estado confirmado: si Hoy se refresca (otro
 * dispositivo, el NFC, o un día nuevo), manda lo que llega.
 */
export function CreatineCard({ date, taken: serverTaken, onChange }: Props) {
  // El estado que se está pidiendo al servidor; `null` si no hay ningún toque en curso.
  const [requested, setRequested] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const taken = requested ?? serverTaken;

  async function toggle() {
    if (requested !== null) return;
    const next = !serverTaken;
    setRequested(next);
    setError(null);
    try {
      await api(`/api/creatine/${date}`, { method: next ? "PUT" : "DELETE" });
      onChange(next);
    } catch (failure) {
      // Desmarcar algo que ya no estaba marcado (404) deja el resultado que se quería: no es un error.
      if (!next && failure instanceof ApiError && failure.status === 404) {
        onChange(false);
      } else {
        setError(failure instanceof ApiError ? failure.message : "No se pudo guardar la creatina");
      }
    } finally {
      setRequested(null);
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
