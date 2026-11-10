import { useId, useState } from "react";
import type { Settings as UserSettings } from "../../shared/types";
import { api } from "../api";
import { appVersion } from "../appVersion";
import { LoadError } from "../components/LoadError";
import { AccountSection } from "../settings/AccountSection";
import { DataSection } from "../settings/DataSection";
import { GoalsSection } from "../settings/GoalsSection";
import { NotificationsSection } from "../settings/NotificationsSection";
import { PastWorkoutSection } from "../settings/PastWorkoutSection";
import { ShortcutsSection } from "../settings/ShortcutsSection";
import { ThemeSection } from "../settings/ThemeSection";
import { WeightSection } from "../settings/WeightSection";
import { applyTheme } from "../theme";
import { useLoad } from "../useLoad";

/** Versión instalada. El botón "Actualizar" lo conecta el service worker (Tarea 24). */
function AppSection() {
  const titleId = useId();
  return (
    <section className="stack" aria-labelledby={titleId}>
      <h2 id={titleId}>Aplicación</h2>
      <div className="card">
        <p>
          Versión instalada: <strong>{appVersion}</strong>
        </p>
      </div>
    </section>
  );
}

/** Ajustes (spec §5.7). Cada sección guarda lo suyo; los ajustes se piden una vez y reparten sus valores iniciales. */
export function Settings() {
  const { state, reload, setData } = useLoad(() => api<UserSettings>("/api/settings"));
  // Tras importar, las secciones que enseñan ajustes se vuelven a crear con los valores nuevos.
  const [epoch, setEpoch] = useState(0);

  async function afterImport() {
    try {
      const fresh = await api<UserSettings>("/api/settings");
      applyTheme(fresh.theme);
      setData(fresh);
      setEpoch((previous) => previous + 1);
    } catch {
      void reload();
    }
  }

  return (
    <section className="screen stack" aria-busy={state.status === "loading"}>
      <h1>Ajustes</h1>

      <AccountSection />

      {state.status === "loading" ? <p className="muted">Cargando…</p> : null}
      {state.status === "error" ? (
        <LoadError message={state.message} offline={state.offline} onRetry={() => void reload()} />
      ) : null}
      {state.status === "ready" ? (
        <>
          <ThemeSection key={`theme-${epoch}`} initial={state.data.theme} />
          <GoalsSection key={`goals-${epoch}`} initial={state.data} />
          <ShortcutsSection key={`shortcuts-${epoch}`} shortcutName={state.data.shortcutName} />
          <NotificationsSection key={`notifications-${epoch}`} initial={state.data.notifications} />
        </>
      ) : null}

      <WeightSection />
      <PastWorkoutSection />
      <AppSection />
      <DataSection onImported={() => void afterImport()} />
    </section>
  );
}
