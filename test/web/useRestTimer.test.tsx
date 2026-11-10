import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { playBeep, unlockAudio } from "../../src/web/session/beep";
import { useRestTimer } from "../../src/web/session/useRestTimer";

const START = new Date("2026-11-10T10:00:00.000Z");

beforeEach(() => {
  // Solo el reloj: así se prueba que la cuenta atrás sale de la hora y no de contar ticks.
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(START);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useRestTimer", () => {
  it("empieza sin cuenta atrás", () => {
    const { result } = renderHook(() => useRestTimer());

    expect(result.current.remaining).toBeNull();
  });

  it("start arranca la cuenta atrás con los segundos que se le dan y baja cada segundo", () => {
    const { result } = renderHook(() => useRestTimer());

    act(() => result.current.start(90));
    expect(result.current.remaining).toBe(90);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.remaining).toBe(89);

    act(() => {
      vi.advanceTimersByTime(29_000);
    });
    expect(result.current.remaining).toBe(60);
  });

  it("al llegar a cero se apaga y avisa una sola vez", () => {
    const onFinish = vi.fn();
    const { result } = renderHook(() => useRestTimer({ onFinish }));

    act(() => result.current.start(3));
    act(() => {
      vi.advanceTimersByTime(2_900);
    });
    expect(result.current.remaining).toBe(1);
    expect(onFinish).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.remaining).toBeNull();
    expect(onFinish).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("add suma segundos a lo que queda, y no hace nada si no hay cuenta atrás", () => {
    const { result } = renderHook(() => useRestTimer());

    act(() => result.current.add(15));
    expect(result.current.remaining).toBeNull();

    act(() => result.current.start(60));
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    act(() => result.current.add(15));
    expect(result.current.remaining).toBe(65);
  });

  it("skip la apaga sin avisar", () => {
    const onFinish = vi.fn();
    const { result } = renderHook(() => useRestTimer({ onFinish }));
    act(() => result.current.start(60));

    act(() => result.current.skip());
    act(() => {
      vi.advanceTimersByTime(120_000);
    });

    expect(result.current.remaining).toBeNull();
    expect(onFinish).not.toHaveBeenCalled();
  });

  it("start con 0, negativo o algo que no es un número no arranca nada", () => {
    const { result } = renderHook(() => useRestTimer());

    act(() => result.current.start(0));
    expect(result.current.remaining).toBeNull();
    act(() => result.current.start(-5));
    expect(result.current.remaining).toBeNull();
    act(() => result.current.start(Number.NaN));
    expect(result.current.remaining).toBeNull();
  });

  it("start mientras ya corre reinicia con los segundos nuevos", () => {
    const { result } = renderHook(() => useRestTimer());
    act(() => result.current.start(90));
    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    act(() => result.current.start(60));

    expect(result.current.remaining).toBe(60);
  });

  describe("con la app en segundo plano", () => {
    it("al volver, la cuenta atrás refleja el tiempo real aunque no hayan corrido los ticks", () => {
      const { result } = renderHook(() => useRestTimer());
      act(() => result.current.start(90));

      // El móvil congela el JavaScript: el reloj avanza 40 s sin ningún tick.
      vi.setSystemTime(new Date(START.getTime() + 40_000));
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });

      expect(result.current.remaining).toBe(50);
    });

    it("si terminó mientras estaba en segundo plano, se apaga al volver pero no suena tarde", () => {
      const onFinish = vi.fn();
      const { result } = renderHook(() => useRestTimer({ onFinish }));
      act(() => result.current.start(30));

      vi.setSystemTime(new Date(START.getTime() + 120_000));
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });

      expect(result.current.remaining).toBeNull();
      expect(onFinish).not.toHaveBeenCalled();
    });
  });

  it("al desmontar deja de contar", () => {
    const onFinish = vi.fn();
    const { result, unmount } = renderHook(() => useRestTimer({ onFinish }));
    act(() => result.current.start(2));

    unmount();
    vi.advanceTimersByTime(10_000);

    expect(onFinish).not.toHaveBeenCalled();
  });
});

describe("aviso sonoro", () => {
  type FakeNode = { connect: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> };
  const created: { oscillators: FakeNode[]; resumed: number } = { oscillators: [], resumed: 0 };

  class FakeAudioContext {
    currentTime = 0;
    state = "suspended";
    destination = {};
    resume() {
      created.resumed += 1;
      this.state = "running";
      return Promise.resolve();
    }
    createOscillator() {
      const node: FakeNode & { frequency: { value: number }; type: string } = {
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        frequency: { value: 0 },
        type: "sine",
      };
      created.oscillators.push(node);
      return node;
    }
    createGain() {
      return {
        connect: vi.fn(),
        gain: { value: 1, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      };
    }
  }

  beforeEach(() => {
    created.oscillators = [];
    created.resumed = 0;
    vi.stubGlobal("AudioContext", FakeAudioContext);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("playBeep hace sonar el oscilador y lo para", () => {
    unlockAudio();
    playBeep();

    expect(created.oscillators.length).toBeGreaterThan(0);
    for (const node of created.oscillators) {
      expect(node.start).toHaveBeenCalledTimes(1);
      expect(node.stop).toHaveBeenCalledTimes(1);
    }
  });

  it("start despierta el audio (hace falta un toque del usuario en iOS)", () => {
    const { result } = renderHook(() => useRestTimer());

    act(() => result.current.start(30));

    expect(created.resumed).toBeGreaterThan(0);
  });

  it("sin Web Audio no falla", () => {
    vi.stubGlobal("AudioContext", undefined);

    expect(() => {
      unlockAudio();
      playBeep();
    }).not.toThrow();
  });
});
