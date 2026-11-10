import { useEffect } from "react";
import { Navigate, NavLink, Outlet, Route, Routes, useLocation } from "react-router";
import type { Settings as UserSettings } from "../shared/types";
import { api } from "./api";
import { AuthProvider, accessRedirect, useAuth } from "./auth";
import { SlidersIcon } from "./components/icons";
import { TabBar } from "./components/TabBar";
import { ExerciseDetail } from "./screens/ExerciseDetail";
import { History } from "./screens/History";
import { Library } from "./screens/Library";
import { Login } from "./screens/Login";
import { Progress } from "./screens/Progress";
import { Recover } from "./screens/Recover";
import { RoutineEditor } from "./screens/RoutineEditor";
import { Session } from "./screens/Session";
import { Settings } from "./screens/Settings";
import { Setup } from "./screens/Setup";
import { ShortcutsGuide } from "./screens/ShortcutsGuide";
import { Today } from "./screens/Today";
import { WorkoutDetail } from "./screens/WorkoutDetail";
import { Workouts } from "./screens/Workouts";
import { applyTheme } from "./theme";

/** Decide, con `GET /api/auth/me`, qué pantalla toca: configuración, acceso o la app. */
function AccessGate() {
  const { state, refresh } = useAuth();
  const { pathname } = useLocation();

  if (state.status === "loading") {
    return (
      <main className="splash" aria-busy="true">
        <p className="brand-large">Gymvik</p>
        <p className="muted">Cargando…</p>
      </main>
    );
  }

  if (state.status === "error") {
    return (
      <main className="access">
        <h1>No se pudo cargar</h1>
        <p role="alert" className="form-error">
          {state.message}
        </p>
        <div className="actions">
          <button type="button" className="button button-primary" onClick={() => void refresh()}>
            Reintentar
          </button>
        </div>
      </main>
    );
  }

  const target = accessRedirect(pathname, state);
  return target === null ? <Outlet /> : <Navigate to={target} replace />;
}

/** Marco de la app con sesión: Ajustes arriba a la derecha, contenido y pestañas abajo. */
function Shell() {
  // El tema de este dispositivo ya está aplicado desde el arranque; esto lo sincroniza con el guardado en la cuenta.
  useEffect(() => {
    api<UserSettings>("/api/settings")
      .then((settings) => applyTheme(settings.theme))
      .catch(() => {
        // Sin red o sin ajustes se queda el tema actual; cada pantalla trata sus propios errores.
      });
  }, []);

  return (
    <div className="shell">
      <header className="topbar">
        <span className="topbar-brand">Gymvik</span>
        <NavLink to="/ajustes" className="icon-button" aria-label="Ajustes">
          <SlidersIcon />
        </NavLink>
      </header>
      <div className="content">
        <Outlet />
      </div>
      <TabBar />
    </div>
  );
}

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route element={<AccessGate />}>
          <Route path="/setup" element={<Setup />} />
          <Route path="/login" element={<Login />} />
          <Route path="/recuperar" element={<Recover />} />
          <Route element={<Shell />}>
            <Route index element={<Today />} />
            <Route path="/entreno" element={<Workouts />} />
            <Route path="/entreno/rutina/:id" element={<RoutineEditor />} />
            <Route path="/entreno/sesion" element={<Session />} />
            <Route path="/entreno/historial" element={<History />} />
            <Route path="/entreno/historial/:id" element={<WorkoutDetail />} />
            <Route path="/entreno/biblioteca" element={<Library />} />
            <Route path="/ejercicio/:id" element={<ExerciseDetail />} />
            <Route path="/progreso" element={<Progress />} />
            <Route path="/ajustes" element={<Settings />} />
            <Route path="/ajustes/atajos" element={<ShortcutsGuide />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Route>
      </Routes>
    </AuthProvider>
  );
}
