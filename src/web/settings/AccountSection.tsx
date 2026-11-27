import { useId, useState } from "react";
import { LoadError } from "../components/LoadError";
import { Sheet } from "../components/Sheet";
import { failureMessage, useLoad } from "../useLoad";
import { passkeyErrorMessage, registerPasskey } from "../webauthn";
import { CopyButton } from "./CopyButton";
import { OneTimeSecret } from "./OneTimeSecret";
import { PasskeyList, fetchPasskeys } from "./PasskeyList";
import { leaveIfSignedOut, sessionApi } from "./sessionApi";

function PasskeysCard() {
  const labelId = useId();
  const { state, reload } = useLoad(fetchPasskeys);
  const [label, setLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="card">
      <h3 className="card-title">Passkeys</h3>
      {state.status === "loading" ? <p className="muted">Cargando…</p> : null}
      {state.status === "error" ? (
        <LoadError message={state.message} offline={state.offline} onRetry={() => void reload()} />
      ) : null}
      {state.status === "ready" ? <PasskeyList passkeys={state.data} onRemoved={() => void reload()} /> : null}

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

/** Cuenta: passkeys, códigos de recuperación y cerrar sesión. */
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
