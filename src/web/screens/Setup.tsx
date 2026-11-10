import { useState } from "react";
import { useSearchParams } from "react-router";
import { AuthLayout } from "../components/AuthLayout";
import { useAccessAction, useAuth } from "../auth";
import { registerFirstPasskey } from "../webauthn";

/**
 * Primer arranque (/setup?token=…): registra la primera passkey y enseña los
 * códigos de recuperación una sola vez. El token se lee de la URL cuando hace
 * falta; no se copia a ningún almacenamiento.
 */
export function Setup() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const { refresh } = useAuth();
  const { pending, error, run } = useAccessAction();
  const [codes, setCodes] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);

  async function copyCodes(list: string[]) {
    try {
      await navigator.clipboard.writeText(list.join("\n"));
      setCopied(true);
    } catch {
      // Sin permiso para el portapapeles: los códigos siguen a la vista para copiarlos a mano.
      setCopied(false);
    }
  }

  if (codes) {
    return (
      <AuthLayout
        title="Guarda tus códigos de recuperación"
        intro="Si pierdes tu passkey, cada código te deja volver a entrar una vez. Se muestran solo ahora y no se podrán ver de nuevo."
      >
        <ol className="codes">
          {codes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ol>
        <div className="actions">
          <button type="button" className="button" onClick={() => void copyCodes(codes)}>
            {copied ? "Copiados" : "Copiar códigos"}
          </button>
          <button type="button" className="button button-primary" disabled={pending} onClick={() => void run(refresh)}>
            Los he guardado
          </button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Primera configuración"
      intro="Crea la passkey que protege tus datos. Se guarda en este dispositivo y la desbloqueas con Face ID."
    >
      {token === "" ? (
        <p className="notice">
          Falta el token de configuración. Abre el enlace completo de configuración, que termina en{" "}
          <code>/setup?token=…</code>
        </p>
      ) : (
        <div className="actions">
          <button
            type="button"
            className="button button-primary"
            disabled={pending}
            onClick={() => void run(async () => setCodes(await registerFirstPasskey(token)))}
          >
            {pending ? "Creando…" : "Crear passkey"}
          </button>
        </div>
      )}
      {error ? (
        <p role="alert" className="form-error">
          {error}
        </p>
      ) : null}
    </AuthLayout>
  );
}
