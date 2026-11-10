import { Link } from "react-router";
import { AuthLayout } from "../components/AuthLayout";
import { useAccessAction, useAuth } from "../auth";
import { signInWithPasskey } from "../webauthn";

export function Login() {
  const { refresh } = useAuth();
  const { pending, error, run } = useAccessAction();

  // Al refrescar la sesión, la puerta de acceso (App) lleva a Hoy.
  async function signIn() {
    await signInWithPasskey();
    await refresh();
  }

  return (
    <AuthLayout title="Entrar" intro="Usa la passkey de este dispositivo: Face ID, Touch ID o su código.">
      <div className="actions">
        <button type="button" className="button button-primary" disabled={pending} onClick={() => void run(signIn)}>
          {pending ? "Comprobando…" : "Entrar con passkey"}
        </button>
      </div>
      {error ? (
        <p role="alert" className="form-error">
          {error}
        </p>
      ) : null}
      <p className="aside">
        <Link to="/recuperar">Usar un código de recuperación</Link>
      </p>
    </AuthLayout>
  );
}
