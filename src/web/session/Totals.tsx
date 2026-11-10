import { formatThousands } from "../../shared/dates";
import { formatDecimal, formatMinutes } from "../format";
import type { SessionTotals } from "./finish";

export function cardioText(totals: Pick<SessionTotals, "cardioMin" | "cardioKm">): string | null {
  const parts: string[] = [];
  if (totals.cardioMin > 0) parts.push(`${formatDecimal(totals.cardioMin)} min`);
  if (totals.cardioKm > 0) parts.push(`${formatDecimal(totals.cardioKm)} km`);
  return parts.length === 0 ? null : parts.join(" · ");
}

/** Los números de una sesión: duración, volumen, series y cardio (solo si lo hubo). */
export function Totals({ totals }: { totals: SessionTotals }) {
  const cardio = cardioText(totals);
  return (
    <dl className="stat-grid">
      <div>
        <dt>Duración</dt>
        <dd>{formatMinutes(totals.durationMin)}</dd>
      </div>
      <div>
        <dt>Volumen</dt>
        <dd>{`${formatThousands(totals.volumeKg)} kg`}</dd>
      </div>
      <div>
        <dt>Series</dt>
        <dd>{totals.sets}</dd>
      </div>
      {cardio === null ? null : (
        <div>
          <dt>Cardio</dt>
          <dd>{cardio}</dd>
        </div>
      )}
    </dl>
  );
}
