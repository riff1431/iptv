import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, ArrowDownUp, Filter, RefreshCw, Tv as TvIcon, Volume2, VolumeX, X } from "lucide-react";
import { MatchSlotTile, type SlotHealth } from "./MatchSlotTile";
import type { PublicMatch, PublicMatchSlot } from "@/lib/matches.public.functions";
import type { IptvChannel } from "@/lib/m3u-parser";
import { resolveTvTileLayout, TV_TILE_LAYOUT_SIZE } from "@/lib/match-slot-count";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";



export type MatchGridProps = {
  match: PublicMatch;
  channels: IptvChannel[];
  activeSlot: number | null;
  onActiveSlotChange: (slot: number) => void;
  loadingPlaylist?: boolean;
  playlistError?: string | null;
  providerLabel?: string | null;
  playlistName?: string | null;
  reloadKey?: number;
  onRetry?: () => void;
  /** When true, render a per-tile "matched as" debug row for admins. */
  showAdminDebug?: boolean;
};

/** Normalize an iptv-org id by stripping variant suffixes like "@SD". */
function normalizeChannelId(id: string | null | undefined): string | null {
  if (!id) return null;
  const base = id.includes("@") ? id.split("@")[0] : id;
  return base.trim().toLowerCase() || null;
}


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
  providerLabel = null,
  playlistName = null,
  reloadKey = 0,
  onRetry,
  showAdminDebug = false,
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
    // The parsed playlist has:
    //   - a synthetic hashed `id` (unique per row)
    //   - the raw playlist `tvgId` which usually carries a variant suffix like
    //     "BahrainSports1.bh@SD" or "BEKSports.us@West"
    // Index by all three shapes so either side wins, and prefer the exact
    // match over the base-id match.
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

  // Per-slot health reported by MatchSlotTile. Used to compute the aggregate
  // summary shown above the grid.
  const [slotHealth, setSlotHealth] = useState<Record<number, SlotHealth>>({});
  const handleHealthChange = useCallback((slot: number, health: SlotHealth) => {
    setSlotHealth((prev) => (prev[slot] === health ? prev : { ...prev, [slot]: health }));
  }, []);

  // Slide-out details drawer — opens when a tile is tapped so viewers can
  // inspect health/audio state without leaving the grid.
  const [detailsSlot, setDetailsSlot] = useState<number | null>(null);
  const closeDetails = useCallback(() => setDetailsSlot(null), []);

  // Sort mode for the tile grid. "slot" preserves the admin-configured order;
  // "health" surfaces healthy streams first so viewers land on a working tile.
  // Persisted to localStorage so the choice survives reloads and sessions.
  // NB: default to "slot" on the server render, then hydrate the saved value
  // in an effect — avoids an SSR/CSR mismatch (see tanstack-execution-model).
  type SortMode = "slot" | "health";
  const SORT_STORAGE_KEY = "arena:match-grid:sort-mode";
  const [sortMode, setSortMode] = useState<SortMode>("slot");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(SORT_STORAGE_KEY);
      if (saved === "slot" || saved === "health") setSortMode(saved);
    } catch {
      // localStorage unavailable (private mode, disabled) — keep default.
    }
  }, []);
  const updateSortMode = useCallback((next: SortMode) => {
    setSortMode(next);
    try {
      window.localStorage.setItem(SORT_STORAGE_KEY, next);
    } catch {
      // Persistence is best-effort; UI still works if it fails.
    }
  }, []);

  // Filters — narrow the visible tiles by health status and by channel.
  // Both are persisted so the viewer's preferred slice sticks across reloads.
  const STATUS_FILTER_KEY = "arena:match-grid:status-filter";
  const CHANNEL_FILTER_KEY = "arena:match-grid:channel-filter";
  const ALL_STATUSES: SlotHealth[] = ["healthy", "degraded", "unavailable", "unknown"];
  const [statusFilter, setStatusFilter] = useState<Set<SlotHealth>>(
    () => new Set(ALL_STATUSES),
  );
  const [channelFilter, setChannelFilter] = useState<string>("all");
  useEffect(() => {
    try {
      const rawStatus = window.localStorage.getItem(STATUS_FILTER_KEY);
      if (rawStatus) {
        const parsed = JSON.parse(rawStatus) as unknown;
        if (Array.isArray(parsed)) {
          const valid = parsed.filter((v): v is SlotHealth =>
            ALL_STATUSES.includes(v as SlotHealth),
          );
          if (valid.length > 0) setStatusFilter(new Set(valid));
        }
      }
      const rawChannel = window.localStorage.getItem(CHANNEL_FILTER_KEY);
      if (rawChannel) setChannelFilter(rawChannel);
    } catch {
      // localStorage unavailable — keep defaults.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const toggleStatus = useCallback((status: SlotHealth) => {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(status)) {
        if (next.size === 1) return prev; // never leave the filter empty
        next.delete(status);
      } else {
        next.add(status);
      }
      try {
        window.localStorage.setItem(
          STATUS_FILTER_KEY,
          JSON.stringify(Array.from(next)),
        );
      } catch {
        // best-effort
      }
      return next;
    });
  }, []);
  const updateChannelFilter = useCallback((next: string) => {
    setChannelFilter(next);
    try {
      window.localStorage.setItem(CHANNEL_FILTER_KEY, next);
    } catch {
      // best-effort
    }
  }, []);
  const resetFilters = useCallback(() => {
    setStatusFilter(new Set(ALL_STATUSES));
    setChannelFilter("all");
    try {
      window.localStorage.removeItem(STATUS_FILTER_KEY);
      window.localStorage.removeItem(CHANNEL_FILTER_KEY);
    } catch {
      // best-effort
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const HEALTH_SORT_WEIGHT: Record<SlotHealth, number> = {
    healthy: 0,
    unknown: 1,
    degraded: 2,
    unavailable: 3,
  };



  const enabledSlotNumbers = useMemo(
    () => layout.tiles.filter((s) => s.enabled && s.channelId).map((s) => s.slot),
    [layout.tiles],
  );
  const healthCounts = useMemo(() => {
    const counts = { healthy: 0, degraded: 0, unavailable: 0, unknown: 0 };
    for (const s of enabledSlotNumbers) {
      const h = slotHealth[s] ?? "unknown";
      counts[h] += 1;
    }
    return counts;
  }, [enabledSlotNumbers, slotHealth]);

  const overallHealth: SlotHealth =
    enabledSlotNumbers.length === 0
      ? "unknown"
      : healthCounts.unavailable === enabledSlotNumbers.length
        ? "unavailable"
        : healthCounts.unavailable > 0 || healthCounts.degraded > 0
          ? "degraded"
          : healthCounts.healthy === enabledSlotNumbers.length
            ? "healthy"
            : "unknown";
  const overallMeta: Record<
    SlotHealth,
    { label: string; ring: string; dot: string; blurb: string }
  > = {
    healthy: {
      label: "All streams healthy",
      ring: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100",
      dot: "bg-emerald-400",
      blurb: "No errors or rebuffers on any tile in the last 60s.",
    },
    degraded: {
      label: "Match degraded",
      ring: "border-amber-500/40 bg-amber-500/10 text-amber-100",
      dot: "bg-amber-400 animate-pulse",
      blurb: healthCounts.unavailable
        ? `${healthCounts.unavailable} tile${healthCounts.unavailable === 1 ? "" : "s"} down, ${healthCounts.degraded} flaky.`
        : `${healthCounts.degraded} tile${healthCounts.degraded === 1 ? "" : "s"} showing recent errors or rebuffers.`,
    },
    unavailable: {
      label: "Match unavailable",
      ring: "border-live/50 bg-live/10 text-white",
      dot: "bg-live",
      blurb: "Every configured tile failed to start.",
    },
    unknown: {
      label: "Warming up",
      ring: "border-sky-500/40 bg-sky-500/10 text-sky-100",
      dot: "bg-sky-400 animate-pulse",
      blurb: "Waiting for tiles to reach first frame.",
    },
  };
  const overall = overallMeta[overallHealth];

  const sortedResolved = useMemo(() => {
    if (sortMode === "slot") return resolved;
    // Stable sort by health weight, then by original slot number so the order
    // is deterministic within a health bucket.
    return [...resolved]
      .map((r, idx) => ({ r, idx }))
      .sort((a, b) => {
        const ha = slotHealth[a.r.slot.slot] ?? "unknown";
        const hb = slotHealth[b.r.slot.slot] ?? "unknown";
        const d = HEALTH_SORT_WEIGHT[ha] - HEALTH_SORT_WEIGHT[hb];
        return d !== 0 ? d : a.idx - b.idx;
      })
      .map(({ r }) => r);
  }, [resolved, sortMode, slotHealth]);

  // Channel options for the filter <select>, derived from configured tiles.
  // Value is the configured channelId; label prefers the display name.
  const channelOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const { slot, channel } of resolved) {
      if (!slot.enabled || !slot.channelId) continue;
      if (seen.has(slot.channelId)) continue;
      seen.set(slot.channelId, slot.channelName ?? channel?.name ?? slot.channelId);
    }
    return Array.from(seen, ([id, label]) => ({ id, label })).sort((a, b) =>
      a.label.localeCompare(b.label),
    );
  }, [resolved]);

  // Apply active filters after sorting so slot/health ordering is preserved.
  const displayedResolved = useMemo(() => {
    return sortedResolved.filter(({ slot }) => {
      if (!slot.enabled || !slot.channelId) return true; // keep placeholder tiles
      const h = slotHealth[slot.slot] ?? "unknown";
      if (!statusFilter.has(h)) return false;
      if (channelFilter !== "all" && slot.channelId !== channelFilter) return false;
      return true;
    });
  }, [sortedResolved, slotHealth, statusFilter, channelFilter]);

  const filtersActive =
    statusFilter.size !== ALL_STATUSES.length || channelFilter !== "all";
  const hiddenCount = sortedResolved.length - displayedResolved.length;

  const STATUS_META: Record<
    SlotHealth,
    { label: string; active: string; inactive: string; dot: string }
  > = {
    healthy: {
      label: "Healthy",
      active: "bg-emerald-500/25 text-emerald-100 ring-emerald-400/40",
      inactive: "bg-transparent text-emerald-100/50 ring-emerald-400/20 hover:bg-emerald-500/10",
      dot: "bg-emerald-400",
    },
    degraded: {
      label: "Degraded",
      active: "bg-amber-500/25 text-amber-100 ring-amber-400/40",
      inactive: "bg-transparent text-amber-100/50 ring-amber-400/20 hover:bg-amber-500/10",
      dot: "bg-amber-400",
    },
    unavailable: {
      label: "Unavailable",
      active: "bg-live/25 text-white ring-live/50",
      inactive: "bg-transparent text-white/40 ring-live/20 hover:bg-live/10",
      dot: "bg-live",
    },
    unknown: {
      label: "Warming",
      active: "bg-sky-500/25 text-sky-100 ring-sky-400/40",
      inactive: "bg-transparent text-sky-100/50 ring-sky-400/20 hover:bg-sky-500/10",
      dot: "bg-sky-400",
    },
  };




  if (enabledCount === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-arena-border bg-arena-panel/40 p-10 text-center">
        <TvIcon className="mx-auto h-10 w-10 text-muted-foreground/60" />
        <h3 className="mt-3 font-display text-lg font-bold text-white">
          No channels assigned yet
        </h3>
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
      {/* Aggregate match health — rolls up the per-tile Health pills into
          one at-a-glance status for the whole match. */}
      <div
        data-match-health={overallHealth}
        className={`mb-3 flex flex-col gap-2 rounded-lg border px-3 py-2 text-[12px] sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3 ${overall.ring}`}
        role="status"
        aria-live="polite"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${overall.dot}`} />
          <Activity className="h-3.5 w-3.5 shrink-0 opacity-80" />
          <span className="shrink-0 font-bold uppercase tracking-wider">{overall.label}</span>
          <span className="min-w-0 truncate text-white/70">— {overall.blurb}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/20 px-2 py-0.5 text-emerald-100 ring-1 ring-inset ring-emerald-400/30">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            {healthCounts.healthy} healthy
          </span>
          <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/20 px-2 py-0.5 text-amber-100 ring-1 ring-inset ring-amber-400/30">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
            {healthCounts.degraded} degraded
          </span>
          <span className="inline-flex items-center gap-1 rounded-md bg-live/20 px-2 py-0.5 text-white ring-1 ring-inset ring-live/40">
            <span className="h-1.5 w-1.5 rounded-full bg-live" />
            {healthCounts.unavailable} down

          </span>
          {healthCounts.unknown > 0 && (
            <span className="inline-flex items-center gap-1 rounded-md bg-sky-500/20 px-2 py-0.5 text-sky-100 ring-1 ring-inset ring-sky-400/30">
              <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
              {healthCounts.unknown} warming
            </span>
          )}
        </div>
      </div>

      {/* Sort control — reorder tiles so healthy streams appear first without
          changing the underlying slot numbers or admin configuration. */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px] sm:justify-end">
        <span className="text-muted-foreground">Sort tiles</span>

        <div
          role="group"
          aria-label="Sort tiles"
          className="inline-flex overflow-hidden rounded-md border border-arena-border"
        >
          <button
            type="button"
            onClick={() => updateSortMode("slot")}
            aria-pressed={sortMode === "slot"}
            className={`px-2.5 py-1 font-semibold uppercase tracking-wider transition ${
              sortMode === "slot"
                ? "bg-arena-violet text-white"
                : "bg-transparent text-white/70 hover:bg-white/5"
            }`}
          >
            Slot order
          </button>
          <button
            type="button"
            onClick={() => updateSortMode("health")}
            aria-pressed={sortMode === "health"}
            className={`inline-flex items-center gap-1 px-2.5 py-1 font-semibold uppercase tracking-wider transition ${
              sortMode === "health"
                ? "bg-arena-violet text-white"
                : "bg-transparent text-white/70 hover:bg-white/5"
            }`}
          >
            <ArrowDownUp className="h-3 w-3" /> Healthy first
          </button>
        </div>
      </div>

      {/* Filters bar — narrow tiles by health status and by channel. Slot
          numbers are preserved so the underlying admin layout is unchanged. */}
      <div className="mb-3 rounded-lg border border-arena-border bg-arena-panel/40 px-3 py-2 text-[11px]">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
          <div className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
            <Filter className="h-3.5 w-3.5" />
            <span className="font-semibold uppercase tracking-wider">Filters</span>
          </div>

          <div
            role="group"
            aria-label="Filter by status"
            className="flex flex-wrap items-center gap-1.5"
          >
            {ALL_STATUSES.map((status) => {
              const meta = STATUS_META[status];
              const active = statusFilter.has(status);
              const count = healthCounts[status];
              return (
                <button
                  key={status}
                  type="button"
                  onClick={() => toggleStatus(status)}
                  aria-pressed={active}
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold uppercase tracking-wider ring-1 ring-inset transition ${
                    active ? meta.active : meta.inactive
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                  {meta.label}
                  <span className="opacity-70">{count}</span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1.5 sm:ml-auto">
            <label
              htmlFor="match-grid-channel-filter"
              className="shrink-0 text-muted-foreground"
            >
              Channel
            </label>
            <select
              id="match-grid-channel-filter"
              value={channelFilter}
              onChange={(e) => updateChannelFilter(e.target.value)}
              className="min-w-[8rem] rounded-md border border-arena-border bg-arena-panel px-2 py-1 font-semibold text-white focus:outline-none focus:ring-2 focus:ring-arena-violet"
            >
              <option value="all">All channels</option>
              {channelOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
            {filtersActive && (
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex items-center gap-1 rounded-md border border-arena-border px-2 py-1 font-semibold uppercase tracking-wider text-white/70 hover:bg-white/5"
              >
                <X className="h-3 w-3" /> Reset
              </button>
            )}
          </div>
        </div>
        {filtersActive && hiddenCount > 0 && (
          <p className="mt-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            {hiddenCount} tile{hiddenCount === 1 ? "" : "s"} hidden by filters
          </p>
        )}
      </div>

      {displayedResolved.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-arena-border bg-arena-panel/40 p-8 text-center">
          <Filter className="mx-auto h-8 w-8 text-muted-foreground/60" />
          <p className="mt-2 text-sm text-white">No tiles match your filters.</p>
          <button
            type="button"
            onClick={resetFilters}
            className="mt-3 inline-flex items-center gap-1 rounded-md border border-arena-border px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-white/80 hover:bg-white/5"
          >
            <X className="h-3 w-3" /> Reset filters
          </button>
        </div>
      ) : (
      <div
        className="grid gap-3 grid-cols-1 sm:grid-cols-2"
        data-tv-layout-size={TV_TILE_LAYOUT_SIZE}
      >
        {displayedResolved.map(({ slot, channel }) => {
          const enabled = slot.enabled && !!slot.channelId;
          const url = enabled ? (channel?.url ?? null) : null;
          const missing = enabled && !loadingPlaylist && !channel && !playlistError;
          const configuredId = slot.channelId ?? null;
          const resolvedTvgId = channel?.tvgId ?? null;
          const normalizedConfigured = normalizeChannelId(configuredId);
          const normalizedResolved = normalizeChannelId(resolvedTvgId ?? channel?.id ?? null);
          const matched = !!channel;
          const normalizedMatch =
            !!normalizedConfigured &&
            !!normalizedResolved &&
            normalizedConfigured === normalizedResolved;
          return (
            <div key={slot.slot} className="flex flex-col gap-1.5">
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
                providerType={providerLabel}
                playlistName={playlistName}
                active={activeSlot === slot.slot}
                onActivate={() => {
                  if (!enabled) return;
                  onActiveSlotChange(slot.slot);
                  setDetailsSlot(slot.slot);
                }}
                reloadKey={reloadKey}
                onHealthChange={enabled ? handleHealthChange : undefined}
              />

              {showAdminDebug && enabled && (
                <div
                  className={`rounded-md border px-2.5 py-1.5 font-mono text-[10px] leading-relaxed ${
                    matched
                      ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-100/90"
                      : "border-amber-500/40 bg-amber-500/5 text-amber-100/90"
                  }`}
                  data-admin-debug="slot-match"
                >
                  <div className="mb-0.5 flex items-center justify-between gap-2 uppercase tracking-wider">
                    <span className="font-sans font-bold">
                      Slot {slot.slot} — {matched ? "matched as" : "no match"}
                    </span>
                    {matched && (
                      <span
                        className={`rounded px-1.5 py-0.5 text-[9px] font-sans font-bold ${
                          normalizedMatch
                            ? "bg-emerald-500/20 text-emerald-100"
                            : "bg-sky-500/20 text-sky-100"
                        }`}
                      >
                        {normalizedMatch ? "exact" : "via alias"}
                      </span>
                    )}
                  </div>
                  <div className="text-white/70">
                    <span className="text-white/40">channel_id:</span>{" "}
                    <span className="text-white/90">{configuredId ?? "—"}</span>
                  </div>
                  <div className="text-white/70">
                    <span className="text-white/40">tvgId:</span>{" "}
                    <span className="text-white/90">{resolvedTvgId ?? "—"}</span>
                  </div>
                  <div className="text-white/70">
                    <span className="text-white/40">normalized:</span>{" "}
                    <span className="text-white/90">
                      {normalizedConfigured ?? "—"}
                      {normalizedResolved && normalizedResolved !== normalizedConfigured
                        ? ` → ${normalizedResolved}`
                        : ""}
                    </span>
                  </div>
                </div>
              )}
            </div>
          );
        })}

      </div>
      )}
      {layout.overflowCount > 0 && (
        <p role="note" className="mt-2 text-center text-[11px] text-muted-foreground">
          {layout.overflowCount} extra slot{layout.overflowCount === 1 ? "" : "s"}{" "}
          configured beyond the {TV_TILE_LAYOUT_SIZE}-tile TV layout — hidden from viewers.
        </p>
      )}
      <p className="mt-3 text-center text-[11px] uppercase tracking-wider text-muted-foreground">
        Click a tile to switch audio. All streams stay live.
      </p>

      {/* Slide-out details drawer — surfaces the tapped tile's health, slot
          info, and audio status without pausing playback. */}
      <SlotDetailsDrawer
        open={detailsSlot !== null}
        onClose={closeDetails}
        detail={
          detailsSlot === null
            ? null
            : (() => {
                const entry = resolved.find((r) => r.slot.slot === detailsSlot);
                if (!entry) return null;
                const health = slotHealth[detailsSlot] ?? "unknown";
                return {
                  slot: entry.slot,
                  channel: entry.channel,
                  health,
                  healthMeta: SLOT_HEALTH_META[health],
                  isActiveAudio: activeSlot === detailsSlot,
                };
              })()
        }
        overall={{
          health: overallHealth,
          label: overall.label,
          blurb: overall.blurb,
          ring: overall.ring,
          dot: overall.dot,
          counts: healthCounts,
        }}
        providerLabel={providerLabel}
        playlistName={playlistName}
      />
    </>
  );
}

/** Static per-status descriptor used by the details drawer. */
const SLOT_HEALTH_META: Record<
  SlotHealth,
  { label: string; ring: string; dot: string; blurb: string }
> = {
  healthy: {
    label: "Healthy",
    ring: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100",
    dot: "bg-emerald-400",
    blurb: "Stream is playing with no recent errors or rebuffers.",
  },
  degraded: {
    label: "Degraded",
    ring: "border-amber-500/40 bg-amber-500/10 text-amber-100",
    dot: "bg-amber-400 animate-pulse",
    blurb: "Recent errors or rebuffers detected in the last 60s.",
  },
  unavailable: {
    label: "Unavailable",
    ring: "border-live/50 bg-live/10 text-white",
    dot: "bg-live",
    blurb: "Stream failed to start or has been down.",
  },
  unknown: {
    label: "Warming",
    ring: "border-sky-500/40 bg-sky-500/10 text-sky-100",
    dot: "bg-sky-400 animate-pulse",
    blurb: "Waiting for the first frame to render.",
  },
};

type SlotDetail = {
  slot: PublicMatchSlot;
  channel: IptvChannel | null;
  health: SlotHealth;
  healthMeta: (typeof SLOT_HEALTH_META)[SlotHealth];
  isActiveAudio: boolean;
};

type SlotDetailsDrawerProps = {
  open: boolean;
  onClose: () => void;
  detail: SlotDetail | null;
  overall: {
    health: SlotHealth;
    label: string;
    blurb: string;
    ring: string;
    dot: string;
    counts: { healthy: number; degraded: number; unavailable: number; unknown: number };
  };
  providerLabel: string | null;
  playlistName: string | null;
};

function SlotDetailsDrawer({
  open,
  onClose,
  detail,
  overall,
  providerLabel,
  playlistName,
}: SlotDetailsDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="right"
        className="w-full max-w-md border-l border-arena-border bg-arena-panel text-white sm:max-w-md"
      >
        {detail ? (
          <>
            <SheetHeader className="text-left">
              <SheetTitle className="flex items-center gap-2 font-display text-white">
                <span className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-md bg-arena-violet px-1.5 text-xs font-bold">
                  {detail.slot.slot}
                </span>
                <span className="truncate">
                  {detail.slot.channelName ?? detail.channel?.name ?? "Unassigned channel"}
                </span>
              </SheetTitle>
              <SheetDescription className="text-white/60">
                Live status for this slot. Audio and stream keep playing while the drawer is open.
              </SheetDescription>
            </SheetHeader>

            <div className="mt-5 space-y-4 text-[12px]">
              {/* Slot / channel info */}
              <div className="flex items-center gap-3 rounded-lg border border-arena-border bg-black/20 p-3">
                {(detail.slot.channelLogo ?? detail.channel?.logo) ? (
                  <img
                    src={detail.slot.channelLogo ?? detail.channel?.logo ?? ""}
                    alt=""
                    className="h-10 w-10 shrink-0 rounded object-contain"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-arena-border/40">
                    <TvIcon className="h-5 w-5 text-muted-foreground" />
                  </div>
                )}
                <div className="min-w-0">
                  <div className="truncate font-semibold text-white">
                    {detail.slot.channelName ?? detail.channel?.name ?? "—"}
                  </div>
                  <div className="truncate text-[11px] text-white/50">
                    Slot {detail.slot.slot} · {detail.slot.enabled ? "Enabled" : "Disabled"}
                    {detail.slot.channelId ? ` · ${detail.slot.channelId}` : ""}
                  </div>
                </div>
              </div>

              {/* Tile health */}
              <div>
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Tile health
                </div>
                <div
                  data-stream-health={detail.health}
                  className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${detail.healthMeta.ring}`}
                >
                  <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${detail.healthMeta.dot}`} />
                  <div className="min-w-0">
                    <div className="font-bold uppercase tracking-wider">{detail.healthMeta.label}</div>
                    <p className="text-white/70">{detail.healthMeta.blurb}</p>
                  </div>
                </div>
              </div>

              {/* Audio status */}
              <div>
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Audio
                </div>
                <div
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${
                    detail.isActiveAudio
                      ? "border-arena-violet/50 bg-arena-violet/10 text-white"
                      : "border-arena-border bg-black/20 text-white/70"
                  }`}
                >
                  {detail.isActiveAudio ? (
                    <Volume2 className="h-4 w-4 text-arena-violet" />
                  ) : (
                    <VolumeX className="h-4 w-4 text-muted-foreground" />
                  )}
                  <div className="min-w-0">
                    <div className="font-bold uppercase tracking-wider">
                      {detail.isActiveAudio ? "Audio active" : "Muted"}
                    </div>
                    <p className="text-[11px] text-white/60">
                      {detail.isActiveAudio
                        ? "You're hearing this tile. Tap another tile to switch."
                        : "Tap this tile in the grid to unmute its audio."}
                    </p>
                  </div>
                </div>
              </div>

              {/* Overall match health */}
              <div>
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Match health
                </div>
                <div
                  data-match-health={overall.health}
                  className={`rounded-lg border px-3 py-2 ${overall.ring}`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${overall.dot}`} />
                    <Activity className="h-3.5 w-3.5 opacity-80" />
                    <span className="font-bold uppercase tracking-wider">{overall.label}</span>
                  </div>
                  <p className="mt-1 text-white/70">{overall.blurb}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
                    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/20 px-2 py-0.5 text-emerald-100 ring-1 ring-inset ring-emerald-400/30">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      {overall.counts.healthy} healthy
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/20 px-2 py-0.5 text-amber-100 ring-1 ring-inset ring-amber-400/30">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                      {overall.counts.degraded} degraded
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-md bg-live/20 px-2 py-0.5 text-white ring-1 ring-inset ring-live/40">
                      <span className="h-1.5 w-1.5 rounded-full bg-live" />
                      {overall.counts.unavailable} down
                    </span>
                    {overall.counts.unknown > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-sky-500/20 px-2 py-0.5 text-sky-100 ring-1 ring-inset ring-sky-400/30">
                        <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
                        {overall.counts.unknown} warming
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Source */}
              {(providerLabel || playlistName) && (
                <div className="rounded-lg border border-arena-border bg-black/20 px-3 py-2 text-[11px] text-white/60">
                  <span className="font-semibold uppercase tracking-wider text-white/70">Source</span>{" "}
                  {providerLabel ?? "—"}
                  {playlistName ? ` · ${playlistName}` : ""}
                </div>
              )}

              <button
                type="button"
                onClick={onClose}
                className="inline-flex w-full items-center justify-center gap-1 rounded-md border border-arena-border bg-arena-panel px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-white/80 hover:bg-white/5"
              >
                <X className="h-3 w-3" /> Close
              </button>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

