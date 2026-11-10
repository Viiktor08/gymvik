import { useId, useState, type FormEvent, type MouseEvent } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "../api";
import { AuthLayout } from "../components/AuthLayout";
import { useAccessAction, useAuth } from "../auth";
import { PasskeyList, fetchPasskeys } from "../settings/PasskeyList";
import { useLoad } from "../useLoad";
import { registerPasskey } from "../webauthn";

/**
 * Las passkeys que ya hay, con "Quitar": tras recuperar la cuenta por haber perdido un dispositivo, hay que
 * quitar la suya (el servidor cierra las demás sesiones al hacerlo). Si no se pueden listar, no se enseña nada:
 * no es imprescindible para entrar.
 */
function ExistingPasskeys() {
  const { state, reload } = useLoad(fetchPasskeys);
  if (state.status !== "ready" || state.data.length === 0) return null;
  return (
    <section className="stack" aria-label="Passkeys registradas">
      <h2>Passkeys registradas</h2>
      <p className="muted">Si has perdido un dispositivo, quita su passkey para que no pueda volver a entrar.</p>
      <PasskeyList passkeys={state.data} onRemoved={() => void reload()} />
    </section>
  );
}

/**
 * Recuperación: un código de un solo uso abre la sesión y, a continuación,
 * lleva directamente a registrar una passkey nueva en este dispositivo y a
 * quitar las de los dispositivos que ya no se tengan.
 */
export function Recover() {
  const inputId = useId();
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const { pending, error, run } = useAccessAction();
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"code" | "passkey" | "created">("code");

  function submitCode(event: FormEvent) {
    event.preventDefault();
    const trimmed = code.trim();
    if (trimmed === "") return;
    void run(async () => {
      await api("/api/auth/recover", { method: "POST", body: JSON.stringify({ code: trimmed }) });
      setStep("passkey");
    });
  }

  async function createPasskey() {
    await registerPasskey();
    await refresh();
    setStep("created");
  }

  /** La sesión la abrió el código, pero la app todavía no lo sabe: hay que preguntar antes de ir a Hoy. */
  async function goToday() {
    await refresh();
    navigate("/", { replace: true });
  }

  function continueWithoutPasskey(event: MouseEvent) {
    event.preventDefault();
    void goToday();
  }

  const errorMessage = error ? (
    <p role="alert" className="form-error">
      {error}
    </p>
  ) : null;

  if (step === "passkey") {
    return (
      <AuthLayout
        title="Registra una passkey nueva"
        intro="Código aceptado. Para volver a entrar sin código, crea ahora una passkey en este dispositivo."
      >
        <div className="actions">
          <button type="button" className="button button-primary" disabled={pending} onClick={() => void run(createPasskey)}>
            {pending ? "Creando…" : "Crear passkey"}
          </button>
        </div>
        {errorMessage}
        {error ? (
          <p className="aside">
            <Link to="/" onClick={continueWithoutPasskey}>
              Continuar sin passkey
            </Link>
          </p>
        ) : null}
        <ExistingPasskeys />
      </AuthLayout>
    );
  }

  if (step === "created") {
    return (
      <AuthLayout
        title="Passkey creada"
        intro="Ya puedes entrar con ella en este dispositivo. Quita las passkeys de los dispositivos que ya no tengas."
      >
        <ExistingPasskeys />
        <div className="actions">
          <button type="button" className="button button-primary" disabled={pending} onClick={() => void run(goToday)}>
            Continuar
          </button>
        </div>
        {errorMessage}
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Recuperar el acceso" intro="Escribe uno de los códigos de recuperación que guardaste. Cada código solo vale una vez.">
      <form onSubmit={submitCode}>
        <label className="field-label" htmlFor={inputId}>
          Código de recuperación
        </label>
        <input
          id={inputId}
          className="input input-code"
          type="text"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="xxxx-xxxx-xxxx-xxxx"
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
        />
        <div className="actions">
          <button type="submit" className="button button-primary" disabled={pending || code.trim() === ""}>
            {pending ? "Comprobando…" : "Continuar"}
          </button>
        </div>
        {errorMessage}
      </form>
      <p className="aside">
        <Link to="/login">Volver a entrar con passkey</Link>
      </p>
    </AuthLayout>
  );
}
