import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { ApiError, api } from "../api";
import { NBSP, formatDecimal, formatShortDate, formatSigned } from "../format";
import type { TodayData } from "../todayData";
import { NumberInput } from "./NumberInput";
import { Sheet } from "./Sheet";

type Props = {
  /** Fecha de hoy (YYYY-MM-DD), la del servidor: el peso se apunta en ese día. */
  date: string;
  lastWeight: TodayData["lastWeight"];
  weekWeightDelta: number | null;
  /** Se llama tras guardar, para que Hoy vuelva a pedir sus datos. */
  onSaved: () => void;
};

const PESO_PARAM = "peso";

function trend(delta: number | null): string {
  if (delta === null || !Number.isFinite(delta)) return "Sin tendencia esta semana";
  const text = formatSigned(delta);
  return text === "0" ? "Sin cambios esta semana" : `${text}${NBSP}kg esta semana`;
}

/** Último peso, tendencia de la semana y la hoja "Apuntar peso". `?peso=1` abre la hoja (aviso de peso). */
export function WeightCard({ date, lastWeight, weekWeightDelta, onSaved }: Props) {
  const [params, setParams] = useSearchParams();
  const open = params.get(PESO_PARAM) === "1";
  const [weight, setWeight] = useState<number | null>(null);
  const [bodyFat, setBodyFat] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function setOpen(next: boolean) {
    setParams(
      (previous) => {
        const copy = new URLSearchParams(previous);
        if (next) copy.set(PESO_PARAM, "1");
        else copy.delete(PESO_PARAM);
        return copy;
      },
      { replace: true },
    );
  }

  // Cerrar sin guardar descarta lo escrito: un peso a medias no debe aparecer mañana.
  function close() {
    setWeight(null);
    setBodyFat(null);
    setError(null);
    setOpen(false);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (weight === null || weight <= 0) {
      setError("Escribe tu peso en kg (mayor que 0).");
      return;
    }
    if (bodyFat !== null && (bodyFat < 0 || bodyFat > 100)) {
      setError("El % de grasa tiene que estar entre 0 y 100.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api(`/api/body-metrics/${date}`, {
        method: "PUT",
        body: JSON.stringify({ weightKg: weight, bodyFatPct: bodyFat }),
      });
      close();
      onSaved();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "No se pudo guardar el peso");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card" aria-label="Peso">
      <h2 className="card-title">Peso</h2>
      {lastWeight ? (
        <>
          <p className="metric">
            <strong>{`${formatDecimal(lastWeight.weightKg)}${NBSP}kg`}</strong>
          </p>
          <p className="muted">{lastWeight.localDate === date ? "Hoy" : formatShortDate(lastWeight.localDate)}</p>
          {lastWeight.bodyFatPct !== null ? (
            <p className="muted">{`${formatDecimal(lastWeight.bodyFatPct)}${NBSP}% de grasa`}</p>
          ) : null}
          <p>{trend(weekWeightDelta)}</p>
        </>
      ) : (
        <>
          <p className="metric">
            <strong>—</strong>
          </p>
          <p className="muted">Sin datos todavía</p>
        </>
      )}
      <button type="button" className="button" onClick={() => setOpen(true)}>
        Apuntar peso
      </button>

      <Sheet open={open} title="Apuntar peso" onClose={close}>
        <form onSubmit={(event) => void save(event)} noValidate>
          <div className="field">
            <label className="field-label" htmlFor="weight-kg">
              Peso (kg)
            </label>
            <NumberInput id="weight-kg" value={weight} onChange={setWeight} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="weight-fat">
              % de grasa (opcional)
            </label>
            <NumberInput id="weight-fat" value={bodyFat} onChange={setBodyFat} />
          </div>
          {error ? (
            <p role="alert" className="form-error">
              {error}
            </p>
          ) : null}
          <div className="actions">
            <button type="submit" className="button button-primary" disabled={saving}>
              Guardar
            </button>
          </div>
        </form>
      </Sheet>
    </section>
  );
}
