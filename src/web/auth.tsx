import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, apiWithin } from "./api";
import { passkeyErrorMessage } from "./webauthn";

type Me = { authenticated: boolean; setupRequired: boolean };

export type AuthState =
  | { status: "loading" }
  | { status: "error"; message: string }
  // `offline`: no se pudo preguntar al servidor y se da la sesión por buena (ver AuthProvider).
  | ({ status: "ready"; offline: boolean } & Me);

type AuthContextValue = {
  state: AuthState;
  /** Vuelve a preguntar por la sesión (tras iniciar sesión, registrar o reintentar). */
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  return value;
}

/** Con poca señal `/me` puede no responder ni fallar: pasado esto se da por perdido y se trata como sin red. */
const ME_TIMEOUT_MS = 5000;

/**
 * Estado de acceso de la app, según `GET /api/auth/me`. Si no se puede saber si la sesión sigue viva (sin red,
 * sin respuesta en 5 s o con un error del servidor) se deja entrar igualmente, porque un entreno en curso tiene
 * que poder abrirse sin cobertura y un servidor enfermo no puede dejar la app inaccesible. Si la sesión no valía,
 * la primera petición a la API devuelve 401 y `api()` lleva a /login. Al volver la red, o a la app desde segundo
 * plano, se comprueba de verdad. Un 401 de `/me` lleva a /login; cualquier otro error del cliente se enseña.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  const refresh = useCallback(async () => {
    try {
      const me = await apiWithin<Me>("/api/auth/me", ME_TIMEOUT_MS);
      setState({ status: "ready", offline: false, ...me });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setState({ status: "ready", offline: false, authenticated: false, setupRequired: false });
      } else if (error instanceof ApiError && (error.status === 0 || error.status >= 500)) {
        setState((previous) =>
          previous.status === "ready"
            ? previous
            : { status: "ready", offline: true, authenticated: true, setupRequired: false },
        );
      } else {
        setState({ status: "error", message: error instanceof ApiError ? error.message : "Error inesperado" });
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const assumedOnline = state.status === "ready" && state.offline;
  useEffect(() => {
    if (!assumedOnline) return;
    const check = () => void refresh();
    const onVisible = () => {
      if (!document.hidden) check();
    };
    window.addEventListener("online", check);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", check);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [assumedOnline, refresh]);

  const value = useMemo(() => ({ state, refresh }), [state, refresh]);
  return <AuthContext value={value}>{children}</AuthContext>;
}

/**
 * A dónde hay que ir desde `pathname` según el estado de acceso, o `null` si
 * esa pantalla es la correcta. /setup y /recuperar siguen siendo suyas aunque
 * ya haya sesión: ahí termina el flujo (códigos por guardar, passkey nueva por
 * registrar) y es la propia pantalla la que sale al acabar.
 */
export function accessRedirect(pathname: string, state: Extract<AuthState, { status: "ready" }>): string | null {
  const { authenticated, setupRequired } = state;
  if (setupRequired) return pathname === "/setup" ? null : "/setup";
  // Ya configurada: /setup no tiene nada que hacer.
  if (pathname === "/setup") return authenticated ? "/" : "/login";
  if (authenticated) return pathname === "/login" ? "/" : null;
  return pathname === "/login" || pathname === "/recuperar" ? null : "/login";
}

/**
 * Acción asíncrona de una pantalla de acceso (tocar un botón que habla con la
 * API o con la passkey): marca `pending` mientras dura y deja el fallo, ya en
 * español, en `error`.
 */
export function useAccessAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (action: () => Promise<void>) => {
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(passkeyErrorMessage(failure));
    } finally {
      setPending(false);
    }
  }, []);

  return { pending, error, run };
}
