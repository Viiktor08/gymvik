import { useId, useState, type FormEvent } from "react";
import { isValidLocalDate } from "../../shared/dates";
import { api } from "../api";
import { NumberInput } from "../components/NumberInput";
import { deviceToday } from "../historyData";
import { failureMessage } from "../useLoad";

/** Peso manual (spec §5.7): fecha, peso y % de grasa. También se puede apuntar desde Hoy. */
export function WeightSection() {
  const ids = useId();
  const [date, setDate] = useState(() => deviceToday());
  const [weight, setWeight] = useState<number | null>(null);
  const [bodyFat, setBodyFat] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaved(false);
    if (!isValidLocalDate(date)) {
      setError("Elige la fecha del peso.");
      return;
    }
    if (date > deviceToday()) {
      setError("La fecha no puede ser futura.");
      return;
    }
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
      await api(`/api/body-metrics/${date}`, { method: "PUT", body: JSON.stringify({ weightKg: weight, bodyFatPct: bodyFat }) });
      setWeight(null);
      setBodyFat(null);
      setSaved(true);
    } catch (failure) {
      setError(failureMessage(failure, "No se pudo guardar el peso"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="stack" aria-labelledby={`${ids}-title`}>
      <h2 id={`${ids}-title`}>Peso</h2>
      <form className="card" onSubmit={(event) => void save(event)} noValidate>
        <div>
          <label className="field-label" htmlFor={`${ids}-date`}>
            Fecha
          </label>
          <input
            id={`${ids}-date`}
            className="input"
            type="date"
            max={deviceToday()}
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </div>
        <div>
          <label className="field-label" htmlFor={`${ids}-weight`}>
            Peso (kg)
          </label>
          <NumberInput id={`${ids}-weight`} placeholder="57,5" value={weight} onChange={setWeight} />
        </div>
        <div>
          <label className="field-label" htmlFor={`${ids}-fat`}>
            % de grasa (opcional)
          </label>
          <NumberInput id={`${ids}-fat`} value={bodyFat} onChange={setBodyFat} />
        </div>
        {error ? (
          <p role="alert" className="form-error">
            {error}
          </p>
        ) : null}
        {saved ? (
          <p role="status" className="notice">
            Peso guardado.
          </p>
        ) : null}
        <button type="submit" className="button button-primary" disabled={saving}>
          Guardar peso
        </button>
      </form>
    </section>
  );
}
