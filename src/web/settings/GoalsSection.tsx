import { useId, useState, type FormEvent } from "react";
import type { Settings } from "../../shared/types";
import { NumberInput } from "../components/NumberInput";
import { failureMessage } from "../useLoad";
import { patchSettings } from "./settingsApi";

type Goals = Pick<Settings, "weeklyGoal" | "stepsGoal" | "creatineGrams">;

const MAX_STEPS = 200_000;
const MAX_GRAMS = 100;

function validationProblem(weekly: number | null, steps: number | null, grams: number | null): string | null {
  if (weekly === null || !Number.isInteger(weekly) || weekly < 1 || weekly > 7) {
    return "Los entrenos por semana tienen que ser un número entero entre 1 y 7.";
  }
  if (steps === null || !Number.isInteger(steps) || steps < 1 || steps > MAX_STEPS) {
    return "Los pasos al día tienen que ser un número entero entre 1 y 200.000.";
  }
  if (grams === null || grams <= 0 || grams > MAX_GRAMS) {
    return "Los gramos de creatina tienen que ser mayores que 0 y no pasar de 100.";
  }
  return null;
}

/** Objetivos: entrenos por semana (define la racha), pasos al día y gramos de creatina. */
export function GoalsSection({ initial }: { initial: Goals }) {
  const ids = useId();
  const [weekly, setWeekly] = useState<number | null>(initial.weeklyGoal);
  const [steps, setSteps] = useState<number | null>(initial.stepsGoal);
  const [grams, setGrams] = useState<number | null>(initial.creatineGrams);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaved(false);
    const problem = validationProblem(weekly, steps, grams);
    if (problem !== null || weekly === null || steps === null || grams === null) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await patchSettings({ weeklyGoal: weekly, stepsGoal: steps, creatineGrams: grams });
      setSaved(true);
    } catch (failure) {
      setError(failureMessage(failure, "No se pudieron guardar los objetivos"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="stack" aria-labelledby={`${ids}-title`}>
      <h2 id={`${ids}-title`}>Objetivos</h2>
      <form className="card" onSubmit={(event) => void save(event)} noValidate>
        <div>
          <label className="field-label" htmlFor={`${ids}-weekly`}>
            Entrenos por semana
          </label>
          <NumberInput id={`${ids}-weekly`} decimals={0} value={weekly} onChange={setWeekly} />
        </div>
        <div>
          <label className="field-label" htmlFor={`${ids}-steps`}>
            Pasos al día
          </label>
          <NumberInput id={`${ids}-steps`} decimals={0} value={steps} onChange={setSteps} />
        </div>
        <div>
          <label className="field-label" htmlFor={`${ids}-grams`}>
            Creatina (g)
          </label>
          <NumberInput id={`${ids}-grams`} value={grams} onChange={setGrams} />
        </div>
        {error ? (
          <p role="alert" className="form-error">
            {error}
          </p>
        ) : null}
        {saved ? (
          <p role="status" className="notice">
            Objetivos guardados.
          </p>
        ) : null}
        <button type="submit" className="button button-primary" disabled={saving}>
          Guardar objetivos
        </button>
      </form>
    </section>
  );
}
