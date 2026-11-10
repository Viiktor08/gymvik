import { useId, useState } from "react";
import { appVersion } from "../appVersion";
import { checkForUpdate } from "../pwa";

type Status = { kind: "idle" } | { kind: "checking" } | { kind: "info"; message: string } | { kind: "error"; message: string };

const MESSAGES = {
  current: "Ya tienes la última versión.",
  reloading: "Hay una versión nueva. Recargando…",
  unavailable: "Todavía no se puede comprobar. Cierra la app, ábrela de nuevo e inténtalo otra vez.",
  failed: "No se pudo comprobar si hay una versión nueva. Revisa la conexión e inténtalo de nuevo.",
} as const;

/** Versión instalada y botón para buscar una versión nueva; si la hay, la app se recarga con ella. */
export function AppSection() {
  const titleId = useId();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [reloading, setReloading] = useState(false);

  async function update() {
    if (status.kind === "checking" || reloading) return;
    setStatus({ kind: "checking" });
    try {
      const outcome = await checkForUpdate();
      if (outcome === "reloading") setReloading(true);
      setStatus({ kind: "info", message: MESSAGES[outcome] });
    } catch {
      setStatus({ kind: "error", message: MESSAGES.failed });
    }
  }

  const checking = status.kind === "checking";
  return (
    <section className="stack" aria-labelledby={titleId}>
      <h2 id={titleId}>Aplicación</h2>
      <div className="card">
        <p>
          Versión instalada: <strong>{appVersion}</strong>
        </p>
        <button type="button" className="button" disabled={checking || reloading} onClick={() => void update()}>
          {checking ? "Buscando…" : "Actualizar"}
        </button>
        {status.kind === "info" ? (
          <p role="status" className="notice">
            {status.message}
          </p>
        ) : null}
        {status.kind === "error" ? (
          <p role="alert" className="form-error">
            {status.message}
          </p>
        ) : null}
      </div>
    </section>
  );
}
