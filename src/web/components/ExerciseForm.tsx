import { useState, type FormEvent } from "react";
import type { Category, Exercise } from "../../shared/types";
import { api } from "../api";
import { CATEGORIES, CATEGORY_LABELS } from "../exerciseUtils";
import { refreshSnapshotInBackground } from "../session/sync";
import { failureMessage } from "../useLoad";

type Props = {
  /** `null` crea un ejercicio nuevo. */
  exercise: Exercise | null;
  /** Se llama con el ejercicio tal como lo devuelve el servidor. */
  onSaved: (exercise: Exercise) => void;
};

/** Formulario para crear o editar un ejercicio. Va dentro de una hoja inferior. */
export function ExerciseForm({ exercise, onSaved }: Props) {
  const [name, setName] = useState(exercise?.name ?? "");
  const [category, setCategory] = useState<Category>(exercise?.category ?? "strength");
  const [muscle, setMuscle] = useState(exercise?.muscle ?? "");
  const [description, setDescription] = useState(exercise?.description ?? "");
  const [mediaUrl, setMediaUrl] = useState(exercise?.mediaUrl ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const link = mediaUrl.trim();
    if (name.trim() === "") {
      setError("Escribe un nombre para el ejercicio.");
      return;
    }
    // La misma regla que el servidor: solo https.
    if (link !== "" && !/^https:\/\//i.test(link)) {
      setError("El enlace tiene que empezar por https://");
      return;
    }
    setSaving(true);
    setError(null);
    const body = {
      name: name.trim(),
      category,
      muscle: muscle.trim(),
      description: description.trim(),
      mediaUrl: link === "" ? null : link,
    };
    try {
      const saved =
        exercise === null
          ? await api<Exercise>("/api/exercises", { method: "POST", body: JSON.stringify(body) })
          : await api<Exercise>(`/api/exercises/${encodeURIComponent(exercise.id)}`, {
              method: "PATCH",
              body: JSON.stringify(body),
            });
      // Un ejercicio nuevo o editado tiene que estar en la copia sin conexión para poder usarlo sin cobertura.
      refreshSnapshotInBackground();
      onSaved(saved);
    } catch (failure) {
      setError(failureMessage(failure, "No se pudo guardar el ejercicio"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(event) => void save(event)} noValidate>
      <div className="field">
        <label className="field-label" htmlFor="exercise-name">
          Nombre
        </label>
        <input
          id="exercise-name"
          className="input"
          type="text"
          autoComplete="off"
          maxLength={100}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="exercise-category">
          Categoría
        </label>
        <select
          id="exercise-category"
          className="input"
          value={category}
          onChange={(event) => setCategory(event.target.value as Category)}
        >
          {CATEGORIES.map((option) => (
            <option key={option} value={option}>
              {CATEGORY_LABELS[option]}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="exercise-muscle">
          Músculo (opcional)
        </label>
        <input
          id="exercise-muscle"
          className="input"
          type="text"
          autoComplete="off"
          maxLength={100}
          value={muscle}
          onChange={(event) => setMuscle(event.target.value)}
        />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="exercise-description">
          Descripción (opcional)
        </label>
        <textarea
          id="exercise-description"
          className="input textarea"
          rows={4}
          maxLength={2000}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="exercise-media">
          Enlace de imagen o vídeo (opcional)
        </label>
        <input
          id="exercise-media"
          className="input"
          type="text"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={2048}
          placeholder="https://"
          value={mediaUrl}
          onChange={(event) => setMediaUrl(event.target.value)}
        />
      </div>
      {error ? (
        <p role="alert" className="form-error">
          {error}
        </p>
      ) : null}
      <div className="actions">
        <button type="submit" className="button button-primary" disabled={saving}>
          Guardar
        </button>
      </div>
    </form>
  );
}
