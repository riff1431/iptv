import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { HlsTile } from "./HlsTile";
import { useTvsRealtime } from "@/hooks/useTvsRealtime";

type TvRow = Database["public"]["Tables"]["tvs"]["Row"];

export type LoungeGridProps = {
  loungeId: string;
  activeSlot: number | null;
  onActiveSlotChange: (slot: number) => void;
  /** Pause all tile streams (ad break overlay is active). */
  paused?: boolean;
};

/**
 * 4-TV player grid backed by the real `tvs` rows for a given lounge.
 * Live scores/matchups stream in via postgres_changes on `tvs`.
 * Falls back to placeholder tiles when the lounge has fewer than 4 TVs
 * configured so the frame is always 2x2. `activeSlot` is controlled by
 * the parent so the chat panel can stay in sync with the audio-active TV.
 */
export function LoungeGrid({ loungeId, activeSlot, onActiveSlotChange, paused = false }: LoungeGridProps) {
  const [tvs, setTvs] = useState<TvRow[] | null>(null);

  const refetch = useCallback(async () => {
    const { data } = await supabase
      .from("tvs")
      .select(
        "id, lounge_id, slot, display_name, provider_name, connection_type, selected_channel_id, selected_channel_name, selected_channel_logo, enabled, status, last_status_message, last_checked_at, created_at, updated_at, sport, matchup, home_label, away_label, home_score, away_score, period_label, clock_label, accent_home, accent_away",
      )
      .eq("lounge_id", loungeId)
      .eq("enabled", true)
      .order("slot", { ascending: true });
    const rows = (data ?? []) as unknown as TvRow[];
    setTvs(rows);
    return rows;
  }, [loungeId]);

  useEffect(() => {
    let mounted = true;
    void refetch().then((rows) => {
      if (!mounted) return;
      if (activeSlot == null) {
        const firstOnline = rows.find((t) => t.enabled && t.status === "online");
        const initial = firstOnline?.slot ?? rows[0]?.slot;
        if (initial != null) onActiveSlotChange(initial);
      }
    });
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loungeId]);

  // Live score/matchup edits stream in and refresh every open lounge tab.
  useTvsRealtime(loungeId, refetch);

  const slots = [1, 2, 3, 4];

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {slots.map((slot) => {
        const tv = tvs?.find((t) => t.slot === slot);
        if (!tv) {
          return (
            <div
              key={slot}
              className="relative aspect-video overflow-hidden rounded-2xl border border-arena-border bg-black"
            >
              <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-black/60 to-black/90">
                <div className="text-center">
                  <div className="font-display text-3xl font-bold text-white/25">TV {slot}</div>
                  <div className="mt-2 text-[10px] uppercase tracking-widest text-muted-foreground">
                    Not configured
                  </div>
                </div>
              </div>
              <div className="pointer-events-none absolute left-3 top-3">
                <span className="rounded-md bg-black/70 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-white/95">
                  TV {slot}
                </span>
              </div>
            </div>
          );
        }
        return (
          <HlsTile
            key={tv.id}
            tvId={tv.id}
            slot={tv.slot}
            displayName={tv.display_name}
            channelName={tv.selected_channel_name}
            status={tv.enabled ? tv.status : "offline"}
            active={activeSlot === tv.slot}
            onActivate={() => onActiveSlotChange(tv.slot)}
            paused={paused}
            matchup={tv.matchup}
            sport={tv.sport}
          />
        );
      })}
    </div>
  );
}
