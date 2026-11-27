import type { ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { DumbbellIcon, TodayIcon, TrendIcon } from "./icons";

type Tab = {
  to: string;
  label: string;
  icon: ReactNode;
  isActive: (path: string) => boolean;
};

const section = (path: string, root: string) => path === root || path.startsWith(`${root}/`);

const TABS: readonly Tab[] = [
  { to: "/", label: "Hoy", icon: <TodayIcon />, isActive: (path) => path === "/" },
  {
    to: "/entreno",
    label: "Entreno",
    icon: <DumbbellIcon />,
    // La ficha de un ejercicio se abre desde la biblioteca, que cuelga de Entreno.
    isActive: (path) => section(path, "/entreno") || section(path, "/ejercicio"),
  },
  { to: "/progreso", label: "Progreso", icon: <TrendIcon />, isActive: (path) => section(path, "/progreso") },
];

/** Navegación inferior: Hoy · Entreno · Progreso. */
export function TabBar() {
  const { pathname } = useLocation();
  return (
    <nav className="tabbar" aria-label="Principal">
      {TABS.map((tab) => {
        const active = tab.isActive(pathname);
        return (
          <Link
            key={tab.to}
            to={tab.to}
            className={active ? "tab tab-active" : "tab"}
            aria-current={active ? "page" : undefined}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
