import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { NumberInput } from "../../src/web/components/NumberInput";

function setup(props: Partial<Parameters<typeof NumberInput>[0]> = {}) {
  const onChange = vi.fn();
  const view = render(<NumberInput aria-label="Peso" value={null} onChange={onChange} {...props} />);
  const input = screen.getByLabelText("Peso") as HTMLInputElement;
  return { onChange, input, ...view };
}

function type(input: HTMLInputElement, text: string) {
  fireEvent.change(input, { target: { value: text } });
}

describe("NumberInput", () => {
  it("al escribir 57,5 avisa con el número 57.5", () => {
    const { onChange, input } = setup();
    type(input, "57,5");
    expect(onChange).toHaveBeenLastCalledWith(57.5);
  });

  it("al dejarlo vacío avisa con null", () => {
    const { onChange, input } = setup({ value: 57.5 });
    type(input, "");
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("acepta también el punto decimal", () => {
    const { onChange, input } = setup();
    type(input, "57.5");
    expect(onChange).toHaveBeenLastCalledWith(57.5);
  });

  it("usa el teclado decimal de iOS", () => {
    const { input } = setup();
    expect(input.getAttribute("inputmode")).toBe("decimal");
  });

  it("muestra el valor con coma decimal", () => {
    const { input } = setup({ value: 57.5 });
    expect(input.value).toBe("57,5");
  });

  it("no pisa lo que se está escribiendo mientras todavía no es un número completo", () => {
    const { input, onChange } = setup({ value: null });
    type(input, "57,");
    expect(input.value).toBe("57,");
    expect(onChange).toHaveBeenLastCalledWith(57);
  });

  it("con el valor controlado por el padre tampoco pisa lo que se está escribiendo", () => {
    function Controlled() {
      const [value, setValue] = useState<number | null>(null);
      return <NumberInput aria-label="Peso" value={value} onChange={setValue} />;
    }
    render(<Controlled />);
    const input = screen.getByLabelText("Peso") as HTMLInputElement;
    type(input, "57,");
    expect(input.value).toBe("57,");
    type(input, "57,5");
    expect(input.value).toBe("57,5");
    type(input, "57,50");
    expect(input.value).toBe("57,50");
    fireEvent.blur(input);
    expect(input.value).toBe("57,5");
  });

  it("avisa con null si lo escrito no es un número", () => {
    const { onChange, input } = setup();
    type(input, "abc");
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("recorta los decimales que sobran según `decimals`", () => {
    const { onChange, input } = setup({ decimals: 1 });
    type(input, "57,55");
    expect(input.value).toBe("57,5");
    expect(onChange).toHaveBeenLastCalledWith(57.5);
  });

  it("con decimals=0 solo admite enteros", () => {
    const { onChange, input } = setup({ decimals: 0 });
    type(input, "10,5");
    expect(input.value).toBe("10");
    expect(onChange).toHaveBeenLastCalledWith(10);
  });

  it("sigue el valor cuando cambia desde fuera", () => {
    const { input, rerender, onChange } = setup({ value: 60 });
    expect(input.value).toBe("60");
    rerender(<NumberInput aria-label="Peso" value={62.5} onChange={onChange} />);
    expect(input.value).toBe("62,5");
    rerender(<NumberInput aria-label="Peso" value={null} onChange={onChange} />);
    expect(input.value).toBe("");
  });

  it("nunca muestra NaN ni Infinity", () => {
    const { input, rerender, onChange } = setup({ value: Number.NaN });
    expect(input.value).toBe("");
    rerender(<NumberInput aria-label="Peso" value={Number.POSITIVE_INFINITY} onChange={onChange} />);
    expect(input.value).toBe("");
  });

  it("al salir del campo deja el texto en su forma normal", () => {
    const { input } = setup({ value: null });
    type(input, "057,");
    fireEvent.blur(input);
    expect(input.value).toBe("57");
  });

  it("no cambia nada si está desactivado", () => {
    const { input } = setup({ value: 40, disabled: true });
    expect(input.disabled).toBe(true);
  });
});
