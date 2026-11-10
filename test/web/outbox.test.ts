import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Workout } from "../../src/shared/types";
import { openDB } from "idb";
import {
  enqueue,
  enqueueApply,
  flushOutbox,
  isQueued,
  isRejected,
  listRejected,
  onOutboxChange,
  pendingCount,
  rejectedCount,
  retryRejected,
  type OutboxItem,
  type SendResult,
} from "../../src/web/session/outbox";

function workout(id: string, extra: Partial<Workout> = {}): Workout {
  return {
    id,
    routineId: "r-1",
    startedAt: "2026-11-10T08:00:00.000Z",
    endedAt: "2026-11-10T09:00:00.000Z",
    localDate: "2026-11-10",
    notes: "",
    source: "live",
    exercises: [{ exerciseId: "e-press", sets: [{ weightKg: 60, reps: 10, rir: null, durationMin: null, distanceKm: null }] }],
    ...extra,
  };
}

/** Un `send` que apunta lo que recibe y responde con los estados que se le dan, en orden (el último se repite). */
function sender(...statuses: (number | "network")[]) {
  const sent: OutboxItem[] = [];
  const send = vi.fn(async (item: OutboxItem): Promise<SendResult> => {
    sent.push(item);
    const status = statuses[Math.min(sent.length - 1, statuses.length - 1)] ?? 200;
    if (status === "network") throw new TypeError("Failed to fetch");
    return { status };
  });
  return { send, sent };
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Una base nueva por test: fake-indexeddb conserva los datos mientras viva el proceso.
  globalThis.indexedDB = new IDBFactory();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

describe("flushOutbox", () => {
  it("con la cola vacía no envía nada y devuelve 0", async () => {
    const { send } = sender(200);

    expect(await flushOutbox(send)).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("con un 200 quita el elemento y devuelve cuántos ha enviado", async () => {
    await enqueue(workout("w-1"));
    const { send, sent } = sender(200);

    expect(await flushOutbox(send)).toBe(1);

    expect(sent).toEqual([{ kind: "workout", workout: workout("w-1") }]);
    expect(await pendingCount()).toBe(0);
  });

  it("con un error de red mantiene el elemento y lo reintenta en la siguiente pasada", async () => {
    await enqueue(workout("w-1"));

    expect(await flushOutbox(sender("network").send)).toBe(0);
    expect(await pendingCount()).toBe(1);

    const second = sender(200);
    expect(await flushOutbox(second.send)).toBe(1);
    expect(second.sent).toHaveLength(1);
    expect(await pendingCount()).toBe(0);
  });

  it.each([500, 502, 503, 401, 403, 408, 429])("con un %i mantiene el elemento", async (status) => {
    await enqueue(workout("w-1"));

    expect(await flushOutbox(sender(status).send)).toBe(0);

    expect(await pendingCount()).toBe(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([400, 404, 409, 413, 422])("con un %i no lo borra: lo aparta en 'rechazados' y lo deja dicho en la consola", async (status) => {
    await enqueue(workout("w-1"));

    expect(await flushOutbox(sender(status).send)).toBe(1);

    expect(await pendingCount()).toBe(0);
    expect(await isQueued("w-1")).toBe(false);
    expect(await rejectedCount()).toBe(1);
    expect(await isRejected("w-1")).toBe(true);
    const rejected = await listRejected();
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.status).toBe(status);
    expect(rejected[0]?.item).toEqual({ kind: "workout", workout: workout("w-1") });
    expect(Number.isNaN(Date.parse(rejected[0]?.rejectedAt ?? ""))).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain(String(status));
  });

  it("un 2xx no deja nada en la consola", async () => {
    await enqueue(workout("w-1"));

    await flushOutbox(sender(204).send);

    expect(await pendingCount()).toBe(0);
    expect(await rejectedCount()).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it("envía en orden y se detiene en el primer elemento que debe conservarse", async () => {
    await enqueue(workout("w-1"));
    await enqueue(workout("w-2"));
    await enqueue(workout("w-3"));
    const { send, sent } = sender(200, 503);

    expect(await flushOutbox(send)).toBe(1);

    expect(sent.map((item) => (item.kind === "workout" ? item.workout.id : item.workoutId))).toEqual(["w-1", "w-2"]);
    expect(await pendingCount()).toBe(2);
    expect(await isQueued("w-1")).toBe(false);
    expect(await isQueued("w-2")).toBe(true);
    expect(await isQueued("w-3")).toBe(true);
  });

  it("un 401 conserva el entreno: una sesión caducada no puede borrarlo", async () => {
    await enqueue(workout("w-1"));

    await flushOutbox(sender(401).send);
    expect(await isQueued("w-1")).toBe(true);

    // Cuando se vuelve a iniciar sesión, el mismo entreno se envía y se quita.
    expect(await flushOutbox(sender(200).send)).toBe(1);
    expect(await isQueued("w-1")).toBe(false);
  });

  it("el entreno sale antes que su 'guardar en la rutina', aunque se encolen juntos", async () => {
    await enqueue(workout("w-1"));
    await enqueueApply("w-1", [{ exerciseId: "e-press", sets: 4 }]);
    const { send, sent } = sender(200);

    expect(await flushOutbox(send)).toBe(2);

    expect(sent.map((item) => item.kind)).toEqual(["workout", "apply"]);
    expect(sent[1]).toEqual({ kind: "apply", workoutId: "w-1", exercises: [{ exerciseId: "e-press", sets: 4 }] });
  });

  it("si el entreno no sale, el 'guardar en la rutina' tampoco", async () => {
    await enqueue(workout("w-1"));
    await enqueueApply("w-1", [{ exerciseId: "e-press", sets: 4 }]);
    const { send, sent } = sender("network");

    expect(await flushOutbox(send)).toBe(0);

    expect(sent).toHaveLength(1);
    expect(await pendingCount()).toBe(2);
  });

  it("si el servidor rechaza el entreno con un 400, el 'guardar en la rutina' se intenta y también se aparta (con su 404)", async () => {
    await enqueue(workout("w-1"));
    await enqueueApply("w-1", [{ exerciseId: "e-press", sets: 4 }]);
    const { send, sent } = sender(400, 404);

    expect(await flushOutbox(send)).toBe(2);

    expect(sent).toHaveLength(2);
    expect(await pendingCount()).toBe(0);
    // Dos elementos apartados, pero un solo entreno rechazado.
    expect((await listRejected()).map((entry) => entry.item.kind)).toEqual(["workout", "apply"]);
    expect(await rejectedCount()).toBe(1);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("dos pasadas a la vez no envían dos veces el mismo elemento", async () => {
    await enqueue(workout("w-1"));
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sent: OutboxItem[] = [];
    const slow = async (item: OutboxItem): Promise<SendResult> => {
      sent.push(item);
      await gate;
      return { status: 200 };
    };

    const first = flushOutbox(slow);
    const second = flushOutbox(slow);
    release();

    expect(await first).toBe(1);
    expect(await second).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it("un elemento encolado mientras otra pasada está en marcha se envía en la pasada siguiente", async () => {
    await enqueue(workout("w-1"));
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = async (): Promise<SendResult> => {
      await gate;
      return { status: 200 };
    };
    const first = flushOutbox(slow);

    await enqueue(workout("w-2"));
    const quick = sender(200);
    const second = flushOutbox(quick.send);
    release();
    await first;

    await second;
    expect(await pendingCount()).toBe(0);
  });
});

describe("enqueue", () => {
  it("encolar dos veces el mismo entreno deja uno solo y conserva su sitio", async () => {
    await enqueue(workout("w-1"));
    await enqueue(workout("w-2"));
    await enqueue(workout("w-1", { notes: "corregido" }));

    const { send, sent } = sender(200);
    await flushOutbox(send);

    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual({ kind: "workout", workout: workout("w-1", { notes: "corregido" }) });
  });

  it("encolar dos veces el mismo 'guardar en la rutina' deja uno solo", async () => {
    await enqueue(workout("w-1"));
    await enqueueApply("w-1", [{ exerciseId: "e-press", sets: 4 }]);
    await enqueueApply("w-1", [{ exerciseId: "e-press", sets: 5 }]);

    expect(await pendingCount()).toBe(2);
    const { send, sent } = sender(200);
    await flushOutbox(send);
    expect(sent[1]).toMatchObject({ kind: "apply", exercises: [{ exerciseId: "e-press", sets: 5 }] });
  });

  it("la cola sobrevive a cerrar la app (a abrir la base de nuevo)", async () => {
    await enqueue(workout("w-1"));

    expect(await pendingCount()).toBe(1);
    expect(await isQueued("w-1")).toBe(true);
    expect(await isQueued("otro")).toBe(false);
  });
});

describe("rechazados", () => {
  async function reject(...ids: string[]) {
    for (const id of ids) await enqueue(workout(id));
    await flushOutbox(sender(400).send);
  }

  it("rejectedCount cuenta entrenos, no elementos", async () => {
    await enqueue(workout("w-1"));
    await enqueueApply("w-1", [{ exerciseId: "e-press", sets: 4 }]);
    await enqueue(workout("w-2"));
    await flushOutbox(sender(400).send);

    expect(await listRejected()).toHaveLength(3);
    expect(await rejectedCount()).toBe(2);
  });

  it("retryRejected devuelve los elementos a la cola, en su orden, y la cola los vuelve a enviar", async () => {
    await enqueue(workout("w-1"));
    await enqueueApply("w-1", [{ exerciseId: "e-press", sets: 4 }]);
    await flushOutbox(sender(400, 404).send);

    expect(await retryRejected()).toBe(2);

    expect(await rejectedCount()).toBe(0);
    expect(await pendingCount()).toBe(2);
    const { send, sent } = sender(200);
    expect(await flushOutbox(send)).toBe(2);
    expect(sent.map((item) => item.kind)).toEqual(["workout", "apply"]);
    expect(await rejectedCount()).toBe(0);
  });

  it("si el servidor lo vuelve a rechazar, vuelve a 'rechazados' y no se pierde", async () => {
    await reject("w-1");
    await retryRejected();

    await flushOutbox(sender(400).send);

    expect(await pendingCount()).toBe(0);
    expect(await isRejected("w-1")).toBe(true);
    expect((await listRejected())[0]?.item).toEqual({ kind: "workout", workout: workout("w-1") });
  });

  it("sin rechazados, retryRejected devuelve 0", async () => {
    expect(await retryRejected()).toBe(0);
    expect(await rejectedCount()).toBe(0);
    expect(await isRejected("nada")).toBe(false);
  });

  it("reintentar un entreno que ya está en la cola no lo duplica", async () => {
    await reject("w-1");
    await enqueue(workout("w-1"));

    await retryRejected();

    expect(await pendingCount()).toBe(1);
  });

  it("avisa a quien escucha cuando la cola cambia: tras un envío y tras reintentar", async () => {
    const listener = vi.fn();
    const stop = onOutboxChange(listener);
    await enqueue(workout("w-1"));

    await flushOutbox(sender(400).send);
    expect(listener).toHaveBeenCalledTimes(1);

    await retryRejected();
    expect(listener).toHaveBeenCalledTimes(2);

    stop();
    await flushOutbox(sender(200).send);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("una base de la versión anterior", () => {
  it("al abrirla conserva lo que estaba en la cola y añade 'rechazados'", async () => {
    // La versión 1 solo tenía la cola.
    const old = await openDB("gymvik-outbox", 1, {
      upgrade(db) {
        db.createObjectStore("outbox", { autoIncrement: true });
      },
    });
    await old.add("outbox", { kind: "workout", workout: workout("w-viejo") });
    old.close();

    expect(await isQueued("w-viejo")).toBe(true);
    expect(await rejectedCount()).toBe(0);
    await flushOutbox(sender(400).send);
    expect(await isRejected("w-viejo")).toBe(true);
  });
});
