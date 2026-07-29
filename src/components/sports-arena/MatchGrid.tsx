import { useMemo } from "react";
import { RefreshCw, Tv as TvIcon } from "lucide-react";
import { MatchSlotTile } from "./MatchSlotTile";
import type { PublicMatch, PublicMatchSlot } from "@/lib/matches.public.functions";
import type { IptvChannel } from "@/lib/m3u-parser";
import { resolveTvTileLayout, TV_TILE_LAYOUT_SIZE } from "@/lib/match-slot-count";

export type MatchGridProps = {
  match: PublicMatch;
  channels: IptvChannel[];
  activeSlot: number | null;
  onActiveSlotChange: (slot: number) => void;
  loadingPlaylist?: boolean;
  playlistError?: string | null;
  reloadKey?: number;
  onRetry?: () => void;
};

/**
 * 4-slot match tile grid. Mirrors LoungeGrid's shape so it can be dropped
 * into the same theatre layout used on /lounge/$loungeId.
 */
export function MatchGrid({
  match,
  channels,
  activeSlot,
  onActiveSlotChange,
  loadingPlaylist = false,
  playlistError = null,
  reloadKey = 0,
  onRetry,
}: MatchGridProps) {
  const layout = useMemo(
    () =>
      resolveTvTileLayout<PublicMatchSlot>(match.slots, (slot) => ({
        slot,
        channelId: null,
        channelName: null,
        channelLogo: null,
        enabled: false,
      })),
    [match.slots],
  );

  const resolved = useMemo(() => {
    // Admin picker stores the canonical iptv-org API id (e.g. "BahrainSports1.bh").
    // The parsed playlist carries a synthetic hashed `id`, the raw playlist
    // `tvgId`, and a base-id variant (e.g. "…@SD"). Index by all three so
    // either side wins, preferring the exact match over the base-id match.
    const map = new Map<string, IptvChannel>();
    const setOnce = (key: string | null | undefined, c: IptvChannel) => {
      if (!key) return;
      if (!map.has(key)) map.set(key, c);
    };
    for (const c of channels) {
      setOnce(c.id, c);
      setOnce(c.tvgId, c);
      if (c.tvgId && c.tvgId.includes("@")) {
        setOnce(c.tvgId.split("@")[0], c);
      }
    }
    return layout.tiles.map((s) => ({
      slot: s,
      channel: s.channelId ? (map.get(s.channelId) ?? null) : null,
    }));
  }, [channels, layout.tiles]);

  const enabledCount = layout.tiles.filter((s) => s.enabled && s.channelId).length;

  if (enabledCount === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-arena-border bg-arena-panel/40 p-10 text-center">
        <TvIcon className="mx-auto h-10 w-10 text-muted-foreground/60" />
        <h3 className="mt-3 font-display text-lg font-bold text-white">No channels assigned yet</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          An admin hasn't configured any of the 4 screens for this match.
        </p>
      </div>
    );
  }

  return (
    <>
      {playlistError && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200">
          <span>Playlist failed to load: {playlistError}</span>
          {onRetry && (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md bg-amber-500/20 px-2 py-1 text-[11px] font-bold uppercase text-amber-100 hover:bg-amber-500/30"
              onClick={onRetry}
            >
              <RefreshCw className="h-3 w-3" /> Retry
            </button>
          )}
        </div>
      )}

      <div
        className="grid gap-3 grid-cols-1 sm:grid-cols-2"
        data-tv-layout-size={TV_TILE_LAYOUT_SIZE}
      >
        {resolved.map(({ slot, channel }) => {
          const enabled = slot.enabled && !!slot.channelId;
          const url = enabled ? (channel?.url ?? null) : null;
          const missing = enabled && !loadingPlaylist && !channel && !playlistError;
          return (
            <div
              key={`${slot.slot}:${slot.channelId ?? "empty"}:${slot.enabled ? "on" : "off"}`}
              className="flex flex-col gap-1.5"
            >
              <MatchSlotTile
                slot={slot.slot}
                channelName={slot.channelName ?? channel?.name ?? null}
                channelLogo={slot.channelLogo ?? channel?.logo ?? null}
                url={url}
                loadingPlaylist={enabled && loadingPlaylist}
                playlistError={enabled ? playlistError : null}
                channelMissing={missing}
                notConfigured={!slot.channelId}
                configureTo={{ to: "/admin/iptv-provider" }}
                active={activeSlot === slot.slot}
                onActivate={() => {
                  if (!enabled) return;
                  onActiveSlotChange(slot.slot);
                }}
                reloadKey={reloadKey}
              />
            </div>
          );
        })}
      </div>

      {layout.overflowCount > 0 && (
        <p role="note" className="mt-2 text-center text-[11px] text-muted-foreground">
          {layout.overflowCount} extra slot{layout.overflowCount === 1 ? "" : "s"} configured beyond
          the {TV_TILE_LAYOUT_SIZE}-tile TV layout — hidden from viewers.
        </p>
      )}
      <p className="mt-3 text-center text-[11px] uppercase tracking-wider text-muted-foreground">
        Click a tile to switch audio. All streams stay live.
      </p>
    </>
  );
}
