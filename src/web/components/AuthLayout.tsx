import type { ReactNode } from "react";
import { DumbbellIcon } from "./icons";

type Props = {
  title: string;
  intro?: ReactNode;
  children: ReactNode;
};

/** Marco común de Setup, Login y Recover: marca arriba y el contenido centrado. */
export function AuthLayout({ title, intro, children }: Props) {
  return (
    <main className="access">
      <div className="brand" aria-hidden="true">
        <DumbbellIcon />
        <span>Gymvik</span>
      </div>
      <h1>{title}</h1>
      {intro ? <p className="lead">{intro}</p> : null}
      {children}
    </main>
  );
}
