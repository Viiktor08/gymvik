import type { NotificationType, Settings } from "../../shared/types";
import { api } from "../api";

/** Cuerpo de `PATCH /api/settings`: cualquier subconjunto; de un aviso basta con lo que cambia. */
export type SettingsPatch = Partial<Omit<Settings, "notifications">> & {
  notifications?: Partial<Record<NotificationType, Partial<Settings["notifications"][NotificationType]>>>;
};

/** Guarda un cambio de ajustes y devuelve los ajustes completos tal como quedan. */
export function patchSettings(patch: SettingsPatch): Promise<Settings> {
  return api<Settings>("/api/settings", { method: "PATCH", body: JSON.stringify(patch) });
}
