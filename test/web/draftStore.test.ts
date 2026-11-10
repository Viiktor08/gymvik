import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import { clearDraft, hasDraft, loadDraft, saveDraft, type Draft } from "../../src/web/session/draftStore";

const DRAFT: Draft = {
  id: "w-1",
  routineId: "r-1",
  startedAt: "2026-11-10T08:00:00.000Z",
  exercises: [
    {
      exerciseId: "press-banca",
      restSeconds: 90,
      sets: [{ weightKg: 60, reps: 10, rir: null, durationMin: null, distanceKm: null, done: true }],
    },
  ],
};

beforeEach(() => {
  // Una base nueva por test: fake-indexeddb conserva los datos mientras viva el proceso.
  globalThis.indexedDB = new IDBFactory();
});

describe("draftStore", () => {
  it("sin sesión guardada, hasDraft es false y loadDraft devuelve null", async () => {
    expect(await hasDraft()).toBe(false);
    expect(await loadDraft()).toBeNull();
  });

  it("tras guardar una sesión, hasDraft es true y loadDraft la devuelve igual", async () => {
    await saveDraft(DRAFT);
    expect(await hasDraft()).toBe(true);
    expect(await loadDraft()).toEqual(DRAFT);
  });

  it("guardar otra vez sustituye la sesión, no añade una segunda", async () => {
    await saveDraft(DRAFT);
    await saveDraft({ ...DRAFT, id: "w-2" });
    expect((await loadDraft())?.id).toBe("w-2");
  });

  it("clearDraft la borra y hasDraft vuelve a false", async () => {
    await saveDraft(DRAFT);
    await clearDraft();
    expect(await hasDraft()).toBe(false);
    expect(await loadDraft()).toBeNull();
  });

  it("un clearDraft lanzado sin esperar justo después de un saveDraft gana: no queda un borrador fantasma", async () => {
    // Pasa al terminar un entreno: el último cambio todavía se está guardando cuando se borra el borrador.
    const pending = [saveDraft(DRAFT), saveDraft({ ...DRAFT, id: "w-2" }), clearDraft()];
    await Promise.all(pending);

    expect(await hasDraft()).toBe(false);
  });

  it("varios guardados seguidos sin esperar dejan el último", async () => {
    await Promise.all([saveDraft(DRAFT), saveDraft({ ...DRAFT, id: "w-2" }), saveDraft({ ...DRAFT, id: "w-3" })]);

    expect((await loadDraft())?.id).toBe("w-3");
  });
});
