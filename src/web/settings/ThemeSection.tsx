import { useId, useState } from "react";
import type { Theme } from "../../shared/types";
import { THEMES, applyTheme } from "../theme";
import { failureMessage } from "../useLoad";
import { patchSettings } from "./settingsApi";

const ORDER = Object.keys(THEMES) as Theme[];

function prefersDark(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Tema (spec §5.7): los 8 colores. El modo claro u oscuro lo decide el sistema. */
export function ThemeSection({ initial }: { initial: Theme }) {
  const titleId = useId();
  const [theme, setTheme] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(next: Theme) {
    if (saving || next === theme) return;
    const previous = theme;
    // Se ve al instante; si el servidor no lo guarda se vuelve atrás.
    setTheme(next);
    applyTheme(next);
    setSaving(true);
    setError(null);
    try {
      await patchSettings({ theme: next });
    } catch (failure) {
      setTheme(previous);
      applyTheme(previous);
      setError(failureMessage(failure, "No se pudo guardar el tema"));
    } finally {
      setSaving(false);
    }
  }

  const variant = prefersDark() ? "dark" : "light";

  return (
    <section className="stack" aria-labelledby={titleId}>
      <h2 id={titleId}>Tema</h2>
      <div className="card">
        <ul className="swatches">
          {ORDER.map((key) => (
            <li key={key}>
              <button type="button" className="swatch" aria-pressed={key === theme} disabled={saving} onClick={() => void choose(key)}>
                <span className="swatch-dot" style={{ backgroundColor: THEMES[key][variant].accent }} aria-hidden="true" />
                <span>{THEMES[key].label}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="muted">El modo claro u oscuro sigue al de tu iPhone.</p>
        {error ? (
          <p role="alert" className="form-error">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
