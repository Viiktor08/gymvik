import { useId, useState, type ChangeEvent } from "react";
import { formatThousands } from "../../shared/dates";
import { api } from "../api";
import { Sheet } from "../components/Sheet";
import { deviceToday } from "../historyData";
import { refreshSnapshot } from "../session/offlineCache";
import { failureMessage } from "../useLoad";

type Imported = { exercises: number; routines: number; workouts: number };

function count(n: number, one: string, many: string): string {
  return `${formatThousands(n)} ${n === 1 ? one : many}`;
}

function importedSummary({ exercises, routines, workouts }: Imported): string {
  return `Copia importada: ${count(exercises, "ejercicio", "ejercicios")}, ${count(routines, "rutina", "rutinas")} y ${count(workouts, "entreno", "entrenos")}.`;
}

type Props = {
  /** Se llama cuando la copia ya está importada: los ajustes y el resto de pantallas han podido cambiar. */
  onImported: () => void;
};

/** Datos (spec §5.7): exportar a un archivo JSON e importarlo de vuelta, sustituyendo todo tras confirmar. */
export function DataSection({ onImported }: Props) {
  const ids = useId();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ name: string; text: string } | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function exportData() {
    if (exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      const backup = await api<unknown>("/api/backup");
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `gymvik-${deviceToday()}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      // En iOS el archivo se abre aparte: la dirección tiene que seguir viva un buen rato.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (failure) {
      setExportError(failureMessage(failure, "No se pudo exportar la copia"));
    } finally {
      setExporting(false);
    }
  }

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    setReadError(null);
    setResult(null);
    if (!file) return;
    try {
      const text = await file.text();
      setPicked({ name: file.name, text });
    } catch {
      setReadError("No se pudo leer el archivo.");
    } finally {
      // Para poder elegir el mismo archivo otra vez.
      input.value = "";
    }
  }

  function closeImport() {
    setPicked(null);
    setImportError(null);
  }

  async function runImport() {
    if (picked === null || importing) return;
    setImporting(true);
    setImportError(null);
    try {
      // El archivo viaja tal cual: el servidor lo valida y, si no vale, responde 400 con el motivo.
      const response = await api<{ imported: Imported }>("/api/backup/import", { method: "POST", body: picked.text });
      closeImport();
      setResult(importedSummary(response.imported));
      // Los entrenos importados cambian la "última vez" de la copia sin conexión.
      void refreshSnapshot().catch(() => undefined);
      onImported();
    } catch (failure) {
      setImportError(failureMessage(failure, "No se pudo importar la copia"));
    } finally {
      setImporting(false);
    }
  }

  return (
    <section className="stack" aria-labelledby={`${ids}-title`}>
      <h2 id={`${ids}-title`}>Datos</h2>
      <div className="card">
        <p className="muted">
          La copia incluye ejercicios, rutinas, entrenos, peso, pasos, creatina y ajustes. No incluye passkeys, sesiones ni
          claves de atajo.
        </p>
        <button type="button" className="button" disabled={exporting} onClick={() => void exportData()}>
          Exportar JSON
        </button>
        {exportError ? (
          <p role="alert" className="form-error">
            {exportError}
          </p>
        ) : null}

        <input
          id={`${ids}-file`}
          className="visually-hidden file-input"
          type="file"
          accept="application/json,.json"
          onChange={(event) => void pick(event)}
        />
        <label className="button" htmlFor={`${ids}-file`}>
          Importar JSON
        </label>
        {readError ? (
          <p role="alert" className="form-error">
            {readError}
          </p>
        ) : null}
        {result ? (
          <p role="status" className="notice">
            {result}
          </p>
        ) : null}
      </div>

      <Sheet open={picked !== null} title="¿Importar esta copia?" onClose={closeImport}>
        <p>
          <strong>Se sustituirán todos tus datos</strong> por los de «{picked?.name}». No se puede deshacer: si dudas,
          exporta antes una copia de lo que tienes.
        </p>
        {importError ? (
          <p role="alert" className="form-error">
            {importError}
          </p>
        ) : null}
        <div className="actions">
          <button type="button" className="button button-danger" disabled={importing} onClick={() => void runImport()}>
            Sí, importar
          </button>
          <button type="button" className="button" disabled={importing} onClick={closeImport}>
            Cancelar
          </button>
        </div>
      </Sheet>
    </section>
  );
}
