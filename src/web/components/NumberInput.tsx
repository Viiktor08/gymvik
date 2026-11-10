import { useState, type ChangeEvent, type FocusEvent, type InputHTMLAttributes } from "react";
import { parseDecimal } from "../../shared/dates";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "inputMode"> & {
  /** `null` es el campo vacío. */
  value: number | null;
  /** Recibe el número escrito, o `null` si el campo está vacío o no es un número. */
  onChange: (value: number | null) => void;
  /** Máximo de decimales; al escribir se descartan los que sobran. Por defecto, 2. */
  decimals?: number;
};

/** 57.5 → "57,5". Un valor que no es finito se muestra como campo vacío, nunca como NaN o Infinity. */
function format(value: number | null, decimals: number): string {
  if (value === null || !Number.isFinite(value)) return "";
  return String(Number(value.toFixed(decimals))).replace(".", ",");
}

/** Recorta la parte decimal a `decimals` cifras; con 0 quita también el separador. */
function limitDecimals(text: string, decimals: number): string {
  const match = /^(-?\d*)([.,])(\d*)$/.exec(text);
  if (!match) return text;
  const [, whole = "", separator = ",", fraction = ""] = match;
  if (decimals <= 0) return whole;
  return fraction.length > decimals ? `${whole}${separator}${fraction.slice(0, decimals)}` : text;
}

/**
 * Campo numérico que acepta coma o punto decimal ("57,5"). Guarda lo que se
 * está escribiendo ("57," todavía no es un número completo) y solo lo
 * reescribe cuando el valor cambia desde fuera.
 */
export function NumberInput({ value, onChange, decimals = 2, className, onBlur, ...rest }: Props) {
  const [text, setText] = useState(() => format(value, decimals));
  const [seenValue, setSeenValue] = useState(value);

  if (!Object.is(value, seenValue)) {
    setSeenValue(value);
    if (value !== parseDecimal(text)) setText(format(value, decimals));
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const next = limitDecimals(event.target.value, decimals);
    setText(next);
    onChange(parseDecimal(next));
  }

  function handleBlur(event: FocusEvent<HTMLInputElement>) {
    setText(format(parseDecimal(text), decimals));
    onBlur?.(event);
  }

  const invalid = text.trim() !== "" && parseDecimal(text) === null;

  return (
    <input
      {...rest}
      className={className ? `input ${className}` : "input"}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      aria-invalid={invalid || undefined}
      value={text}
      onChange={handleChange}
      onBlur={handleBlur}
    />
  );
}
