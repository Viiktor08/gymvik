import type { Category, Exercise } from "../shared/types";

/** Las categorías en el orden en que se ofrecen en los filtros. */
export const CATEGORIES: readonly Category[] = ["strength", "cardio", "core", "power", "mobility", "feet"];

export const CATEGORY_LABELS: Record<Category, string> = {
  strength: "Fuerza",
  cardio: "Cardio",
  core: "Core",
  power: "Potencia",
  mobility: "Movilidad",
  feet: "Pies",
};

/** Por nombre, con las reglas del español ("Ñu" detrás de "Nube", sin separar las tildes). */
export function sortExercises(exercises: readonly Exercise[]): Exercise[] {
  return [...exercises].sort((a, b) => a.name.localeCompare(b.name, "es"));
}

/** Minúsculas y sin tildes: "PRÉSS" y "press" son lo mismo al buscar. La ñ es otra letra y se conserva. */
function normalize(text: string): string {
  return text
    .toLocaleLowerCase("es")
    .split("ñ")
    .map((part) => part.normalize("NFD").replace(/\p{M}/gu, ""))
    .join("ñ");
}

/** Todas las palabras de la búsqueda tienen que aparecer en el nombre o en el músculo. */
export function matchesSearch(exercise: Pick<Exercise, "name" | "muscle">, query: string): boolean {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = normalize(`${exercise.name} ${exercise.muscle}`);
  return words.every((word) => haystack.includes(word));
}

const IMAGE_EXTENSION = /\.(?:jpe?g|png|webp|gif|avif)$/i;

/** Una imagen se enseña; cualquier otro enlace (un vídeo, por ejemplo) se ofrece como enlace. */
export function mediaKind(mediaUrl: string): "image" | "link" {
  try {
    // Se mira la ruta, no la dirección entera: "foto.jpg?width=300" sigue siendo una imagen.
    return IMAGE_EXTENSION.test(new URL(mediaUrl).pathname) ? "image" : "link";
  } catch {
    return "link";
  }
}
