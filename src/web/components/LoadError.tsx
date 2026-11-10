type Props = {
  message: string;
  /** La petición ni siquiera salió: no hay red. */
  offline: boolean;
  onRetry: () => void;
};

/** El fallo de una carga: sin conexión o el mensaje del servidor, siempre con Reintentar. */
export function LoadError({ message, offline, onRetry }: Props) {
  return (
    <div className="card">
      {offline ? (
        <>
          <p role="status" className="card-title">
            {message}
          </p>
          <p className="muted">Esto no se puede cargar sin conexión.</p>
        </>
      ) : (
        <p role="alert" className="form-error">
          {message}
        </p>
      )}
      <button type="button" className="button" onClick={onRetry}>
        Reintentar
      </button>
    </div>
  );
}
