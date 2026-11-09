import { describe, expect, it } from "vitest";
import { exerciseSchema } from "../../src/shared/schemas";
import { SEED_EXERCISES } from "../../src/worker/seed/exercises";

describe("seed de ejercicios", () => {
  // Una copia de seguridad incluye los ejercicios del seed: tienen que pasar el esquema al importarla.
  it("cumple exerciseSchema", () => {
    for (const seed of SEED_EXERCISES) {
      const exercise = { ...seed, mediaUrl: null, isCustom: false, archived: false };
      expect(exerciseSchema.safeParse(exercise).success, seed.id).toBe(true);
    }
  });
});
