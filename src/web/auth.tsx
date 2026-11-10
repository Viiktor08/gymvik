import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, api } from "./api";
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

/**
 * Estado de acceso de la app, según `GET /api/auth/me`. Sin red no se puede
 * saber si la sesión sigue viva; se deja entrar igualmente, porque un entreno
 * en curso tiene que poder abrirse sin cobertura. Si la sesión no valía, la
 * primera petición a la API devuelve 401 y `api()` lleva a /login. Al volver
 * la red se comprueba de verdad.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  const refresh = useCallback(async () => {
    try {
      const me = await api<Me>("/api/auth/me");
      setState({ status: "ready", offline: false, ...me });
    } catch (error) {
      if (error instanceof ApiError && error.status === 0) {
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
    window.addEventListener("online", check);
    return () => window.removeEventListener("online", check);
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
