import { useCallback, useEffect, useRef, useState } from "react";
import { unlockAudio } from "./beep";

/** Si el descanso terminó hace más de esto (la app estaba en segundo plano), ya no tiene sentido avisar. */
const LATE_MS = 3000;
const TICK_MS = 250;

type Options = {
  /** Suena al llegar a cero con la app abierta (no al saltar el descanso ni al volver tarde). */
  onFinish?: () => void;
};

/**
 * Cuenta atrás del descanso entre series. Guarda el instante en que termina, no un contador: si el móvil
 * congela la página en segundo plano, al volver los segundos que quedan son los reales.
 */
export function useRestTimer(options: Options = {}): {
  remaining: number | null;
  start: (seconds: number) => void;
  skip: () => void;
  add: (seconds: number) => void;
} {
  const [remaining, setRemaining] = useState<number | null>(null);
  const endsAt = useRef<number | null>(null);
  const onFinish = useRef(options.onFinish);
  useEffect(() => {
    onFinish.current = options.onFinish;
  });

  const refresh = useCallback(() => {
    if (endsAt.current === null) return;
    const now = Date.now();
    if (now >= endsAt.current) {
      const late = now - endsAt.current;
      endsAt.current = null;
      setRemaining(null);
      if (late < LATE_MS) onFinish.current?.();
    } else {
      setRemaining(Math.ceil((endsAt.current - now) / 1000));
    }
  }, []);

  const running = remaining !== null;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(refresh, TICK_MS);
    const onVisible = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [running, refresh]);

  const start = useCallback(
    (seconds: number) => {
      if (!Number.isFinite(seconds) || seconds <= 0) return;
      unlockAudio();
      endsAt.current = Date.now() + seconds * 1000;
      refresh();
    },
    [refresh],
  );

  const skip = useCallback(() => {
    endsAt.current = null;
    setRemaining(null);
  }, []);

  const add = useCallback(
    (seconds: number) => {
      if (endsAt.current === null || !Number.isFinite(seconds)) return;
      endsAt.current += seconds * 1000;
      refresh();
    },
    [refresh],
  );

  return { remaining, start, skip, add };
}
