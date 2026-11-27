import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ApiError } from "../api";
import { LoadError } from "../components/LoadError";
import { LiveSession } from "../session/LiveSession";
import { SessionSummary, type Finished } from "../session/SessionSummary";
import { beginSession, type SessionIntent, type StartOutcome } from "../session/startSession";
import { failureMessage } from "../useLoad";

const startFormat = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

/** "martes 10 de noviembre, 08:05" a partir del instante en que empezó el entreno. */
function formatStart(startedAt: string): string {
  const instant = new Date(startedAt);
  return Number.isNaN(instant.getTime()) ? "un día anterior" : startFormat.format(instant);
}

type State =
  | { status: "loading" }
  | { status: "error"; message: string; offline: boolean }
  | { status: "outcome"; outcome: StartOutcome };

/** Qué pide la dirección: una rutina, un entreno libre nuevo (`?libre=1`) o retomar lo que haya (sin parámetros). */
function intentFrom(routineId: string | null, free: boolean): SessionIntent {
  if (routineId !== null) return { kind: "routine", routineId };
  return free ? { kind: "free" } : { kind: "continue" };
}

/**
 * Sesión en directo. Funciona sin conexión: empieza con las rutinas y la última vez guardadas en el
 * móvil, guarda cada cambio en el móvil y al terminar manda el entreno cuando puede.
 *
 * - `/entreno/sesion?rutina=<id>` empieza esa rutina.
 * - `/entreno/sesion?libre=1` (el botón Entreno libre) empieza un entreno libre; si hay un borrador de una
 *   rutina, o libre pero olvidado, pregunta.
 * - `/entreno/sesion` (el aviso "Continuar" de Hoy) continúa el borrador o, si no hay, empieza un entreno libre.
 */
export function Session() {
  const [params] = useSearchParams();
  const routineId = params.get("rutina");
  const free = params.get("libre") === "1";
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  // Lo que el usuario ya ha confirmado empezar ("sí, descarta el entreno en curso"): una rutina o el entreno libre.
  const intentKey = routineId !== null ? `rutina:${routineId}` : free ? "libre" : null;
  const [replaceFor, setReplaceFor] = useState<string | null>(null);
  const [finished, setFinished] = useState<Finished | null>(null);
  const replace = intentKey !== null && replaceFor === intentKey;

  useEffect(() => {
    let current = true;
    setState({ status: "loading" });
    beginSession(intentFrom(routineId, free), replace).then(
      (outcome) => {
        if (current) setState({ status: "outcome", outcome });
      },
      (failure: unknown) => {
        if (!current) return;
        setState({
          status: "error",
          offline: failure instanceof ApiError && failure.status === 0,
          message: failureMessage(failure, "No se pudo abrir el entreno"),
        });
      },
    );
    return () => {
      current = false;
    };
  }, [routineId, free, replace, attempt]);

  if (finished) {
    return <SessionSummary {...finished} onDone={() => navigate("/", { replace: true })} />;
  }

  if (state.status === "loading") {
    return (
      <section className="screen" aria-busy="true">
        <p className="muted">Cargando entreno…</p>
      </section>
    );
  }

  if (state.status === "error") {
    return (
      <section className="screen stack">
        <h1>Entreno en curso</h1>
        {state.offline ? (
          <div className="card">
            <p role="status" className="card-title">
              {state.message}
            </p>
            <p className="muted">
              Todavía no hay datos guardados en este móvil para entrenar sin conexión. Abre la app una vez con conexión
              y vuelve a intentarlo.
            </p>
            <button type="button" className="button" onClick={() => setAttempt((n) => n + 1)}>
              Reintentar
            </button>
          </div>
        ) : (
          <LoadError message={state.message} offline={false} onRetry={() => setAttempt((n) => n + 1)} />
        )}
      </section>
    );
  }

  const { outcome } = state;

  if (outcome.kind === "missing") {
    return (
      <section className="screen stack">
        <h1>Rutina no encontrada</h1>
        <p className="muted">Puede que se haya borrado. Elige otra desde Entreno.</p>
        <div className="actions">
          <Link to="/entreno" className="button button-primary">
            Ir a Entreno
          </Link>
        </div>
      </section>
    );
  }

  if (outcome.kind === "ask") {
    const continueButton = (label: string) => (
      <button type="button" className="button button-primary" onClick={() => navigate("/entreno/sesion", { replace: true })}>
        {label}
      </button>
    );

    const { target } = outcome;
    // Sin saber el nombre de la rutina (rutinas sin cargar) no se puede empezar de nuevo; un entreno libre sí.
    const canRestart = target.kind === "free" || target.name !== null;
    const restart = () => setReplaceFor(intentKey);

    if (outcome.reason === "stale") {
      return (
        <section className="screen stack">
          <h1>Tienes un entreno sin terminar</h1>
          <p className="muted">
            Lo empezaste el {formatStart(outcome.startedAt)}. Si lo continúas, se guardará con esa fecha y esa duración; si
            empiezas de nuevo, se descarta y se pierden sus series.
          </p>
          <div className="actions">
            {continueButton("Continuar")}
            {canRestart ? (
              <button type="button" className="button button-danger" onClick={restart}>
                Empezar de nuevo
              </button>
            ) : null}
          </div>
        </section>
      );
    }

    return (
      <section className="screen stack">
        <h1>Ya tienes un entreno en curso</h1>
        {target.kind === "routine" && target.name === null ? (
          <p className="muted">Ahora no se puede cargar la otra rutina. Puedes seguir con el entreno en curso.</p>
        ) : (
          <p className="muted">
            {`Si empiezas ${target.kind === "free" ? "un entreno libre" : target.name}, el entreno en curso se descarta y se pierden sus series.`}
          </p>
        )}
        <div className="actions">
          {continueButton("Continuar el entreno en curso")}
          {canRestart ? (
            <button type="button" className="button button-danger" onClick={restart}>
              {`Empezar ${target.kind === "free" ? "un entreno libre" : target.name} y descartar el anterior`}
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <LiveSession
      key={outcome.draft.id}
      initial={outcome.draft}
      context={outcome.context}
      onFinished={setFinished}
      onDiscarded={() => navigate("/entreno")}
    />
  );
}
