import { useEffect, useRef, useState } from "react";

type Props = {
  text: string;
  label?: string;
  /** Nombre accesible cuando hay varios botones "Copiar" en la pantalla. */
  ariaLabel?: string;
};

type State = "idle" | "copied" | "failed";

/** Botón que copia `text` al portapapeles y lo confirma. Si el sistema no lo permite, lo dice. */
export function CopyButton({ text, label = "Copiar", ariaLabel }: Props) {
  const [state, setState] = useState<State>("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
      timer.current = setTimeout(() => setState("idle"), 2500);
    } catch {
      // Sin permiso para el portapapeles (o sin API): el texto sigue a la vista para copiarlo a mano.
      setState("failed");
    }
  }

  return (
    <div className="copy">
      <button type="button" className="button" aria-label={ariaLabel} onClick={() => void copy()}>
        {state === "copied" ? "Copiado" : label}
      </button>
      <span className="visually-hidden" role="status">
        {state === "copied" ? "Copiado" : ""}
      </span>
      {state === "failed" ? (
        <p role="alert" className="form-error">
          No se pudo copiar. Selecciónalo y cópialo a mano.
        </p>
      ) : null}
    </div>
  );
}
