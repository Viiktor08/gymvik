import { useId, useState } from "react";
import { ApiError } from "../api";
import { LoadError } from "../components/LoadError";
import { Sheet } from "../components/Sheet";
import { failureMessage, useLoad } from "../useLoad";
import { passkeyErrorMessage, registerPasskey } from "../webauthn";
import { CopyButton } from "./CopyButton";
import { formatInstantDay } from "./instants";
import { OneTimeSecret } from "./OneTimeSecret";
import { leaveIfSignedOut, sessionApi } from "./sessionApi";

type Passkey = { id: string; label: string; createdAt: string; transports: string[] };

async function fetchPasskeys(): Promise<Passkey[]> {
  const { passkeys } = await sessionApi<{ passkeys: Passkey[] }>("/api/auth/passkeys");
  return passkeys;
}

function passkeyName(passkey: Passkey): string {
  return passkey.label === "" ? "Passkey sin nombre" : passkey.label;
}

function PasskeysCard() {
  const labelId = useId();
  const { state, reload } = useLoad(fetchPasskeys);
  const [label, setLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Passkey | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  async function add() {
    if (adding) return;
    setAdding(true);
    setNotice(null);
    setError(null);
    try {
      const name = label.trim();
      await registerPasskey(name === "" ? undefined : name);
      setLabel("");
      setNotice("Passkey añadida.");
      void reload();
    } catch (failure) {
      leaveIfSignedOut(failure);
      setError(passkeyErrorMessage(failure));
    } finally {
      setAdding(false);
    }
  }

  function closeRemove() {
    setRemoving(null);
    setRemoveError(null);
  }

  async function remove() {
    if (removing === null || removeBusy) return;
    setRemoveBusy(true);
    setRemoveError(null);
    try {
      await sessionApi(`/api/auth/passkeys/${encodeURIComponent(removing.id)}`, { method: "DELETE" });
      closeRemove();
      void reload();
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 409) {
        setRemoveError("Es tu única passkey, así que no se puede quitar. Añade otra primero.");
      } else if (failure instanceof ApiError && failure.status === 404) {
        // Ya no existe (se quitó desde otro sitio): el resultado es el que se quería.
        closeRemove();
        void reload();
      } else {
        setRemoveError(failureMessage(failure, "No se pudo quitar la passkey"));
      }
    } finally {
      setRemoveBusy(false);
    }
  }

  return (
    <div className="card">
      <h3 className="card-title">Passkeys</h3>
      {state.status === "loading" ? <p className="muted">Cargando…</p> : null}
      {state.status === "error" ? (
        <LoadError message={state.message} offline={state.offline} onRetry={() => void reload()} />
      ) : null}
      {state.status === "ready" ? (
        <ul className="item-list">
          {state.data.map((passkey) => (
            <li key={passkey.id} className="item-row">
              <span className="item-main">
                <strong>{passkeyName(passkey)}</strong>
                <span className="muted">{`Añadida el ${formatInstantDay(passkey.createdAt)}`}</span>
              </span>
              <button
                type="button"
                className="button"
                aria-label={`Quitar passkey ${passkey.label === "" ? "sin nombre" : passkey.label}`}
                onClick={() => setRemoving(passkey)}
              >
                Quitar
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div>
        <label className="field-label" htmlFor={labelId}>
          Nombre del dispositivo (opcional)
        </label>
        <input
          id={labelId}
          className="input"
          type="text"
          maxLength={60}
          placeholder="iPhone"
          autoComplete="off"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
      </div>
      <button type="button" className="button" disabled={adding} onClick={() => void add()}>
        {adding ? "Creando…" : "Añadir passkey de este dispositivo"}
      </button>
      {notice ? (
        <p role="status" className="notice">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="form-error">
          {error}
        </p>
      ) : null}

      <Sheet open={removing !== null} title="¿Quitar esta passkey?" onClose={closeRemove}>
        <p>{`Con «${removing === null ? "" : passkeyName(removing)}» ya no podrás entrar desde ese dispositivo.`}</p>
        {removeError ? (
          <p role="alert" className="form-error">
            {removeError}
          </p>
        ) : null}
        <div className="actions">
          <button type="button" className="button button-danger" disabled={removeBusy} onClick={() => void remove()}>
            Sí, quitar
          </button>
          <button type="button" className="button" disabled={removeBusy} onClick={closeRemove}>
            Cancelar
          </button>
        </div>
      </Sheet>
    </div>
  );
}

function RecoveryCodesCard() {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);

  function close() {
    setConfirming(false);
    setError(null);
  }

  async function generate() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { recoveryCodes } = await sessionApi<{ recoveryCodes: string[] }>("/api/auth/recovery-codes", { method: "POST" });
      setCodes(recoveryCodes);
      setConfirming(false);
    } catch (failure) {
      setError(failureMessage(failure, "No se pudieron generar los códigos"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="card">
        <h3 className="card-title">Códigos de recuperación</h3>
        <p className="muted">
          Si pierdes el acceso a tus passkeys, cada código te deja volver a entrar una vez. Si generas códigos nuevos, los
          anteriores dejan de valer.
        </p>
        <button type="button" className="button" onClick={() => setConfirming(true)}>
          Generar códigos nuevos
        </button>
      </div>

      {codes ? (
        <OneTimeSecret
          title="Tus códigos nuevos"
          warning="Guárdalos ahora: no se podrán volver a ver. Los códigos anteriores ya no valen."
          doneLabel="Los he guardado"
          onDone={() => setCodes(null)}
        >
          <ol className="codes">
            {codes.map((code) => (
              <li key={code}>{code}</li>
            ))}
          </ol>
          <CopyButton text={codes.join("\n")} label="Copiar códigos" />
        </OneTimeSecret>
      ) : null}

      <Sheet open={confirming} title="¿Generar códigos nuevos?" onClose={close}>
        <p>Los códigos que tienes ahora dejarán de funcionar, estén usados o no.</p>
        {error ? (
          <p role="alert" className="form-error">
            {error}
          </p>
        ) : null}
        <div className="actions">
          <button type="button" className="button button-primary" disabled={busy} onClick={() => void generate()}>
            Sí, generar
          </button>
          <button type="button" className="button" disabled={busy} onClick={close}>
            Cancelar
          </button>
        </div>
      </Sheet>
    </>
  );
}

function SignOutCard() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await sessionApi("/api/auth/logout", { method: "POST" });
      location.assign("/login");
    } catch (failure) {
      setError(failureMessage(failure, "No se pudo cerrar la sesión"));
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <button type="button" className="button" disabled={busy} onClick={() => void signOut()}>
        Cerrar sesión
      </button>
      {error ? (
        <p role="alert" className="form-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Cuenta (spec §5.7): passkeys, códigos de recuperación y cerrar sesión. */
export function AccountSection() {
  const titleId = useId();
  return (
    <section className="stack" aria-labelledby={titleId}>
      <h2 id={titleId}>Cuenta</h2>
      <PasskeysCard />
      <RecoveryCodesCard />
      <SignOutCard />
    </section>
  );
}
