import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import type { Exercise, Settings } from "../../shared/types";
import { ApiError, api } from "../api";
import { CreatineCard } from "../components/CreatineCard";
import { NextRoutineCard } from "../components/NextRoutineCard";
import { StepsCard } from "../components/StepsCard";
import { WeekCard } from "../components/WeekCard";
import { WeightCard } from "../components/WeightCard";
import { formatLongDate } from "../format";
import { hasDraft } from "../session/draftStore";
import type { TodayData } from "../todayData";

type Loaded = {
  today: TodayData;
  /** `null` si los ejercicios no se pudieron cargar: la rutina se enseña sin nombres. */
  exercises: Exercise[] | null;
  /** `null` si los ajustes no se pudieron cargar: sin nombre de Atajo no hay botón de sincronizar. */
  shortcutName: string | null;
};

type State =
  | { status: "loading" }
  | { status: "error"; message: string; offline: boolean }
  | ({ status: "ready" } & Loaded);

async function fetchToday(): Promise<Loaded> {
  // Hoy es lo único imprescindible; ejercicios y ajustes solo completan la pantalla.
  // `archived=1`: una rutina puede conservar un ejercicio archivado y hay que poder nombrarlo.
  const [today, exercises, settings] = await Promise.all([
    api<TodayData>("/api/today"),
    api<Exercise[]>("/api/exercises?archived=1").catch(() => null),
    api<Settings>("/api/settings").catch(() => null),
  ]);
  return { today, exercises, shortcutName: settings?.shortcutName ?? null };
}

function weeks(n: number): string {
  return n === 1 ? "1 semana" : `${n} semanas`;
}

/** Pantalla Hoy (spec §5.1). */
export function Today() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [draft, setDraft] = useState(false);
  // Solo vale la última petición: un refresco lento no debe pisar a uno posterior.
  const latest = useRef(0);

  // Estado actual para decidir si un refresco puede ser silencioso (la pantalla no se lee dentro del callback).
  const status = useRef<State["status"]>("loading");

  const load = useCallback(async (background: boolean) => {
    const request = ++latest.current;
    // En segundo plano solo si ya hay datos en pantalla. Si no (cargando o en error), esta petición sustituye a la
    // anterior y tiene que dejar un resultado visible: datos o error con Reintentar, nunca un "Cargando…" eterno.
    const silent = background && status.current === "ready";
    if (!silent) {
      status.current = "loading";
      setState({ status: "loading" });
    }
    try {
      const loaded = await fetchToday();
      if (request === latest.current) {
        status.current = "ready";
        setState({ status: "ready", ...loaded });
      }
    } catch (failure) {
      // Un refresco en segundo plano que falla deja en pantalla lo que ya había.
      if (silent || request !== latest.current) return;
      status.current = "error";
      setState({
        status: "error",
        offline: failure instanceof ApiError && failure.status === 0,
        message: failure instanceof ApiError ? failure.message : "No se pudo cargar Hoy",
      });
    }
  }, []);

  // El servidor confirmó la creatina: se refleja ya y se vuelve a pedir Hoy (anula cualquier refresco anterior en vuelo).
  const creatineChanged = useCallback(
    (taken: boolean) => {
      setState((previous) =>
        previous.status === "ready" ? { ...previous, today: { ...previous.today, creatineToday: taken } } : previous,
      );
      void load(true);
    },
    [load],
  );

  useEffect(() => {
    void load(false);
    return () => {
      latest.current++;
    };
  }, [load]);

  // Al volver a la app (por ejemplo, desde el Atajo de pasos) los datos se refrescan solos.
  useEffect(() => {
    const refresh = () => {
      if (!document.hidden) void load(true);
    };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [load]);

  // La sesión en curso vive en el móvil (IndexedDB): se comprueba aunque no haya red.
  useEffect(() => {
    let active = true;
    hasDraft()
      .then((found) => {
        if (active) setDraft(found);
      })
      .catch(() => {
        // Sin IndexedDB (modo privado, por ejemplo) simplemente no hay aviso.
      });
    return () => {
      active = false;
    };
  }, []);

  const exerciseNames = useMemo(
    () =>
      state.status === "ready" && state.exercises !== null
        ? new Map(state.exercises.map((exercise) => [exercise.id, exercise.name]))
        : null,
    [state],
  );

  return (
    <section className="screen today" aria-busy={state.status === "loading"}>
      {draft ? (
        <div className="banner">
          <span>Tienes un entreno en curso</span>
          <Link to="/entreno/sesion" className="button button-primary">
            Continuar
          </Link>
        </div>
      ) : null}

      {state.status === "loading" ? (
        <>
          <h1>Hoy</h1>
          <p className="muted">Cargando…</p>
        </>
      ) : null}

      {state.status === "error" ? (
        <>
          <h1>Hoy</h1>
          <div className="card">
            {state.offline ? (
              <>
                <p role="status" className="card-title">
                  {state.message}
                </p>
                <p className="muted">No se pueden cargar los datos de hoy sin conexión.</p>
                <p className="muted">Puedes entrenar igualmente: la sesión se guarda en el móvil y se envía al volver la conexión.</p>
                <Link to="/entreno" className="button button-primary">
                  Entrenar
                </Link>
              </>
            ) : (
              <p role="alert" className="form-error">
                {state.message}
              </p>
            )}
            <button type="button" className="button" onClick={() => void load(false)}>
              Reintentar
            </button>
          </div>
        </>
      ) : null}

      {state.status === "ready" ? (
        <>
          <header className="today-head">
            <h1>{state.today.displayName.trim() === "" ? "Hola" : `Hola, ${state.today.displayName.trim()}`}</h1>
            <p className="muted">{formatLongDate(state.today.date)}</p>
            <p className="streak">
              <span className="muted">Racha</span> <strong>{weeks(state.today.streak)}</strong>
            </p>
          </header>

          <NextRoutineCard next={state.today.next} exerciseNames={exerciseNames} />

          <div className="card-grid">
            <StepsCard steps={state.today.steps} goal={state.today.stepsGoal} shortcutName={state.shortcutName} />
            <WeightCard
              date={state.today.date}
              lastWeight={state.today.lastWeight}
              weekWeightDelta={state.today.weekWeightDelta}
              onSaved={() => void load(true)}
            />
          </div>

          <CreatineCard
            key={state.today.date}
            date={state.today.date}
            taken={state.today.creatineToday}
            onChange={creatineChanged}
          />

          <WeekCard
            date={state.today.date}
            count={state.today.week.count}
            goal={state.today.week.goal}
            days={state.today.week.days}
          />
        </>
      ) : null}
    </section>
  );
}
