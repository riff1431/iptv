import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import {
  Search,
  Users,
  Tv as TvIcon,
  SlidersHorizontal,
  X,
  Pin,
  PinOff,
  Wifi,
  WifiOff,
  RefreshCw,
  AlertTriangle,
  Check,
} from "lucide-react";
import { publicMatchesQuery, type PublicMatch } from "@/lib/matches.public.functions";
import { useSuspenseQuery, useQueryClient, useIsFetching } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ArenaHeader } from "@/components/sports-arena/ArenaHeader";
import { useLiveTick, liveViewers, liveIsLive } from "@/hooks/useLiveTick";
import { SportImage } from "@/components/SportImage";
import { getRequestOrigin } from "@/lib/origin.functions";

type SortKey = "trending" | "viewers" | "alpha";

const searchSchema = z.object({
  q: fallback(z.string(), "").default(""),
  sport: fallback(z.string(), "all").default("all"),
  sort: fallback(z.enum(["trending", "viewers", "alpha"]), "trending").default("trending"),
});

export const Route = createFileRoute("/arena/")({
  validateSearch: zodValidator(searchSchema),
  loader: async ({ context }) => {
    const [, origin] = await Promise.all([
      context.queryClient.ensureQueryData(publicMatchesQuery()),
      getRequestOrigin(),
    ]);
    return { origin };
  },

  head: ({ loaderData }) => {
    const origin = loaderData?.origin ?? "";
    const url = origin ? `${origin}/arena` : "/arena";
    const title = "Sports Arena — Live Matches | PGX";
    const description =
      "Browse every live match streaming in PGX Sports Arena. Filter by sport, search matchups, and jump into any of 4 live channel feeds per match.";
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { property: "og:url", content: url },
        { property: "og:site_name", content: "PGX Sports Lounge" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
      ],
      links: [{ rel: "canonical", href: url }],
    };
  },
  component: ArenaBrowsePage,
});

function ArenaBrowsePage() {
  const { q, sport, sort } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: matches } = useSuspenseQuery(publicMatchesQuery());
  const queryClient = useQueryClient();
  const isRefetching = useIsFetching({ queryKey: ["publicMatches"] }) > 0;
  const [rtStatus, setRtStatus] = useState<"connecting" | "live" | "error">("connecting");
  const [rtError, setRtError] = useState<string | null>(null);
  const [rtTick, setRtTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: ["publicMatches"] });
    };
    setRtStatus("connecting");
    setRtError(null);
    // Append a random suffix so React remounts (StrictMode, fast route
    // re-visits) never reuse a channel name — reusing one throws
    // "cannot add `postgres_changes` callbacks … after `subscribe()`" and
    // trips the root error boundary, which looks like the page "auto
    // logged out" on the next navigation.
    const suffix = Math.random().toString(36).slice(2);
    const channel = supabase
      .channel(`arena-matches-${rtTick}-${suffix}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "matches" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "match_slots" }, invalidate)
      .subscribe((status, err) => {
        if (cancelled) return;
        if (status === "SUBSCRIBED") {
          setRtStatus("live");
          setRtError(null);
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setRtStatus("error");
          setRtError(err?.message ?? status);
        }
      });
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [queryClient, rtTick]);

  useEffect(() => {
    if (rtStatus !== "error") return;
    const id = window.setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ["publicMatches"] });
    }, 15_000);
    return () => window.clearInterval(id);
  }, [rtStatus, queryClient]);

  const retryRealtime = () => {
    queryClient.invalidateQueries({ queryKey: ["publicMatches"] });
    setRtTick((n) => n + 1);
  };

  const sports = useMemo(
    () =>
      Array.from(
        new Set(matches.map((m: PublicMatch) => m.sport).filter((s): s is string => !!s)),
      ).sort(),
    [matches],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let rows = matches.filter((m: PublicMatch) => {
      if (sport !== "all" && m.sport !== sport) return false;
      if (needle) {
        const hay =
          `${m.title} ${m.homeLabel ?? ""} ${m.awayLabel ?? ""} ${m.sport ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    if (sort === "viewers") {
      rows = rows.slice().sort((a, b) => b.viewerCount - a.viewerCount);
    } else if (sort === "alpha") {
      rows = rows.slice().sort((a, b) => a.title.localeCompare(b.title));
    } else {
      rows = rows.slice().sort((a, b) => {
        const rank = (s: PublicMatch["status"]) =>
          s === "live" ? 0 : s === "halftime" ? 1 : s === "scheduled" ? 2 : 3;
        const ra = rank(a.status);
        const rb = rank(b.status);
        if (ra !== rb) return ra - rb;
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return b.viewerCount - a.viewerCount;
      });
    }
    return rows;
  }, [matches, q, sport, sort]);

  const totalViewers = useMemo(
    () => matches.reduce((sum: number, m: PublicMatch) => sum + m.viewerCount, 0),
    [matches],
  );

  const hasFilters = q !== "" || sport !== "all" || sort !== "trending";

  const update = (patch: Partial<z.infer<typeof searchSchema>>) =>
    navigate({
      search: (prev: z.infer<typeof searchSchema>) => ({ ...prev, ...patch }),
      replace: true,
    });

  const [pinned, setPinned] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("arena.filtersPinned") === "1";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("arena.filtersPinned", pinned ? "1" : "0");
  }, [pinned]);

  return (
    <>
      <main className="mx-auto max-w-[1600px] px-3 pt-3 sm:px-4 sm:pt-4 lg:px-6">
        <ArenaHeader liveGames={filtered.length} viewers={totalViewers} />

        <div className="mb-3 flex items-center justify-end">
          {rtStatus === "live" && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300"
              title="Realtime updates connected"
            >
              <Wifi className="h-3 w-3" />
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
              </span>
              Live
            </span>
          )}
          {rtStatus === "connecting" && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-arena-border bg-arena-panel-2/60 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
              <RefreshCw className="h-3 w-3 animate-spin" />
              Connecting…
            </span>
          )}
          {rtStatus === "error" && (
            <div
              role="alert"
              className="inline-flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-300"
              title={rtError ?? "Realtime disconnected"}
            >
              <WifiOff className="h-3 w-3" />
              <span className="inline-flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Live updates unavailable
              </span>
              <span className="text-amber-200/70">— polling every 15s</span>
              <button
                type="button"
                onClick={retryRealtime}
                className="ml-1 inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-amber-100 hover:bg-amber-500/30"
              >
                <RefreshCw className="h-3 w-3" />
                Retry
              </button>
            </div>
          )}
        </div>

        <section
          className={`mb-5 rounded-2xl border border-arena-border bg-arena-panel/90 p-3 backdrop-blur-xl sm:p-4 ${
            pinned ? "sticky top-14 z-30 shadow-[0_10px_30px_-15px_rgba(0,0,0,0.6)] sm:top-16" : ""
          }`}
        >
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <label className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => update({ q: e.target.value })}
                placeholder="Search match, team or sport…"
                className="h-10 w-full rounded-lg border border-arena-border bg-arena-panel-2/60 pl-9 pr-3 text-sm text-white placeholder:text-muted-foreground focus:border-arena-violet focus:outline-none"
              />
            </label>

            <div className="flex flex-wrap items-center gap-2">
              <FilterSelect
                label="Sport"
                value={sport}
                onChange={(v) => update({ sport: v })}
                options={[
                  { value: "all", label: "All sports" },
                  ...sports.map((s) => ({ value: s, label: s })),
                ]}
              />
              {hasFilters && (
                <button
                  onClick={() =>
                    navigate({ search: { q: "", sport: "all", sort: "trending" }, replace: true })
                  }
                  className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-arena-border bg-transparent px-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground transition hover:border-white/30 hover:text-white"
                >
                  <X className="h-3.5 w-3.5" /> Clear
                </button>
              )}
            </div>
          </div>

          <div className="mt-3 flex flex-col gap-2 border-t border-arena-border pt-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3">
            <div className="flex items-center justify-between gap-2 sm:justify-start">
              <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Sort by
              </div>
              <button
                type="button"
                onClick={() => setPinned((p) => !p)}
                aria-pressed={pinned}
                title={pinned ? "Unpin filters" : "Pin filters to top"}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition sm:ml-3 ${
                  pinned
                    ? "border-arena-violet/60 bg-arena-violet/15 text-arena-violet"
                    : "border-arena-border bg-transparent text-muted-foreground hover:border-white/30 hover:text-white"
                }`}
              >
                {pinned ? <Pin className="h-3 w-3" /> : <PinOff className="h-3 w-3" />}
                {pinned ? "Pinned" : "Pin"}
              </button>
            </div>

            <div className="-mx-1 flex gap-1 overflow-x-auto px-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
              {(
                [
                  { key: "trending", label: "Trending" },
                  { key: "viewers", label: "Most watched" },
                  { key: "alpha", label: "A → Z" },
                ] as Array<{ key: SortKey; label: string }>
              ).map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => update({ sort: opt.key })}
                  className={`shrink-0 rounded-md px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition ${
                    sort === opt.key
                      ? "bg-arena-violet text-white"
                      : "text-muted-foreground hover:bg-white/5 hover:text-white"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <span>
            {filtered.length} {filtered.length === 1 ? "match" : "matches"}
          </span>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            onReset={() =>
              navigate({ search: { q: "", sport: "all", sort: "trending" }, replace: true })
            }
          />
        ) : (
          <div
            className={`grid grid-cols-1 gap-4 transition-opacity duration-300 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 ${
              isRefetching ? "opacity-80" : "opacity-100"
            }`}
          >
            {filtered.map((m) => (
              <MatchCard key={m.id} match={m} />
            ))}
          </div>
        )}
      </main>
    </>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="inline-flex h-10 items-center gap-2 rounded-lg border border-arena-border bg-arena-panel-2/60 px-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="cursor-pointer bg-transparent text-xs font-semibold uppercase tracking-wider text-white focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-arena-panel text-white">
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function MatchCard({ match }: { match: PublicMatch }) {
  const hasVs = !!(match.homeLabel && match.awayLabel);
  const tick = useLiveTick(5000);
  const viewers = liveViewers(match.viewerCount, match.id, tick);
  const autoLive = liveIsLive(match.id, tick);
  const isLive = match.status === "live" || (match.status === "scheduled" && autoLive);
  const statusLabel =
    match.status === "live"
      ? "Live"
      : match.status === "halftime"
        ? "Half"
        : match.status === "final"
          ? "Final"
          : isLive
            ? "Live"
            : "Soon";

  const enabledSlots = match.slots.filter((s) => s.enabled && s.channelId);
  const scoreFp = `${match.homeScore}-${match.awayScore}-${match.status}`;

  return (
    <Link
      to="/arena/$matchId"
      params={{ matchId: match.id }}
      className="group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-arena-border bg-arena-panel/70 transition hover:-translate-y-0.5 hover:border-arena-violet hover:shadow-[0_10px_40px_-15px_var(--arena-violet)] focus:outline-none focus-visible:ring-2 focus-visible:ring-arena-violet motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      <div className="relative aspect-video overflow-hidden bg-gradient-to-br from-arena-panel-2 to-black">
        {match.thumbnailUrl ? (
          <img
            src={match.thumbnailUrl}
            alt={match.title}
            className="h-full w-full object-cover duration-500 group-hover:scale-[1.03]"
            loading="lazy"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <SportImage
            sport={match.sport ?? ""}
            width={1024}
            height={576}
            alt={match.title}
            imgClassName="duration-500 group-hover:scale-[1.03]"
          />
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-black/10" />

        {match.sport ? (
          <span className="absolute left-2 top-2 max-w-[calc(100%-4.5rem)] truncate rounded-md bg-black/70 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white/95 sm:left-3 sm:top-3">
            {match.sport}
          </span>
        ) : null}
        <span
          className={`absolute right-2 top-2 inline-flex h-6 min-w-[52px] shrink-0 items-center justify-center rounded-[6px] px-2 text-[10px] font-bold uppercase leading-none tracking-[0.08em] transition-colors duration-500 ease-out sm:right-3 sm:top-3 sm:text-[11px] ${
            isLive
              ? "bg-live text-live-foreground"
              : match.status === "final"
                ? "bg-black/70 text-white/80 ring-1 ring-inset ring-arena-border"
                : "bg-arena-panel-2/80 text-muted-foreground ring-1 ring-inset ring-arena-border"
          }`}
          aria-live="polite"
        >
          {statusLabel}
        </span>

        {hasVs ? (
          <div
            key={scoreFp}
            className="absolute bottom-2 left-2 right-2 flex animate-fade-in items-center justify-between gap-2 text-white motion-reduce:animate-none sm:bottom-3 sm:left-3 sm:right-3"
          >
            <div className="flex items-center gap-1.5 min-w-0">
              {match.accentHome ? (
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full transition-colors duration-300"
                  style={{ background: match.accentHome }}
                />
              ) : null}
              <span className="truncate text-xs font-bold uppercase tracking-wider">
                {match.homeLabel}
              </span>
              <span className="ml-1 tabular-nums text-sm font-bold transition-colors duration-300">
                {match.homeScore}
              </span>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {match.periodLabel || match.clockLabel || "vs"}
            </span>
            <div className="flex items-center gap-1.5 min-w-0 justify-end">
              <span className="tabular-nums text-sm font-bold transition-colors duration-300">
                {match.awayScore}
              </span>
              <span className="truncate text-xs font-bold uppercase tracking-wider">
                {match.awayLabel}
              </span>
              {match.accentAway ? (
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full transition-colors duration-300"
                  style={{ background: match.accentAway }}
                />
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-3 sm:p-4">
        <div className="truncate text-sm font-semibold text-white transition-colors duration-300">
          {match.title}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            {[1, 2, 3, 4].map((n) => {
              const configured = match.slots.some((s) => s.slot === n && s.enabled && s.channelId);
              return (
                <div
                  key={n}
                  title={configured ? `Slot ${n} configured` : `Slot ${n} not configured`}
                  className={`flex h-6 w-6 items-center justify-center rounded border text-[9px] font-bold ${
                    configured
                      ? "border-arena-violet bg-arena-violet text-white"
                      : "border-arena-border bg-black/30 text-muted-foreground"
                  }`}
                  aria-label={configured ? `Slot ${n} configured` : `Slot ${n} not configured`}
                >
                  {configured ? <Check className="h-3 w-3" /> : n}
                </div>
              );
            })}
          </div>
          <span
            className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
              enabledSlots.length === 4
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : enabledSlots.length === 0
                  ? "border-arena-border bg-black/30 text-muted-foreground"
                  : "border-amber-500/30 bg-amber-500/10 text-amber-300"
            }`}
          >
            {enabledSlots.length === 4
              ? "4/4 ready"
              : enabledSlots.length === 0
                ? "Not configured"
                : `${enabledSlots.length}/4 configured`}
          </span>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <span className="inline-flex shrink-0 items-center gap-1">
            <TvIcon className="h-3 w-3" />
            {enabledSlots.length} of 4 slots active
          </span>
          <span className="inline-flex shrink-0 items-center gap-1">
            <Users className="h-3 w-3" />
            <span
              className="inline-block min-w-[3.5ch] text-right tabular-nums text-white/90 transition-[color] duration-500"
              aria-live="polite"
            >
              {viewers.toLocaleString()}
            </span>
          </span>
        </div>
      </div>
    </Link>
  );
}

function EmptyState({ onReset }: { onReset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-arena-border bg-arena-panel/40 px-6 py-16 text-center">
      <TvIcon className="h-10 w-10 text-muted-foreground/60" />
      <h3 className="mt-4 font-display text-lg font-bold text-white">No matches found</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        Try clearing filters or check back soon — admins add new matches throughout the day.
      </p>
      <button
        onClick={onReset}
        className="mt-5 inline-flex items-center gap-2 rounded-lg bg-arena-violet px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-white transition hover:bg-arena-violet/90"
      >
        Reset filters
      </button>
    </div>
  );
}
