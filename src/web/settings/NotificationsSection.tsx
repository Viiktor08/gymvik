import { useEffect, useId, useState } from "react";
import type { NotificationType, Settings } from "../../shared/types";
import { api } from "../api";
import { failureMessage } from "../useLoad";
import { enablePush, hasSubscription, isInstalled, outcomeMessage, pushErrorMessage, pushSupported } from "./push";
import { patchSettings } from "./settingsApi";

type Preferences = Settings["notifications"];
type Preference = Preferences[NotificationType];

const NOTICES: { type: NotificationType; name: string; hint: string }[] = [
  { type: "today", name: "Entreno de hoy", hint: "Te dice qué rutina toca si aún no has entrenado." },
  { type: "creatine", name: "Creatina", hint: "Si todavía no la has marcado hoy." },
  { type: "steps", name: "Pasos", hint: "Si no has llegado a tu objetivo de pasos." },
  { type: "streak", name: "Racha", hint: "Si te faltan entrenos para cumplir la semana." },
  { type: "weight", name: "Peso", hint: "Si llevas una semana sin apuntarlo." },
];

type TestResult = { kind: "info" | "error"; message: string };

function InstallHelp() {
  return (
    <div className="notice">
      <p>
        <strong>Primero añade Gymvik a la pantalla de inicio.</strong> En el iPhone los avisos solo funcionan con la app
        instalada (iOS 16.4 o superior).
      </p>
      <ol className="plain-steps">
        <li>Abre Gymvik en Safari.</li>
        <li>Toca el botón Compartir.</li>
        <li>Elige «Añadir a pantalla de inicio» y confirma.</li>
        <li>Abre Gymvik desde su icono nuevo y vuelve a Ajustes.</li>
      </ol>
    </div>
  );
}

/** Notificaciones (spec §5.7 y §6): activar en este dispositivo, interruptor y hora por aviso, y aviso de prueba. */
export function NotificationsSection({ initial }: { initial: Preferences }) {
  const titleId = useId();
  const [preferences, setPreferences] = useState(initial);
  const [preferenceError, setPreferenceError] = useState<string | null>(null);

  const installed = isInstalled();
  const supported = pushSupported();
  const [device, setDevice] = useState<"checking" | "on" | "off">("checking");
  const [enabling, setEnabling] = useState(false);
  const [enableError, setEnableError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  useEffect(() => {
    let current = true;
    void hasSubscription().then((on) => {
      if (current) setDevice(on ? "on" : "off");
    });
    return () => {
      current = false;
    };
  }, []);

  function enable() {
    if (enabling) return;
    setEnabling(true);
    setEnableError(null);
    void (async () => {
      try {
        // enablePush pide el permiso antes que nada: esta función se llama directamente desde el clic.
        const outcome = await enablePush();
        if (outcome === "enabled") setDevice("on");
        else setEnableError(outcomeMessage(outcome));
      } catch (failure) {
        setEnableError(pushErrorMessage(failure));
      } finally {
        setEnabling(false);
      }
    })();
  }

  function setField<F extends keyof Preference>(type: NotificationType, field: F, value: Preference[F]) {
    setPreferences((previous) => ({ ...previous, [type]: { ...previous[type], [field]: value } }));
  }

  async function change<F extends keyof Preference>(type: NotificationType, field: F, value: Preference[F]) {
    const previous = preferences[type][field];
    setField(type, field, value);
    setPreferenceError(null);
    try {
      await patchSettings({ notifications: { [type]: { [field]: value } } });
    } catch (failure) {
      setField(type, field, previous);
      setPreferenceError(failureMessage(failure, "No se pudo guardar el cambio"));
    }
  }

  async function sendTest() {
    if (testing) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api<{ sent: number; removed: number; failed: number }>("/api/push/test", { method: "POST" });
      if (result.sent > 0) {
        setTestResult({ kind: "info", message: "Aviso enviado. Debería llegarte en unos segundos." });
      } else if (result.failed > 0) {
        setTestResult({ kind: "error", message: "No se pudo entregar el aviso. Inténtalo de nuevo dentro de un rato." });
      } else if (result.removed > 0) {
        setTestResult({
          kind: "error",
          message: "La suscripción de este dispositivo había caducado y se ha quitado. Activa las notificaciones otra vez.",
        });
      } else {
        setTestResult({
          kind: "info",
          message: "Ningún dispositivo tiene las notificaciones activadas. Actívalas primero en el iPhone.",
        });
      }
    } catch (failure) {
      setTestResult({ kind: "error", message: failureMessage(failure, "No se pudo enviar el aviso de prueba") });
    } finally {
      setTesting(false);
    }
  }

  return (
    <section className="stack" aria-labelledby={titleId}>
      <h2 id={titleId}>Notificaciones</h2>
      <div className="card">
        {!installed ? <InstallHelp /> : null}
        {installed && !supported ? <p className="muted">Este navegador no permite activar las notificaciones.</p> : null}
        {installed && supported && device === "on" ? (
          <p role="status" className="notice">
            Notificaciones activadas en este dispositivo.
          </p>
        ) : null}
        {installed && supported && device === "off" ? (
          <button type="button" className="button button-primary" disabled={enabling} onClick={enable}>
            {enabling ? "Activando…" : "Activar notificaciones"}
          </button>
        ) : null}
        {enableError ? (
          <p role="alert" className="form-error">
            {enableError}
          </p>
        ) : null}
      </div>

      <div className="card">
        <ul className="item-list">
          {NOTICES.map(({ type, name, hint }) => {
            const preference = preferences[type];
            return (
              <li key={type} className="notify-row">
                <span className="item-main">
                  <strong id={`${titleId}-${type}`}>{name}</strong>
                  <span className="muted">{hint}</span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={preference.enabled}
                  aria-labelledby={`${titleId}-${type}`}
                  className="switch-button"
                  onClick={() => void change(type, "enabled", !preference.enabled)}
                >
                  <span className="switch-track" aria-hidden="true">
                    <span className="switch-thumb" />
                  </span>
                </button>
                <label className="notify-time">
                  <span aria-hidden="true">Hora</span>
                  <input
                    className="input"
                    type="time"
                    aria-label={`Hora del aviso de ${name}`}
                    value={preference.time}
                    onChange={(event) => {
                      if (event.target.value !== "") void change(type, "time", event.target.value);
                    }}
                  />
                </label>
              </li>
            );
          })}
        </ul>
        {preferenceError ? (
          <p role="alert" className="form-error">
            {preferenceError}
          </p>
        ) : null}
      </div>

      <div className="card">
        <button type="button" className="button" disabled={testing} onClick={() => void sendTest()}>
          {testing ? "Enviando…" : "Enviar aviso de prueba"}
        </button>
        {testResult?.kind === "info" ? (
          <p role="status" className="notice">
            {testResult.message}
          </p>
        ) : null}
        {testResult?.kind === "error" ? (
          <p role="alert" className="form-error">
            {testResult.message}
          </p>
        ) : null}
      </div>
    </section>
  );
}
