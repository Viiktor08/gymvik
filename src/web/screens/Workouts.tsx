import { useState } from "react";
import { Link } from "react-router";
import type { Routine } from "../../shared/types";
import { api, apiWithin } from "../api";
import { ArrowDownIcon, ArrowUpIcon, ChevronRightIcon, PlusIcon } from "../components/icons";
import { LoadError } from "../components/LoadError";
import { LOAD_TIMEOUT_MS, loadRoutines } from "../session/offlineData";
import { refreshSnapshotInBackground } from "../session/sync";
import type { TodayData } from "../todayData";
import { failureMessage, useLoad } from "../useLoad";

type Loaded = {
  routines: Routine[];
  /** Sin conexión: las rutinas salen de la copia guardada en el móvil. Se pueden empezar, no reordenar. */
  fromCache: boolean;
  /** La rutina que toca; `null` si no hay o si Hoy no respondió (entonces no se marca ninguna). */
  nextId: string | null;
};

/** Qué rutina toca según el servidor; `null` si no hay ninguna o si Hoy no responde (entonces no se marca ninguna). */
async function fetchNextId(): Promise<string | null> {
  // Es solo un adorno de la lista: con poca señal no puede retrasar las rutinas.
  const today = await apiWithin<TodayData>("/api/today", LOAD_TIMEOUT_MS).catch(() => null);
  return today?.next?.routine.id ?? null;
}

async function fetchLoaded(): Promise<Loaded> {
  // La lista es lo imprescindible; qué rutina toca solo la completa.
  const [routines, nextId] = await Promise.all([loadRoutines({ timeoutMs: LOAD_TIMEOUT_MS }), fetchNextId()]);
  return { routines: routines.data, fromCache: routines.fromCache, nextId };
}

function exerciseCount(n: number): string {
  return n === 1 ? "1 ejercicio" : `${n} ejercicios`;
}

type CardProps = {
  routine: Routine;
  isNext: boolean;
  /** Solo las rutinas en rotación se reordenan. */
  move: { canUp: boolean; canDown: boolean; busy: boolean; onUp: () => void; onDown: () => void } | null;
};

function RoutineCard({ routine, isNext, move }: CardProps) {
  return (
    <li className={isNext ? "card routine-card card-hero" : "card routine-card"}>
      <div className="routine-card-head">
        <div className="routine-card-title">
          {isNext ? <span className="badge">SIGUIENTE</span> : null}
          <h3>{routine.name}</h3>
          <p className="muted">{exerciseCount(routine.items.length)}</p>
        </div>
        {move ? (
          <div className="routine-item-tools">
            <button
              type="button"
              className="icon-button"
              aria-label={`Subir ${routine.name}`}
              disabled={!move.canUp || move.busy}
              onClick={move.onUp}
            >
              <ArrowUpIcon />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={`Bajar ${routine.name}`}
              disabled={!move.canDown || move.busy}
              onClick={move.onDown}
            >
              <ArrowDownIcon />
            </button>
          </div>
        ) : null}
      </div>
      <div className="card-actions">
        <Link
          to={`/entreno/sesion?rutina=${encodeURIComponent(routine.id)}`}
          className="button button-primary"
          aria-label={`Empezar ${routine.name}`}
        >
          Empezar
        </Link>
        <Link to={`/entreno/rutina/${encodeURIComponent(routine.id)}`} className="link-quiet" aria-label={`Editar ${routine.name}`}>
          Editar
        </Link>
      </div>
    </li>
  );
}

/** Pestaña Entreno (spec §5.2): rutinas en rotación y otras, entreno libre y accesos a Historial y Biblioteca. */
export function Workouts() {
  const { state, reload, setData } = useLoad(fetchLoaded);
  const [busy, setBusy] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);

  /** Cambia de sitio una rutina de la rotación y manda siempre la lista completa de la rotación. */
  async function move(rotation: readonly Routine[], index: number, by: -1 | 1) {
    if (busy || state.status !== "ready") return;
    const ids = rotation.map((routine) => routine.id);
    const moved = ids[index];
    const other = ids[index + by];
    if (moved === undefined || other === undefined) return;
    ids[index] = other;
    ids[index + by] = moved;

    setBusy(true);
    setMoveError(null);
    try {
      const routines = await api<Routine[]>("/api/routines/reorder", { method: "POST", body: JSON.stringify({ ids }) });
      // "Te toca" sin conexión sale de la copia del móvil: tiene que seguir el orden nuevo.
      refreshSnapshotInBackground();
      // "Te toca" depende del orden de la rotación: se vuelve a pedir a Hoy y se cambia todo a la vez, sin pantalla de carga.
      // Si Hoy no responde no se deja la etiqueta de antes (sería la de otra rutina): se quita hasta recargar.
      setData({ routines, fromCache: false, nextId: await fetchNextId() });
    } catch (failure) {
      setMoveError(failureMessage(failure, "No se pudo cambiar el orden"));
    } finally {
      setBusy(false);
    }
  }

  const rotation =
    state.status === "ready"
      ? state.data.routines.filter((routine) => routine.inRotation).sort((a, b) => a.rotationOrder - b.rotationOrder)
      : [];
  const others = state.status === "ready" ? state.data.routines.filter((routine) => !routine.inRotation) : [];

  return (
    <section className="screen stack" aria-busy={state.status === "loading"}>
      <h1>Entreno</h1>

      <div className="card-grid">
        {/* Su propia intención: sin `libre`, /entreno/sesion es el "Continuar" de Hoy y retoma cualquier borrador. */}
        <Link to="/entreno/sesion?libre=1" className="button button-primary">
          Entreno libre
        </Link>
        <Link to="/entreno/rutina/nueva" className="button">
          <PlusIcon />
          Nueva rutina
        </Link>
      </div>

      {state.status === "loading" ? <p className="muted">Cargando…</p> : null}
      {state.status === "error" ? (
        <LoadError message={state.message} offline={state.offline} onRetry={() => void reload()} />
      ) : null}

      {state.status === "ready" && state.data.fromCache ? (
        <p role="status" className="notice">
          Sin conexión: estas son las rutinas guardadas en el móvil. Puedes entrenar igualmente.
        </p>
      ) : null}

      {state.status === "ready" && state.data.routines.length === 0 ? (
        <div className="card">
          <p className="card-title">Todavía no tienes rutinas</p>
          <p className="muted">Crea una y, si la pones en la rotación, cada día verás en Hoy cuál te toca.</p>
        </div>
      ) : null}

      {state.status === "ready" && state.data.routines.length > 0 ? (
        <>
          <section className="stack" aria-labelledby="section-rotation">
            <h2 id="section-rotation">En rotación</h2>
            {rotation.length === 0 ? <p className="muted">Ninguna rutina en la rotación.</p> : null}
            {rotation.length > 0 ? (
              <ul className="routine-list">
                {rotation.map((routine, index) => (
                  <RoutineCard
                    key={routine.id}
                    routine={routine}
                    isNext={routine.id === state.data.nextId}
                    move={
                      state.data.fromCache
                        ? null
                        : {
                            canUp: index > 0,
                            canDown: index < rotation.length - 1,
                            busy,
                            onUp: () => void move(rotation, index, -1),
                            onDown: () => void move(rotation, index, 1),
                          }
                    }
                  />
                ))}
              </ul>
            ) : null}
            {moveError ? (
              <p role="alert" className="form-error">
                {moveError}
              </p>
            ) : null}
          </section>

          {others.length > 0 ? (
            <section className="stack" aria-labelledby="section-others">
              <h2 id="section-others">Otras rutinas</h2>
              <ul className="routine-list">
                {others.map((routine) => (
                  <RoutineCard key={routine.id} routine={routine} isNext={routine.id === state.data.nextId} move={null} />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}

      <ul className="list">
        <li>
          <Link to="/entreno/historial" className="list-row">
            <span className="list-row-main">Historial</span>
            <ChevronRightIcon />
          </Link>
        </li>
        <li>
          <Link to="/entreno/biblioteca" className="list-row">
            <span className="list-row-main">Biblioteca</span>
            <ChevronRightIcon />
          </Link>
        </li>
      </ul>
    </section>
  );
}
