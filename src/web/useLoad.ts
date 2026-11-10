import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./api";

export type Loadable<T> =
  | { status: "loading" }
  | { status: "error"; message: string; offline: boolean }
  | { status: "ready"; data: T };

/** El mensaje de un fallo de la API; cualquier otro fallo se sustituye por `fallback`. */
export function failureMessage(failure: unknown, fallback: string): string {
  return failure instanceof ApiError ? failure.message : fallback;
}

/**
 * Carga datos al montar (y cada vez que cambia `key`) con los tres estados que toda pantalla trata:
 * cargando, error (con `offline` si ni siquiera hubo red) y listo. Solo vale la última petición.
 */
export function useLoad<T>(fetcher: () => Promise<T>, key = "") {
  const [state, setState] = useState<Loadable<T>>({ status: "loading" });
  const latest = useRef(0);
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const reload = useCallback(async () => {
    const request = ++latest.current;
    setState({ status: "loading" });
    try {
      const data = await fetcherRef.current();
      if (request === latest.current) setState({ status: "ready", data });
    } catch (failure) {
      if (request !== latest.current) return;
      setState({
        status: "error",
        offline: failure instanceof ApiError && failure.status === 0,
        message: failureMessage(failure, "No se pudo cargar"),
      });
    }
  }, []);

  useEffect(() => {
    void reload();
    return () => {
      latest.current++;
    };
  }, [reload, key]);

  /** Sustituye los datos por otros ya conocidos (la respuesta de un cambio) y anula cualquier carga en vuelo. */
  const setData = useCallback((data: T) => {
    latest.current++;
    setState({ status: "ready", data });
  }, []);

  return { state, reload, setData };
}
