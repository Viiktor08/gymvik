import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatLast } from "../../shared/prefill";
import { hasStructuralChanges, NEW_REST_SECONDS } from "../../shared/routineDiff";
import type { Exercise } from "../../shared/types";
import { ExercisePicker } from "../components/ExercisePicker";
import { MoreIcon, PlusIcon } from "../components/icons";
import { Sheet } from "../components/Sheet";
import { formatClock } from "../format";
import {
  addSet,
  appendExercise,
  moveExercise,
  newExerciseSets,
  removeExercise,
  removeLastSet,
  replaceExercise,
  setField,
  toggleDone,
  type SetField,
} from "./draftOps";
import { clearDraft, saveDraft, type Draft } from "./draftStore";
import { ExerciseCard } from "./ExerciseCard";
import { ExerciseMenu } from "./ExerciseMenu";
import { buildWorkout, countDoneSets, groupRecords, sessionTotals, structureOf } from "./finish";
import { FinishSheet } from "./FinishSheet";
import { refreshSnapshot } from "./offlineCache";
import { loadLast } from "./offlineData";
import { enqueue, enqueueApply, isQueued } from "./outbox";
import { playBeep } from "./beep";
import { RestBar } from "./RestBar";
import type { Finished } from "./SessionSummary";
import type { SessionContext } from "./startSession";
import { syncOutbox, takeWorkoutResult } from "./sync";
import { useNow } from "./useNow";
import { useRestTimer } from "./useRestTimer";

type Props = {
  initial: Draft;
  context: SessionContext;
  onFinished: (finished: Finished) => void;
  onDiscarded: () => void;
};

type Panel = "none" | "finish" | "empty" | "options" | "discard";
type PickerState = { mode: "add" } | { mode: "swap"; index: number } | null;

/** Al añadir o cambiar un ejercicio, lo que tarde en saberse su última vez no debe dejar la pantalla esperando. */
const LAST_TIMEOUT_MS = 3000;

function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** Claves estables de las tarjetas: el id del ejercicio y su aparición (puede repetirse en una sesión). */
function cardKeys(draft: Draft): string[] {
  const seen = new Map<string, number>();
  return draft.exercises.map((exercise) => {
    const n = (seen.get(exercise.exerciseId) ?? 0) + 1;
    seen.set(exercise.exerciseId, n);
    return `${exercise.exerciseId}#${n}`;
  });
}

/**
 * La sesión en curso (spec §5.3). El borrador se guarda en el móvil con cada cambio; al terminar se encola, se
 * intenta enviar y se enseña el resumen. Nada de lo que hay aquí necesita conexión.
 */
export function LiveSession({ initial, context, onFinished, onDiscarded }: Props) {
  const [draft, setDraft] = useState(initial);
  const draftRef = useRef(initial);
  const [saveFailed, setSaveFailed] = useState(false);
  const [exercises, setExercises] = useState(context.exercises);
  const [lasts, setLasts] = useState(context.lasts);
  const [panel, setPanel] = useState<Panel>("none");
  const [menu, setMenu] = useState<number | null>(null);
  const [picker, setPicker] = useState<PickerState>(null);
  const [adding, setAdding] = useState(false);
  const [finishAt, setFinishAt] = useState(() => new Date());
  const [notes, setNotes] = useState("");
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);

  const rest = useRestTimer({ onFinish: playBeep });
  const now = useNow(1000);

  const catalog = useMemo(() => new Map(exercises.map((exercise) => [exercise.id, exercise])), [exercises]);
  const routine = draft.routineId === null ? null : (context.routines.find((candidate) => candidate.id === draft.routineId) ?? null);

  /** Aplica un cambio al borrador y lo guarda en el móvil. Solo se llama desde manejadores de eventos. */
  const change = useCallback((apply: (current: Draft) => Draft) => {
    const next = apply(draftRef.current);
    if (next === draftRef.current) return;
    draftRef.current = next;
    setDraft(next);
    saveDraft(next).then(
      () => setSaveFailed(false),
      () => setSaveFailed(true),
    );
  }, []);

  // La sesión recién empezada también se guarda, aunque aún no se haya tocado nada.
  useEffect(() => {
    saveDraft(initial).catch(() => setSaveFailed(true));
  }, [initial]);

  function toggle(exercise: number, set: number) {
    const target = draftRef.current.exercises[exercise];
    const wasDone = target?.sets[set]?.done ?? true;
    change((current) => toggleDone(current, exercise, set));
    // Marcar arranca el descanso del ejercicio; desmarcar no.
    if (!wasDone && target) rest.start(target.restSeconds);
  }

  async function lastFor(exercise: Exercise) {
    const { sets } = await loadLast(exercise.id, { timeoutMs: LAST_TIMEOUT_MS });
    setExercises((list) => (list.some((known) => known.id === exercise.id) ? list : [...list, exercise]));
    setLasts((known) => ({ ...known, [exercise.id]: sets }));
    return sets;
  }

  async function pick(chosen: Exercise) {
    const state = picker;
    setPicker(null);
    setAdding(true);
    try {
      const last = await lastFor(chosen);
      if (state?.mode === "swap") {
        const rows = draftRef.current.exercises[state.index]?.sets.length ?? 3;
        change((current) => replaceExercise(current, state.index, chosen.id, newExerciseSets(chosen.category, last, rows)));
      } else {
        change((current) =>
          appendExercise(current, { exerciseId: chosen.id, restSeconds: NEW_REST_SECONDS, sets: newExerciseSets(chosen.category, last) }),
        );
      }
    } finally {
      setAdding(false);
    }
  }

  function startFinish() {
    if (countDoneSets(draftRef.current) === 0) {
      setPanel("empty");
      return;
    }
    // El entreno termina cuando se toca Terminar, no cuando se acaban de escribir las notas.
    setFinishAt(new Date());
    setFinishError(null);
    setPanel("finish");
  }

  async function finish(saveToRoutine: boolean) {
    if (finishing) return;
    setFinishing(true);
    setFinishError(null);
    try {
      const current = draftRef.current;
      const workout = buildWorkout(current, { endedAt: finishAt, notes: notes.trim(), timeZone: deviceTimeZone() });
      // Primero a la cola y después se borra el borrador: si la app muere entre medias, el entreno no se pierde
      // (y reenviarlo es idempotente).
      await enqueue(workout);
      if (saveToRoutine && routine) await enqueueApply(workout.id, structureOf(current));
      await clearDraft();
      rest.skip();

      let sent = 0;
      try {
        sent = await syncOutbox();
      } catch {
        // Sin red o sin sesión: se queda en la cola.
      }
      const result = takeWorkoutResult(workout.id);
      const pending = await isQueued(workout.id).catch(() => true);
      // Lo que se acaba de enviar cambia la "última vez" de la copia sin conexión.
      if (sent > 0) void refreshSnapshot().catch(() => undefined);

      const names = new Map(exercises.map((exercise) => [exercise.id, exercise.name]));
      onFinished({
        routineName: routine?.name ?? null,
        totals: sessionTotals(workout, catalog),
        notes: workout.notes,
        records: result ? groupRecords(result.newRecords, names) : null,
        pending,
      });
    } catch {
      setFinishError("No se pudo guardar el entreno en este móvil. Inténtalo de nuevo.");
      setFinishing(false);
    }
  }

  async function discard() {
    try {
      await clearDraft();
    } catch {
      // Si no se pudo borrar, el aviso de "entreno en curso" seguirá en Hoy; se puede descartar de nuevo.
    }
    rest.skip();
    onDiscarded();
  }

  const keys = cardKeys(draft);
  const elapsed = Math.max(0, Math.floor((now - Date.parse(draft.startedAt)) / 1000));
  const structureChanged = routine !== null && hasStructuralChanges(routine, draft.exercises);
  const menuExercise = menu === null ? undefined : draft.exercises[menu];

  return (
    <section className="screen session">
      <header className="session-head">
        <div className="session-head-title">
          <h1>{routine?.name ?? "Entreno libre"}</h1>
          <p className="session-clock" role="timer" aria-label="Tiempo de entreno">
            {formatClock(elapsed)}
          </p>
        </div>
        <div className="session-head-actions">
          <button type="button" className="icon-button" aria-label="Más opciones del entreno" onClick={() => setPanel("options")}>
            <MoreIcon />
          </button>
          <button type="button" className="button button-primary" disabled={finishing} onClick={startFinish}>
            Terminar
          </button>
        </div>
      </header>

      {context.fromCache ? (
        <p role="status" className="notice">
          Sin conexión: se usan las rutinas y la última vez guardadas en este móvil.
        </p>
      ) : null}
      {saveFailed ? (
        <p role="alert" className="form-error">
          No se está guardando el entreno en este móvil. Si cierras la app, se perderá.
        </p>
      ) : null}

      {draft.exercises.length === 0 ? <p className="muted">Todavía no hay ejercicios. Añade el primero.</p> : null}
      <div className="session-cards">
        {draft.exercises.map((exercise, index) => {
          const info = catalog.get(exercise.exerciseId);
          const category = info?.category ?? "strength";
          const last = lasts[exercise.exerciseId];
          return (
            <ExerciseCard
              key={keys[index]}
              exercise={exercise}
              name={info?.name ?? "Ejercicio"}
              category={category}
              lastText={last ? formatLast(last, category) : ""}
              onField={(set, field: SetField, value) => change((current) => setField(current, index, set, field, value))}
              onToggle={(set) => toggle(index, set)}
              onMenu={() => setMenu(index)}
            />
          );
        })}
      </div>

      <button type="button" className="button session-add" disabled={adding} onClick={() => setPicker({ mode: "add" })}>
        <PlusIcon />
        {adding ? "Añadiendo…" : "Añadir ejercicio"}
      </button>

      {rest.remaining === null ? null : <RestBar remaining={rest.remaining} onAdd={() => rest.add(15)} onSkip={rest.skip} />}

      <ExerciseMenu
        title={catalog.get(menuExercise?.exerciseId ?? "")?.name ?? "Ejercicio"}
        position={menu === null || !menuExercise ? null : { index: menu, count: draft.exercises.length, sets: menuExercise.sets.length }}
        onAddSet={() => menu !== null && change((current) => addSet(current, menu))}
        onRemoveSet={() => menu !== null && change((current) => removeLastSet(current, menu))}
        onSwap={() => {
          if (menu === null) return;
          setPicker({ mode: "swap", index: menu });
          setMenu(null);
        }}
        onMove={(by) => {
          if (menu === null) return;
          change((current) => moveExercise(current, menu, by));
          setMenu(menu + by);
        }}
        onRemove={() => {
          if (menu === null) return;
          change((current) => removeExercise(current, menu));
          setMenu(null);
        }}
        onClose={() => setMenu(null)}
      />

      <Sheet open={picker !== null} title={picker?.mode === "swap" ? "Cambiar ejercicio" : "Añadir ejercicio"} onClose={() => setPicker(null)}>
        <ExercisePicker onPick={(chosen) => void pick(chosen)} />
      </Sheet>

      {panel === "finish" ? (
        <FinishSheet
          open
          totals={sessionTotals(buildWorkout(draft, { endedAt: finishAt, notes: "", timeZone: deviceTimeZone() }), catalog)}
          notes={notes}
          onNotes={setNotes}
          structureChanged={structureChanged}
          busy={finishing}
          error={finishError}
          onFinish={(saveToRoutine) => void finish(saveToRoutine)}
          onClose={() => setPanel("none")}
        />
      ) : null}

      <Sheet open={panel === "empty"} title="Aún no hay series hechas" onClose={() => setPanel("none")}>
        <div className="stack">
          <p>Todavía no has marcado ninguna serie con ✓, así que no hay nada que guardar. Marca las que hayas hecho o descarta el entreno.</p>
          <div className="actions">
            <button type="button" className="button button-primary" onClick={() => setPanel("none")}>
              Seguir entrenando
            </button>
            <button type="button" className="button button-danger" onClick={() => setPanel("discard")}>
              Descartar entreno
            </button>
          </div>
        </div>
      </Sheet>

      <Sheet open={panel === "options"} title="Entreno en curso" onClose={() => setPanel("none")}>
        <ul className="list">
          <li>
            <button type="button" className="list-row session-danger" onClick={() => setPanel("discard")}>
              <span className="list-row-main">Descartar entreno</span>
            </button>
          </li>
        </ul>
      </Sheet>

      <Sheet open={panel === "discard"} title="¿Descartar este entreno?" onClose={() => setPanel("none")}>
        <div className="stack">
          <p>Se perderán las series de este entreno y no se podrá recuperar.</p>
          <div className="actions">
            <button type="button" className="button button-danger" onClick={() => void discard()}>
              Sí, descartar
            </button>
            <button type="button" className="button" onClick={() => setPanel("none")}>
              Cancelar
            </button>
          </div>
        </div>
      </Sheet>
    </section>
  );
}
