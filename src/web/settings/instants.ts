import { localDate } from "../../shared/dates";
import { formatMediumDate } from "../format";
import { deviceTimeZone } from "../historyData";

/** "2026-11-02T12:00:00.000Z" → "2 nov 2026", con el día que marca el reloj del dispositivo. Si no es un instante, "—". */
export function formatInstantDay(iso: string): string {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return "—";
  return formatMediumDate(localDate(instant, deviceTimeZone())) || "—";
}
