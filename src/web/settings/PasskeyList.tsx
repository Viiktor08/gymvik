import { useState } from "react";
import { ApiError } from "../api";
import { Sheet } from "../components/Sheet";
import { failureMessage } from "../useLoad";
import { formatInstantDay } from "./instants";
import { sessionApi } from "./sessionApi";

export type Passkey = { id: string; label: string; createdAt: string; transports: string[] };

export async function fetchPasskeys(): Promise<Passkey[]> {
  const { passkeys } = await sessionApi<{ passkeys: Passkey[] }>("/api/auth/passkeys");
  return passkeys;
}

function passkeyName(passkey: Passkey): string {
  return passkey.label === "" ? "Passkey sin nombre" : passkey.label;
}

type Props = {
  passkeys: readonly Passkey[];
  /** Se llama cuando una passkey ya no está en el servidor (la quitó esta lista u otro sitio): hay que volver a listar. */
  onRemoved: () => void;
};

/**
 * Las passkeys con su botón "Quitar" y la confirmación. Quitar una passkey cierra las sesiones de los demás
 * dispositivos (así un móvil perdido deja de entrar); la de este dispositivo se queda. La usan Ajustes y la
 * pantalla de recuperación.
 */
export function PasskeyList({ passkeys, onRemoved }: Props) {
  const [removing, setRemoving] = useState<Passkey | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setRemoving(null);
    setError(null);
  }

  async function remove() {
    if (removing === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      await sessionApi(`/api/auth/passkeys/${encodeURIComponent(removing.id)}`, { method: "DELETE" });
      close();
      onRemoved();
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 409) {
        setError("Es tu única passkey, así que no se puede quitar. Añade otra primero.");
      } else if (failure instanceof ApiError && failure.status === 404) {
        // Ya no existe (se quitó desde otro sitio): el resultado es el que se quería.
        close();
        onRemoved();
      } else {
        setError(failureMessage(failure, "No se pudo quitar la passkey"));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ul className="item-list">
        {passkeys.map((passkey) => (
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

      <Sheet open={removing !== null} title="¿Quitar esta passkey?" onClose={close}>
        <p>{`Con «${removing === null ? "" : passkeyName(removing)}» ya no podrás entrar desde ese dispositivo.`}</p>
        <p>Se cerrará la sesión en los demás dispositivos; en este seguirás dentro.</p>
        {error ? (
          <p role="alert" className="form-error">
            {error}
          </p>
        ) : null}
        <div className="actions">
          <button type="button" className="button button-danger" disabled={busy} onClick={() => void remove()}>
            Sí, quitar
          </button>
          <button type="button" className="button" disabled={busy} onClick={close}>
            Cancelar
          </button>
        </div>
      </Sheet>
    </>
  );
}
