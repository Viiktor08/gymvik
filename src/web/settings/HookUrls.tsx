import { CopyButton } from "./CopyButton";

export type HookName = "creatine" | "steps";

const NAMES: Record<HookName, string> = { creatine: "creatina", steps: "pasos" };

/** Dirección completa del hook, con el sitio donde está desplegada la app. */
export function hookUrl(hook: HookName): string {
  return `${location.origin}/api/hook/${hook}`;
}

/** Una URL de un atajo en letra monoespaciada, con su botón para copiarla. */
export function UrlRow({ hook, title }: { hook: HookName; title?: string }) {
  const url = hookUrl(hook);
  return (
    <div className="url-row">
      {title ? <strong>{title}</strong> : null}
      <code className="url">{url}</code>
      <CopyButton text={url} ariaLabel={`Copiar URL de ${NAMES[hook]}`} />
    </div>
  );
}
