import { Component, Suspense, lazy, type ComponentProps, type ErrorInfo, type ReactNode } from "react";
import type { ExerciseChart } from "./ExerciseChart";
import type { WeightChart } from "./WeightChart";

// recharts pesa casi 700 kB: las gráficas viajan en su propio trozo y solo se piden al abrir una pantalla
// que las dibuja, para que Hoy y el acceso no carguen con ellas.
const LoadedExerciseChart = lazy(() => import("./ExerciseChart").then((module) => ({ default: module.ExerciseChart })));
const LoadedWeightChart = lazy(() => import("./WeightChart").then((module) => ({ default: module.WeightChart })));

type BoundaryState = { failed: boolean };

/**
 * Si el trozo de la gráfica no se descarga (sin red, o la app se actualizó y ese archivo ya no existe) React
 * lanzaría el error y dejaría la pantalla en blanco. Aquí se avisa y se ofrece recargar.
 */
export class ChartBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("No se pudo cargar la gráfica", error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="card">
        <p role="alert" className="form-error">
          No se pudo cargar la gráfica.
        </p>
        <button type="button" className="button" onClick={() => location.reload()}>
          Recargar
        </button>
      </div>
    );
  }
}

function WithFallback({ children }: { children: ReactNode }) {
  return (
    <ChartBoundary>
      <Suspense
        fallback={
          <p role="status" className="muted">
            Cargando gráfica…
          </p>
        }
      >
        {children}
      </Suspense>
    </ChartBoundary>
  );
}

/** `ExerciseChart` cargada bajo demanda. */
export function LazyExerciseChart(props: ComponentProps<typeof ExerciseChart>) {
  return (
    <WithFallback>
      <LoadedExerciseChart {...props} />
    </WithFallback>
  );
}

/** `WeightChart` cargada bajo demanda. */
export function LazyWeightChart(props: ComponentProps<typeof WeightChart>) {
  return (
    <WithFallback>
      <LoadedWeightChart {...props} />
    </WithFallback>
  );
}
