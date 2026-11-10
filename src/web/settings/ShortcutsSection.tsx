import { useId, useState, type FormEvent } from "react";
import { Link } from "react-router";
import type { HookKey, HookScope } from "../../shared/types";
import { ApiError, api } from "../api";
import { ChevronRightIcon } from "../components/icons";
import { LoadError } from "../components/LoadError";
import { Sheet } from "../components/Sheet";
import { formatInstantDay } from "./instants";
import { failureMessage, useLoad } from "../useLoad";
import { CopyButton } from "./CopyButton";
import { UrlRow } from "./HookUrls";
import { OneTimeSecret } from "./OneTimeSecret";
import { patchSettings } from "./settingsApi";

const SCOPES: readonly HookScope[] = ["creatine", "steps"];
const SCOPE_LABELS: Record<HookScope, string> = { creatine: "Creatina", steps: "Pasos" };

function fetchKeys(): Promise<HookKey[]> {
  return api<HookKey[]>("/api/hook-keys");
}

function scopesText(scopes: readonly HookScope[]): string {
  return scopes.map((scope) => SCOPE_LABELS[scope]).join(" y ");
}

function usageText(key: HookKey): string {
  if (key.revokedAt !== null) return `Revocada el ${formatInstantDay(key.revokedAt)}`;
  return key.lastUsedAt === null ? "Sin usar todavía" : `Último uso: ${formatInstantDay(key.lastUsedAt)}`;
}

/** Nombre exacto del Atajo de Salud: el botón "Sincronizar" de Hoy lo abre por ese nombre. */
function ShortcutNameCard({ initial }: { initial: string }) {
  const id = useId();
  const [name, setName] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaved(false);
    const trimmed = name.trim();
    if (trimmed === "") {
      setError("Escribe el nombre del Atajo.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await patchSettings({ shortcutName: trimmed });
      setName(trimmed);
      setSaved(true);
    } catch (failure) {
      setError(failureMessage(failure, "No se pudo guardar el nombre"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="card" onSubmit={(event) => void save(event)} noValidate>
      <label className="field-label" htmlFor={id}>
        Nombre del Atajo de Salud
      </label>
      <input
        id={id}
        className="input"
        type="text"
        maxLength={100}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <p className="muted">
        Tiene que coincidir letra por letra con el nombre del atajo en la app Atajos: el botón «Sincronizar» de Hoy lo abre
        por ese nombre.
      </p>
      {error ? (
        <p role="alert" className="form-error">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="notice">
          Nombre guardado.
        </p>
      ) : null}
      <button type="submit" className="button" disabled={saving}>
        Guardar nombre
      </button>
    </form>
  );
}

function KeysCard() {
  const ids = useId();
  const { state, reload } = useLoad(fetchKeys);
  const [label, setLabel] = useState("");
  const [chosen, setChosen] = useState<ReadonlySet<HookScope>>(new Set());
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // El secreto de la clave recién creada. Solo existe aquí: el servidor no lo vuelve a dar.
  const [secret, setSecret] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<HookKey | null>(null);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  function toggle(scope: HookScope) {
    setChosen((previous) => {
      const next = new Set(previous);
      if (!next.delete(scope)) next.add(scope);
      return next;
    });
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    const name = label.trim();
    if (creating || name === "" || chosen.size === 0) return;
    setCreating(true);
    setCreateError(null);
    try {
      const created = await api<{ key: string }>("/api/hook-keys", {
        method: "POST",
        body: JSON.stringify({ label: name, scopes: SCOPES.filter((scope) => chosen.has(scope)) }),
      });
      setSecret(created.key);
      setLabel("");
      setChosen(new Set());
      void reload();
    } catch (failure) {
      setCreateError(failureMessage(failure, "No se pudo crear la clave"));
    } finally {
      setCreating(false);
    }
  }

  function closeRevoke() {
    setRevoking(null);
    setRevokeError(null);
  }

  async function revoke() {
    if (revoking === null || revokeBusy) return;
    setRevokeBusy(true);
    setRevokeError(null);
    try {
      await api(`/api/hook-keys/${encodeURIComponent(revoking.id)}`, { method: "DELETE" });
      closeRevoke();
      void reload();
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 404) {
        closeRevoke();
        void reload();
      } else {
        setRevokeError(failureMessage(failure, "No se pudo revocar la clave"));
      }
    } finally {
      setRevokeBusy(false);
    }
  }

  return (
    <>
      <div className="card">
        <h3 className="card-title">Claves de atajo</h3>
        {state.status === "loading" ? <p className="muted">Cargando…</p> : null}
        {state.status === "error" ? (
          <LoadError message={state.message} offline={state.offline} onRetry={() => void reload()} />
        ) : null}
        {state.status === "ready" && state.data.length === 0 ? (
          <p className="muted">Todavía no has creado ninguna clave.</p>
        ) : null}
        {state.status === "ready" && state.data.length > 0 ? (
          <ul className="item-list">
            {state.data.map((key) => (
              <li key={key.id} className={key.revokedAt === null ? "item-row" : "item-row item-revoked"}>
                <span className="item-main">
                  <strong>{key.label}</strong>
                  <span className="muted">{`${scopesText(key.scopes)} · ${usageText(key)}`}</span>
                </span>
                {key.revokedAt === null ? (
                  <button type="button" className="button button-danger" aria-label={`Revocar ${key.label}`} onClick={() => setRevoking(key)}>
                    Revocar
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {secret ? (
        <OneTimeSecret
          title="Tu clave nueva"
          warning="Cópiala ahora: no se podrá volver a ver. La pegarás en el atajo, tras la palabra Bearer."
          doneLabel="Ya la he copiado"
          onDone={() => setSecret(null)}
        >
          <code className="secret">{secret}</code>
          <CopyButton text={secret} label="Copiar clave" />
        </OneTimeSecret>
      ) : null}

      <form className="card" onSubmit={(event) => void create(event)} noValidate>
        <h3 className="card-title">Crear una clave</h3>
        <div>
          <label className="field-label" htmlFor={`${ids}-label`}>
            Nombre de la clave
          </label>
          <input
            id={`${ids}-label`}
            className="input"
            type="text"
            maxLength={100}
            placeholder="Pegatina de la nevera"
            autoComplete="off"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </div>
        <fieldset className="check-group">
          <legend className="field-label">Permisos</legend>
          {SCOPES.map((scope) => (
            <label key={scope} className="check-row">
              <input type="checkbox" checked={chosen.has(scope)} onChange={() => toggle(scope)} />
              <span>{SCOPE_LABELS[scope]}</span>
            </label>
          ))}
        </fieldset>
        {createError ? (
          <p role="alert" className="form-error">
            {createError}
          </p>
        ) : null}
        <button type="submit" className="button button-primary" disabled={creating || label.trim() === "" || chosen.size === 0}>
          Crear clave
        </button>
      </form>

      <Sheet open={revoking !== null} title="¿Revocar esta clave?" onClose={closeRevoke}>
        <p>{`La clave «${revoking?.label ?? ""}» dejará de funcionar: los atajos que la usen recibirán un error 401.`}</p>
        {revokeError ? (
          <p role="alert" className="form-error">
            {revokeError}
          </p>
        ) : null}
        <div className="actions">
          <button type="button" className="button button-danger" disabled={revokeBusy} onClick={() => void revoke()}>
            Sí, revocar
          </button>
          <button type="button" className="button" disabled={revokeBusy} onClick={closeRevoke}>
            Cancelar
          </button>
        </div>
      </Sheet>
    </>
  );
}

/** Atajos y NFC (spec §5.7): claves con permisos, URL de los hooks, nombre del Atajo de Salud y la guía. */
export function ShortcutsSection({ shortcutName }: { shortcutName: string }) {
  const titleId = useId();
  return (
    <section className="stack" aria-labelledby={titleId}>
      <h2 id={titleId}>Atajos y NFC</h2>
      <KeysCard />
      <div className="card">
        <h3 className="card-title">Direcciones de los atajos</h3>
        <UrlRow hook="creatine" title="Creatina" />
        <UrlRow hook="steps" title="Pasos" />
      </div>
      <ShortcutNameCard initial={shortcutName} />
      <ul className="list">
        <li>
          <Link to="/ajustes/atajos" className="list-row">
            <span className="list-row-main">Guía paso a paso</span>
            <ChevronRightIcon />
          </Link>
        </li>
      </ul>
    </section>
  );
}
