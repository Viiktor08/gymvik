import { useEffect, useState } from "react";

/**
 * La hora actual, refrescada cada `intervalMs` y al volver a la app. Quien la usa calcula desde la hora, no
 * cuenta ticks, así que el cronómetro sigue bien aunque el móvil congele la página en segundo plano.
 */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    const timer = setInterval(refresh, intervalMs);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [intervalMs]);
  return now;
}
