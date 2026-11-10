import { useMemo, useState } from "react";
import type { Category, Exercise } from "../../shared/types";
import { CATEGORIES, CATEGORY_LABELS, matchesSearch, sortExercises } from "../exerciseUtils";
import { LOAD_TIMEOUT_MS, loadExercises } from "../session/offlineData";
import { useLoad } from "../useLoad";
import { LoadError } from "./LoadError";

type Props = {
  /** Se llama con el ejercicio que se toca. El selector no se cierra solo: lo decide quien lo usa. */
  onPick: (exercise: Exercise) => void;
};

type CategoryFilter = Category | "all";

/**
 * Buscador y filtros por categoría sobre la biblioteca. No ofrece los ejercicios archivados. Sin conexión, o con
 * una señal que no responde en `LOAD_TIMEOUT_MS`, usa la copia guardada en el móvil, para poder añadir ejercicios
 * a un entreno en el gimnasio sin cobertura (con poca señal una petición puede no fallar nunca).
 */
export function ExercisePicker({ onPick }: Props) {
  const { state, reload } = useLoad(async () => sortExercises((await loadExercises({ archived: false, timeoutMs: LOAD_TIMEOUT_MS })).data));
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");

  const visible = useMemo(
    () =>
      state.status === "ready"
        ? state.data.filter((exercise) => (category === "all" || exercise.category === category) && matchesSearch(exercise, query))
        : [],
    [state, category, query],
  );

  if (state.status === "loading") return <p className="muted">Cargando ejercicios…</p>;
  if (state.status === "error") return <LoadError message={state.message} offline={state.offline} onRetry={() => void reload()} />;

  return (
    <div className="picker">
      <input
        className="input"
        type="search"
        aria-label="Buscar ejercicio"
        placeholder="Buscar ejercicio"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="chips" role="group" aria-label="Categoría">
        {(["all", ...CATEGORIES] as const).map((option) => (
          <button
            key={option}
            type="button"
            className="chip"
            aria-pressed={category === option}
            onClick={() => setCategory(option)}
          >
            {option === "all" ? "Todos" : CATEGORY_LABELS[option]}
          </button>
        ))}
      </div>
      {visible.length === 0 ? (
        <p className="muted">
          {state.data.length === 0 ? "Todavía no hay ejercicios en la biblioteca." : "Ningún ejercicio coincide con la búsqueda."}
        </p>
      ) : (
        <ul className="list">
          {visible.map((exercise) => (
            <li key={exercise.id}>
              <button type="button" className="list-row" onClick={() => onPick(exercise)}>
                <span className="list-row-main">{exercise.name}</span>
                <span className="muted">{exercise.muscle === "" ? CATEGORY_LABELS[exercise.category] : exercise.muscle}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
