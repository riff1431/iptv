import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  RotateCcw,
  Users,
  Radio,
  Ticket,
  ImageIcon,
  Loader2,
  Sparkles,
  CalendarDays,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { publicMatchesQuery, type PublicMatch } from "@/lib/matches.public.functions";

export const Route = createFileRoute("/schedule/")({
  head: () => ({
    meta: [
      { title: "Schedule — PGX Sports Lounge" },
      {
        name: "description",
        content: "See what's playing now and what's coming up in all lobbies.",
      },
    ],
  }),
  component: SchedulePage,
});

type DayFilter = "today" | "tomorrow" | "7days";

const MONTHS = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];

const SPORT_EMOJI: Record<string, string> = {
  nba: "🏀",
  basketball: "🏀",
  soccer: "⚽",
  football: "⚽",
  ufc: "🥊",
  mma: "🥊",
  boxing: "🥊",
  nhl: "🏒",
  hockey: "🏒",
  nfl: "🏈",
  mlb: "⚾",
  baseball: "⚾",
};

function sportEmoji(sport: string | null): string {
  if (!sport) return "🎬";
  return SPORT_EMOJI[sport.toLowerCase()] ?? "🎬";
}

/** Days from today for an ISO timestamp (0 = today, 1 = tomorrow, <0 = past). */
function dayDelta(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startD = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((startD.getTime() - startToday.getTime()) / 86_400_000);
}

const timeFmt = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
const weekdayFmt = new Intl.DateTimeFormat("en-US", { weekday: "short" });

function timeLabel(iso: string | null): string {
  if (!iso) return "TBD";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "TBD";
  return timeFmt.format(d).toUpperCase();
}

function dayLabel(iso: string | null): string {
  const delta = dayDelta(iso);
  if (delta === null) return "Scheduled";
  if (delta === 0) return "Today";
  if (delta === 1) return "Tomorrow";
  const d = new Date(iso!);
  if (Number.isNaN(d.getTime())) return "Scheduled";
  return weekdayFmt.format(d);
}

function formatViewers(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function formatFee(cents: number): string {
  if (cents <= 0) return "FREE";
  return `€${(cents / 100).toFixed(0)} ENTRY`;
}

function matchTitle(m: PublicMatch): string {
  if (m.title.trim()) return m.title;
  const versus = [m.homeLabel, m.awayLabel].filter(Boolean).join(" vs ");
  return versus || "Untitled match";
}

const isLive = (m: PublicMatch) => m.status === "live" || m.status === "halftime";

export default function SchedulePage() {
  const { data: matches, isLoading } = useQuery(publicMatchesQuery());

  const [sportFilter, setSportFilter] = useState<string>("all");
  const [dayFilter, setDayFilter] = useState<DayFilter>("today");
  const [timezone, setTimezone] = useState("UTC -05:00");

  // Calendar state, anchored to the real current month.
  const today = new Date();
  const [calMonth, setCalMonth] = useState(today.getMonth());
  const [calYear, setCalYear] = useState(today.getFullYear());
  const [selectedDay, setSelectedDay] = useState<number | null>(today.getDate());

  // Distinct sports from real data, for the filter pills.
  const sports = useMemo(() => {
    const set = new Set<string>();
    (matches ?? []).forEach((m) => {
      if (m.sport && m.sport.trim()) set.add(m.sport);
    });
    return Array.from(set).sort();
  }, [matches]);

  // Days in the visible calendar month that have at least one scheduled match.
  const matchDays = useMemo(() => {
    const set = new Set<number>();
    (matches ?? []).forEach((m) => {
      if (!m.startsAt) return;
      const d = new Date(m.startsAt);
      if (Number.isNaN(d.getTime())) return;
      if (d.getFullYear() === calYear && d.getMonth() === calMonth) set.add(d.getDate());
    });
    return set;
  }, [matches, calYear, calMonth]);

  const passesDay = (m: PublicMatch): boolean => {
    if (isLive(m)) return true; // live matches are always relevant
    if (!m.startsAt) return dayFilter === "today"; // unscheduled-by-time surfaces under Today
    const delta = dayDelta(m.startsAt);
    if (delta === null) return dayFilter === "today";
    if (dayFilter === "today") return delta === 0;
    if (dayFilter === "tomorrow") return delta === 1;
    return delta >= 0 && delta <= 7;
  };

  const filtered = useMemo(() => {
    return (matches ?? []).filter((m) => {
      if (sportFilter !== "all" && m.sport !== sportFilter) return false;
      return passesDay(m);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches, sportFilter, dayFilter]);

  const liveMatches = useMemo(
    () => filtered.filter(isLive).sort((a, b) => b.viewerCount - a.viewerCount),
    [filtered],
  );

  // Scheduled matches grouped by start-time label, preserving chronological order.
  const grouped = useMemo(() => {
    const scheduled = filtered
      .filter((m) => m.status === "scheduled")
      .sort((a, b) => (a.startsAt ?? "").localeCompare(b.startsAt ?? ""));
    const map = new Map<string, PublicMatch[]>();
    for (const m of scheduled) {
      const key = timeLabel(m.startsAt);
      const arr = map.get(key);
      if (arr) arr.push(m);
      else map.set(key, [m]);
    }
    return Array.from(map.entries());
  }, [filtered]);

  // Sidebar feeds (drawn from all matches, ignoring the day filter).
  const liveEverywhere = useMemo(
    () => (matches ?? []).filter(isLive).sort((a, b) => b.viewerCount - a.viewerCount),
    [matches],
  );
  const upcoming = useMemo(
    () =>
      (matches ?? [])
        .filter((m) => m.status === "scheduled" && m.startsAt)
        .sort((a, b) => (a.startsAt ?? "").localeCompare(b.startsAt ?? ""))
        .slice(0, 4),
    [matches],
  );

  const totalViewers = useMemo(
    () => liveEverywhere.reduce((sum, m) => sum + m.viewerCount, 0),
    [liveEverywhere],
  );

  function handleSyncNow() {
    setDayFilter("today");
    setSportFilter("all");
    const now = new Date();
    setCalMonth(now.getMonth());
    setCalYear(now.getFullYear());
    setSelectedDay(now.getDate());
  }

  function shiftMonth(dir: -1 | 1) {
    let m = calMonth + dir;
    let y = calYear;
    if (m < 0) {
      m = 11;
      y -= 1;
    } else if (m > 11) {
      m = 0;
      y += 1;
    }
    setCalMonth(m);
    setCalYear(y);
  }

  // Build the calendar cell grid for the visible month.
  const calCells = useMemo(() => {
    const first = new Date(calYear, calMonth, 1).getDay(); // 0=Sun
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const cells: (number | null)[] = [];
    for (let i = 0; i < first; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    return cells;
  }, [calYear, calMonth]);

  const isCalToday =
    calYear === today.getFullYear() && calMonth === today.getMonth();

  return (
    <AppShell>
      <div className="bg-slate-950 min-h-screen text-slate-100 selection:bg-pink-500 selection:text-white">
        <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 space-y-6">
          {/* Page Headline */}
          <div>
            <h1 className="text-3xl font-black uppercase tracking-tight text-white sm:text-4xl">
              SCHEDULE
            </h1>
            <p className="text-sm text-slate-400 pt-1">
              See what's playing now and what's coming up in all lobbies.
            </p>
          </div>

          {/* Controls Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-4 backdrop-blur-md shadow-xl">
            <div className="flex flex-wrap items-center gap-4">
              {/* Sport filter (real sports from DB) */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-extrabold uppercase tracking-wider text-slate-400">
                  FILTER
                </span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <FilterPill
                    active={sportFilter === "all"}
                    onClick={() => setSportFilter("all")}
                    label="All Sports"
                    icon={<Sparkles className="h-3 w-3" />}
                  />
                  {sports.map((s) => (
                    <FilterPill
                      key={s}
                      active={sportFilter === s}
                      onClick={() => setSportFilter(s)}
                      label={`${sportEmoji(s)} ${s.toUpperCase()}`}
                    />
                  ))}
                  {sports.length === 0 && !isLoading && (
                    <span className="text-[11px] text-slate-500 italic">No sports yet</span>
                  )}
                </div>
              </div>

              {/* Day Filter Tabs */}
              <div className="flex items-center gap-1 bg-slate-950/90 rounded-xl p-1 border border-slate-800">
                {([
                  { id: "today", label: "TODAY" },
                  { id: "tomorrow", label: "TOMORROW" },
                  { id: "7days", label: "7 DAYS" },
                ] as const).map((d) => (
                  <button
                    key={d.id}
                    onClick={() => setDayFilter(d.id)}
                    className={`rounded-lg px-3 py-1 text-xs font-black transition-all ${
                      dayFilter === d.id
                        ? "bg-pink-600 text-white shadow-md"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Right Controls */}
            <div className="flex items-center gap-3">
              <div className="relative">
                <select
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="h-9 rounded-xl border border-slate-800 bg-slate-950 px-3 pr-8 text-xs font-bold text-slate-300 focus:border-pink-500 focus:outline-none appearance-none cursor-pointer"
                  aria-label="Timezone"
                >
                  <option value="UTC -05:00">TIMEZONE UTC -05:00</option>
                  <option value="UTC +00:00">TIMEZONE UTC +00:00</option>
                  <option value="UTC +06:00">TIMEZONE UTC +06:00</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              </div>

              <button
                type="button"
                onClick={handleSyncNow}
                className="flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-extrabold text-slate-200 hover:border-pink-500/50 hover:text-white transition-all"
              >
                <RotateCcw className="h-3.5 w-3.5 text-pink-400" />
                SYNC TO NOW
              </button>
            </div>
          </div>

          {/* Main Grid: schedule + sidebar */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Schedule column */}
            <div className="lg:col-span-9 space-y-5">
              <div className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900/80 px-5 py-3 shadow-xl backdrop-blur-md">
                <h2 className="text-sm font-extrabold uppercase tracking-wider text-white">
                  {sportFilter === "all" ? "ALL SPORTS" : sportFilter.toUpperCase()} ·{" "}
                  <span className="text-pink-400">{dayFilter.toUpperCase()}</span>
                </h2>
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-400">
                  <Users className="h-3.5 w-3.5 text-pink-400" />
                  <span>{formatViewers(totalViewers)} WATCHING NOW</span>
                </div>
              </div>

              {isLoading ? (
                <ScheduleSkeleton />
              ) : liveMatches.length === 0 && grouped.length === 0 ? (
                <EmptyState />
              ) : (
                <>
                  {/* LIVE NOW band */}
                  {liveMatches.length > 0 && (
                    <section className="space-y-3">
                      <SectionHeader
                        icon={<Radio className="h-4 w-4 text-rose-500" />}
                        label="LIVE NOW"
                        count={liveMatches.length}
                        tone="rose"
                      />
                      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                        {liveMatches.map((m) => (
                          <MatchCard key={m.id} m={m} />
                        ))}
                      </div>
                    </section>
                  )}

                  {/* Scheduled, grouped by start time */}
                  {grouped.map(([time, rows]) => (
                    <section key={time} className="space-y-3">
                      <SectionHeader label={time} count={rows.length} />
                      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                        {rows.map((m) => (
                          <MatchCard key={m.id} m={m} />
                        ))}
                      </div>
                    </section>
                  ))}
                </>
              )}
            </div>

            {/* Sidebar */}
            <div className="lg:col-span-3 space-y-4">
              {/* Calendar */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-xl backdrop-blur-md space-y-3">
                <div className="flex items-center justify-between text-xs font-bold text-white">
                  <button
                    type="button"
                    onClick={() => shiftMonth(-1)}
                    className="text-slate-400 hover:text-white"
                    aria-label="Previous month"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="uppercase tracking-wider">
                    {MONTHS[calMonth]} {calYear}
                  </span>
                  <button
                    type="button"
                    onClick={() => shiftMonth(1)}
                    className="text-slate-400 hover:text-white"
                    aria-label="Next month"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>

                <div className="grid grid-cols-7 text-center text-[10px] font-extrabold text-slate-400">
                  {["SU", "MO", "TU", "WE", "TH", "FR", "SA"].map((d) => (
                    <span key={d}>{d}</span>
                  ))}
                </div>

                <div className="grid grid-cols-7 text-center text-xs font-bold gap-1">
                  {calCells.map((d, i) => {
                    if (d === null) return <span key={`b${i}`} />;
                    const isSelected = selectedDay === d;
                    const isToday = isCalToday && today.getDate() === d;
                    const hasMatch = matchDays.has(d);
                    return (
                      <button
                        key={d}
                        onClick={() => setSelectedDay(d)}
                        className={`relative h-8 w-8 rounded-lg flex items-center justify-center transition-all ${
                          isSelected
                            ? "border-2 border-pink-500 bg-pink-500/20 text-white font-black"
                            : isToday
                              ? "bg-slate-800 text-white"
                              : "text-slate-300 hover:bg-slate-800"
                        }`}
                      >
                        {d}
                        {hasMatch && (
                          <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-pink-400" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Live Now in all lobbies */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-xl backdrop-blur-md space-y-3">
                <h3 className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-white border-b border-slate-800 pb-2">
                  <Radio className="h-3.5 w-3.5 text-rose-500" />
                  LIVE NOW
                </h3>
                <div className="space-y-2">
                  {liveEverywhere.length === 0 ? (
                    <p className="text-[11px] text-slate-500 italic py-1">
                      No live games right now.
                    </p>
                  ) : (
                    liveEverywhere.map((m) => (
                      <Link
                        key={m.id}
                        to="/arena/$matchId"
                        params={{ matchId: m.id }}
                        className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950 p-2 text-xs font-bold text-white hover:border-pink-500/40"
                      >
                        <span className="truncate pr-2">{matchTitle(m)}</span>
                        <span className="rounded bg-rose-600 px-1.5 py-0.5 text-[9px] font-extrabold text-white shrink-0">
                          LIVE
                        </span>
                      </Link>
                    ))
                  )}
                </div>
              </div>

              {/* Upcoming Highlights */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-xl backdrop-blur-md space-y-3">
                <h3 className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-white border-b border-slate-800 pb-2">
                  <CalendarDays className="h-3.5 w-3.5 text-pink-400" />
                  UPCOMING HIGHLIGHTS
                </h3>
                <div className="space-y-2.5">
                  {upcoming.length === 0 ? (
                    <p className="text-[11px] text-slate-500 italic py-1">
                      Nothing scheduled yet.
                    </p>
                  ) : (
                    upcoming.map((m) => (
                      <Link
                        key={m.id}
                        to="/arena/$matchId"
                        params={{ matchId: m.id }}
                        className="block rounded-xl border border-slate-800 bg-slate-950 p-2.5 hover:border-pink-500/40"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-white text-xs truncate">
                            {sportEmoji(m.sport)} {matchTitle(m)}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400 pt-0.5">
                          {dayLabel(m.startsAt)} · {timeLabel(m.startsAt)}
                        </div>
                      </Link>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function FilterPill({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-xl border px-3 py-1.5 text-xs font-black transition-all ${
        active
          ? "border-pink-500 bg-pink-500/10 text-white shadow-lg shadow-pink-500/20 ring-1 ring-pink-500/40"
          : "border-slate-800 bg-slate-950/80 text-slate-400 hover:border-slate-700 hover:text-white"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function SectionHeader({
  icon,
  label,
  count,
  tone = "slate",
}: {
  icon?: React.ReactNode;
  label: string;
  count?: number;
  tone?: "slate" | "rose";
}) {
  const accent = tone === "rose" ? "text-rose-500" : "text-slate-300";
  return (
    <div className="flex items-center justify-between border-b border-slate-800/70 pb-2">
      <h3 className={`flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider ${accent}`}>
        {icon}
        {label}
      </h3>
      {count !== undefined && (
        <span className="text-[10px] font-bold text-slate-500">{count} match{count === 1 ? "" : "es"}</span>
      )}
    </div>
  );
}

function MatchCard({ m }: { m: PublicMatch }) {
  const live = isLive(m);
  const visibleSlots = m.slots.filter((s) => s.channelLogo || s.channelName).slice(0, 4);

  return (
    <Link
      to="/arena/$matchId"
      params={{ matchId: m.id }}
      className="group flex flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/80 shadow-lg backdrop-blur-md transition-all duration-300 hover:border-pink-500/50 hover:shadow-xl hover:shadow-pink-500/10"
    >
      {/* Thumbnail banner */}
      <div className="relative aspect-video overflow-hidden bg-slate-950">
        {m.thumbnailUrl ? (
          <img
            src={m.thumbnailUrl}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-900 to-slate-950">
            <span className="text-3xl">{sportEmoji(m.sport)}</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/30 to-transparent" />

        {/* Top-left status badge */}
        <div className="absolute top-2 left-2 flex items-center gap-1.5">
          {live ? (
            <span className="inline-flex items-center gap-1 rounded bg-rose-600 px-1.5 py-0.5 text-[9px] font-black text-white uppercase shadow">
              <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
              LIVE
            </span>
          ) : (
            <span className="rounded bg-slate-950/80 px-1.5 py-0.5 text-[9px] font-bold text-slate-300 uppercase backdrop-blur-sm">
              {sportEmoji(m.sport)} {m.sport ?? "SPORT"}
            </span>
          )}
        </div>

        {/* Top-right viewers */}
        <div className="absolute top-2 right-2 flex items-center gap-1 rounded bg-slate-950/80 px-1.5 py-0.5 text-[10px] font-bold text-slate-200 backdrop-blur-sm">
          <Users className="h-3 w-3 text-pink-400" />
          {formatViewers(m.viewerCount)}
        </div>

        {/* Bottom time / clock */}
        <div className="absolute bottom-2 left-2 text-[10px] font-bold text-slate-200">
          {live ? "In Progress" : `${dayLabel(m.startsAt)} at ${timeLabel(m.startsAt)}`}
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="font-extrabold text-sm text-white group-hover:text-pink-400 transition-colors line-clamp-1">
          {matchTitle(m)}
        </div>


        {/* Channel slot logos (admin-uploaded) */}
        {visibleSlots.length > 0 && (
          <div className="flex items-center gap-1.5">
            {visibleSlots.map((s) => (
              <div
                key={s.slot}
                title={s.channelName ?? `Slot ${s.slot}`}
                className="flex h-7 w-7 items-center justify-center overflow-hidden rounded border border-slate-800 bg-slate-950"
              >
                {s.channelLogo ? (
                  <img
                    src={s.channelLogo}
                    alt=""
                    loading="lazy"
                    className="max-h-full max-w-full object-contain"
                  />
                ) : (
                  <span className="text-[8px] font-bold text-slate-500">
                    {(s.channelName ?? `S${s.slot}`).slice(0, 2).toUpperCase()}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="mt-auto flex items-center justify-between pt-1">
          <span className="text-[10px] uppercase tracking-wider text-slate-400">
            {m.hostDisplayName ? `Hosted by ${m.hostDisplayName}` : m.sport ?? "Sports"}
          </span>
          <span
            className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-extrabold ${
              m.entryFeeCents > 0
                ? "border-pink-500/40 bg-pink-500/10 text-pink-300"
                : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
            }`}
          >
            <Ticket className="h-3 w-3" />
            {formatFee(m.entryFeeCents)}
          </span>
        </div>
      </div>
    </Link>
  );
}

function ScheduleSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60"
        >
          <div className="aspect-video w-full animate-pulse bg-slate-800/60" />
          <div className="space-y-2 p-3">
            <div className="h-3 w-3/4 animate-pulse rounded bg-slate-800/60" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-slate-800/60" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 px-6 py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-700 bg-slate-800/60 text-slate-500">
        <CalendarDays className="h-7 w-7" />
      </div>
      <div>
        <h3 className="text-sm font-extrabold uppercase tracking-wider text-white">
          No matches found
        </h3>
        <p className="mt-1 text-xs text-slate-400 max-w-sm">
          There are no {`"live"`} or scheduled games for this filter yet. Try another
          day, or check back closer to tip-off.
        </p>
      </div>
      <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
        <ImageIcon className="h-3.5 w-3.5" />
        Admins can add matches + thumbnails from the Arena admin.
      </div>
    </div>
  );
}
