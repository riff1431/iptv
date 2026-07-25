import type { Database } from "@/integrations/supabase/types";
import { slotNumbers } from "@/lib/match-slot-count";

type MatchRow = Database["public"]["Tables"]["matches"]["Row"];
type SlotRow = Database["public"]["Tables"]["match_slots"]["Row"];

/**
 * Compact strip of thumbnails representing this match's configured channel
 * slots. Renders exactly match.slot_count cells (clamped to 1..8), each
 * showing the assigned channel logo or an "S{n}" placeholder.
 */
export function SlotThumbs({ match, slots }: { match: MatchRow; slots: SlotRow[] }) {
  const bySlot = new Map(slots.map((s) => [s.slot, s]));
  return (
    <div className="flex items-center gap-1" data-testid="slot-thumbs">
      {slotNumbers(match.slot_count).map((n) => {
        const s = bySlot.get(n);
        return (
          <div
            key={n}
            data-testid="slot-thumb"
            title={s?.channel_name ?? `Slot ${n} — empty`}
            className="flex h-6 w-9 items-center justify-center overflow-hidden rounded border border-arena-border bg-black/30"
          >
            {s?.channel_logo ? (
              <img src={s.channel_logo} alt="" className="max-h-full max-w-full object-contain" />
            ) : (
              <span className="text-[9px] font-bold text-muted-foreground">S{n}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
