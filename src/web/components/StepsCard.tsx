import { formatThousands } from "../../shared/dates";

type Props = {
  /** `null` es "sin datos"; `0` es un dato real. */
  steps: number | null;
  goal: number;
  /** Nombre del Atajo de Salud; `null` si los ajustes no se pudieron cargar (entonces no hay botón). */
  shortcutName: string | null;
};

/**
 * Enlace que abre el Atajo. Sin `x-success` a propósito: iOS abriría esa URL https en Safari, no en la app
 * instalada, con otra cookie y delante del login (spec §5.1). Al terminar, iOS enseña el enlace "◀ Gymvik" para
 * volver a la app, y Hoy se refresca al volver a primer plano.
 */
function shortcutUrl(shortcutName: string): string {
  return `shortcuts://run-shortcut?name=${encodeURIComponent(shortcutName)}`;
}

/** Pasos de hoy frente al objetivo y el botón "Sincronizar". */
export function StepsCard({ steps, goal, shortcutName }: Props) {
  const hasSteps = steps !== null && Number.isFinite(steps);
  const target = Number.isFinite(goal) && goal > 0 ? goal : null;
  // La barra no pasa del 100 %, aunque los pasos superen el objetivo.
  const shown = hasSteps && target !== null ? Math.min(steps, target) : null;

  return (
    <section className="card" aria-label="Pasos">
      <h2 className="card-title">Pasos</h2>
      {hasSteps ? (
        <>
          <p className="metric">
            <strong>{formatThousands(steps)}</strong>
            {target !== null ? <span className="muted">{` / ${formatThousands(target)}`}</span> : null}
          </p>
          {shown !== null && target !== null ? (
            <div
              className="bar"
              role="progressbar"
              aria-label="Pasos de hoy"
              aria-valuemin={0}
              aria-valuemax={target}
              aria-valuenow={shown}
            >
              <div className="bar-fill" style={{ width: `${(shown / target) * 100}%` }} />
            </div>
          ) : null}
        </>
      ) : (
        <>
          <p className="metric">
            <strong>—</strong>
          </p>
          <p className="muted">Sin datos todavía</p>
        </>
      )}
      {shortcutName ? (
        <a className="button" href={shortcutUrl(shortcutName)}>
          Sincronizar
        </a>
      ) : null}
    </section>
  );
}
