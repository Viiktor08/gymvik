import { Link } from "react-router";
import type { TodayData } from "../todayData";
import { NBSP } from "../format";

type Props = {
  next: TodayData["next"];
  /** Nombre de cada ejercicio por id; `null` si no se pudieron cargar (se enseña solo el recuento). */
  exerciseNames: ReadonlyMap<string, string> | null;
};

function exerciseCount(n: number): string {
  return n === 1 ? "1 ejercicio" : `${n} ejercicios`;
}

/** "Te toca hoy": la siguiente rutina de la rotación, o la invitación a crear la primera. */
export function NextRoutineCard({ next, exerciseNames }: Props) {
  if (next === null) {
    return (
      <section className="card card-hero" aria-label="Te toca hoy">
        <p className="card-eyebrow" aria-hidden="true">
          Te toca hoy
        </p>
        <h2>Crea tu primera rutina</h2>
        <p className="muted">Añade una rutina a la rotación y aquí verás cada día cuál te toca.</p>
        <div className="card-actions">
          <Link to="/entreno/rutina/nueva" className="button button-primary">
            Crear rutina
          </Link>
        </div>
      </section>
    );
  }

  const { routine, estimatedMin } = next;
  const items = [...routine.items].sort((a, b) => a.position - b.position);
  const duration = Number.isFinite(estimatedMin) && estimatedMin > 0 ? `~${Math.round(estimatedMin)}${NBSP}min · ` : "";

  return (
    <section className="card card-hero" aria-label="Te toca hoy">
      <p className="card-eyebrow" aria-hidden="true">
        Te toca hoy
      </p>
      <h2>{routine.name}</h2>
      <p className="muted">
        {duration}
        {exerciseCount(items.length)}
      </p>
      {exerciseNames !== null && items.length > 0 ? (
        <ul className="exercise-list">
          {items.map((item) => (
            <li key={`${item.position}-${item.exerciseId}`}>
              <span>{exerciseNames.get(item.exerciseId) ?? "Ejercicio"}</span>
              <span className="muted">{`${item.sets} × ${item.repsTarget}`}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="card-actions">
        <Link to={`/entreno/sesion?rutina=${encodeURIComponent(routine.id)}`} className="button button-primary">
          Empezar
        </Link>
        <Link to="/entreno" className="link-quiet">
          Hacer otra
        </Link>
      </div>
    </section>
  );
}
