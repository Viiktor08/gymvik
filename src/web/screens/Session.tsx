import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ApiError } from "../api";
import { LoadError } from "../components/LoadError";
import { LiveSession } from "../session/LiveSession";
import { SessionSummary, type Finished } from "../session/SessionSummary";
import { beginSession, type StartOutcome } from "../session/startSession";
import { failureMessage } from "../useLoad";

type State =
  | { status: "loading" }
  | { status: "error"; message: string; offline: boolean }
  | { status: "outcome"; outcome: StartOutcome };

/**
 * Sesión en directo (spec §5.3). Funciona sin conexión: empieza con las rutinas y la última vez guardadas en el
 * móvil, guarda cada cambio en el móvil y al terminar manda el entreno cuando puede.
 *
 * - `/entreno/sesion?rutina=<id>` empieza esa rutina.
 * - `/entreno/sesion` continúa el borrador o, si no hay, empieza un entreno libre.
 */
export function Session() {
  const [params] = useSearchParams();
  const routineId = params.get("rutina");
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  // La rutina para la que el usuario ya ha dicho "sí, descarta el entreno en curso".
  const [replaceFor, setReplaceFor] = useState<string | null>(null);
  const [finished, setFinished] = useState<Finished | null>(null);
  const replace = routineId !== null && replaceFor === routineId;

  useEffect(() => {
    let current = true;
    setState({ status: "loading" });
    beginSession(routineId, replace).then(
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
  }, [routineId, replace, attempt]);

  if (finished) {
    return <SessionSummary {...finished} onDone={() => navigate("/")} />;
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
    return (
      <section className="screen stack">
        <h1>Ya tienes un entreno en curso</h1>
        <p className="muted">
          Si empiezas {outcome.routineName}, el entreno en curso se descarta y se pierden sus series.
        </p>
        <div className="actions">
          <button type="button" className="button button-primary" onClick={() => navigate("/entreno/sesion", { replace: true })}>
            Continuar el entreno en curso
          </button>
          <button type="button" className="button button-danger" onClick={() => setReplaceFor(routineId)}>
            {`Empezar ${outcome.routineName} y descartar el anterior`}
          </button>
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
