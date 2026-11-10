import { useEffect, useId, useRef, type ReactNode } from "react";

type Props = {
  title: string;
  warning: string;
  doneLabel: string;
  onDone: () => void;
  children: ReactNode;
};

/**
 * Un secreto que el servidor solo entrega una vez (clave de atajo, códigos de recuperación). Se queda a la vista,
 * sin cerrarse solo ni al tocar fuera, hasta que se confirma que ya está guardado.
 */
export function OneTimeSecret({ title, warning, doneLabel, onDone, children }: Props) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  // Que el secreto nuevo entre en pantalla aunque el formulario que lo creó quede lejos.
  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <div ref={ref} role="group" aria-labelledby={titleId} tabIndex={-1} className="card card-hero secret-card">
      <h3 id={titleId}>{title}</h3>
      <p>{warning}</p>
      {children}
      <button type="button" className="button button-primary" onClick={onDone}>
        {doneLabel}
      </button>
    </div>
  );
}
