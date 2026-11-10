import { useId, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "../api";
import { AuthLayout } from "../components/AuthLayout";
import { useAccessAction, useAuth } from "../auth";
import { registerPasskey } from "../webauthn";

/**
 * Recuperación: un código de un solo uso abre la sesión y, a continuación,
 * lleva directamente a registrar una passkey nueva en este dispositivo.
 */
export function Recover() {
  const inputId = useId();
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const { pending, error, run } = useAccessAction();
  const [code, setCode] = useState("");
  const [accepted, setAccepted] = useState(false);

  function submitCode(event: FormEvent) {
    event.preventDefault();
    const trimmed = code.trim();
    if (trimmed === "") return;
    void run(async () => {
      await api("/api/auth/recover", { method: "POST", body: JSON.stringify({ code: trimmed }) });
      setAccepted(true);
    });
  }

  async function createPasskey() {
    await registerPasskey();
    await refresh();
    navigate("/", { replace: true });
  }

  const errorMessage = error ? (
    <p role="alert" className="form-error">
      {error}
    </p>
  ) : null;

  if (accepted) {
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
