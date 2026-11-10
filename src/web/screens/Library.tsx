import { useState } from "react";
import { Link, useNavigate } from "react-router";
import type { Exercise } from "../../shared/types";
import { ExerciseForm } from "../components/ExerciseForm";
import { ExercisePicker } from "../components/ExercisePicker";
import { ChevronLeftIcon, PlusIcon } from "../components/icons";
import { Sheet } from "../components/Sheet";

/** Biblioteca de ejercicios (spec §5.5): buscador, filtros por categoría y alta de ejercicios propios. */
export function Library() {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  return (
    <section className="screen stack">
      <Link to="/entreno" className="back-link">
        <ChevronLeftIcon />
        Entreno
      </Link>
      <h1>Biblioteca</h1>
      <button type="button" className="button button-primary" onClick={() => setCreating(true)}>
        <PlusIcon />
        Nuevo ejercicio
      </button>

      <ExercisePicker onPick={(exercise) => navigate(`/ejercicio/${encodeURIComponent(exercise.id)}`)} />

      {/* Se desmonta al cerrar: lo escrito a medias no vuelve la próxima vez. */}
      <Sheet open={creating} title="Nuevo ejercicio" onClose={() => setCreating(false)}>
        <ExerciseForm exercise={null} onSaved={(created: Exercise) => navigate(`/ejercicio/${encodeURIComponent(created.id)}`)} />
      </Sheet>
    </section>
  );
}
