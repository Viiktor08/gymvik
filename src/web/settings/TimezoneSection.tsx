import { useId, useMemo, useState, type FormEvent } from "react";
import { failureMessage } from "../useLoad";
import { patchSettings } from "./settingsApi";

// Por si el navegador no sabe listar sus zonas (`Intl.supportedValuesOf`): las de España y las más usuales.
const FALLBACK_ZONES: readonly string[] = [
  "Atlantic/Canary",
  "Europe/Lisbon",
  "Europe/London",
  "Europe/Madrid",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Rome",
  "America/Argentina/Buenos_Aires",
  "America/Bogota",
  "America/Mexico_City",
  "America/New_York",
  "America/Los_Angeles",
];

/**
 * Las zonas horarias IANA que ofrece el navegador. La zona guardada va siempre en la lista (aunque el navegador no
 * la liste, como "UTC"), para que el selector no enseñe otra distinta de la que hay en la cuenta. Todas valen para
 * el esquema de ajustes del servidor, que las valida con `Intl.DateTimeFormat`.
 */
export function timeZoneOptions(current: string): string[] {
  const listed = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  const zones = listed.length > 0 ? listed : [...FALLBACK_ZONES];
  return zones.includes(current) ? zones : [current, ...zones];
}

/**
 * Zona horaria: con ella se calculan "hoy", la semana (que empieza el lunes), las rachas y la hora de
 * los avisos. Por defecto es Europe/Madrid.
 */
export function TimezoneSection({ initial }: { initial: string }) {
  const ids = useId();
  const options = useMemo(() => timeZoneOptions(initial), [initial]);
  const [timezone, setTimezone] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaved(false);
    setSaving(true);
    setError(null);
    try {
      await patchSettings({ timezone });
      setSaved(true);
    } catch (failure) {
      setError(failureMessage(failure, "No se pudo guardar la zona horaria"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="stack" aria-labelledby={`${ids}-title`}>
      <h2 id={`${ids}-title`}>Zona horaria</h2>
      <form className="card" onSubmit={(event) => void save(event)}>
        <div>
          <label className="field-label" htmlFor={`${ids}-zone`}>
            Zona horaria
          </label>
          <select
            id={`${ids}-zone`}
            className="input"
            value={timezone}
            onChange={(event) => {
              setTimezone(event.target.value);
              setSaved(false);
            }}
          >
            {options.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        </div>
        <p className="muted">Define cuándo empieza cada día y cada semana (el lunes) en tus rachas, estadísticas y avisos.</p>
        {error ? (
          <p role="alert" className="form-error">
            {error}
          </p>
        ) : null}
        {saved ? (
          <p role="status" className="notice">
            Zona horaria guardada.
          </p>
        ) : null}
        <button type="submit" className="button button-primary" disabled={saving}>
          Guardar zona horaria
        </button>
      </form>
    </section>
  );
}
