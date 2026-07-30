import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDown,
  ArrowUp,
  Building2,
  Calendar,
  ChevronDown,
  CircleDollarSign,
  Users,
  Video,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ---------- helpers ----------
function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

const money = (cents: number) =>
  new Intl.NumberFormat("en-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format((cents ?? 0) / 100);

function shortDay(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function timeAgo(iso: string | null) {
  if (!iso) return "—";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// ---------- data ----------
type DashboardStats = {
  lobbies_today: number;
  lobbies_yesterday: number;
  live_lobbies_now: number;
  live_lobbies_prev_24h: number;
  users_today: number;
  users_yesterday: number;
  active_users_24h: number;
  active_users_prev_24h: number;
  revenue_today_cents: number;
  revenue_yesterday_cents: number;
};

function useAdminDashboard() {
  return useQuery({
    queryKey: ["admin", "dashboard-v2"],
    queryFn: async () => {
      const since30 = daysAgo(29).toISOString();
      const since24h = new Date(Date.now() - 24 * 3600_000).toISOString();

      const [matches, profiles, sessions, wallet, stats] = await Promise.all([
        supabase
          .from("matches")
          .select("id,title,sport,status,home_label,away_label,starts_at,created_at,thumbnail_url")
          .order("created_at", { ascending: false })
          .limit(20),
        supabase.from("profiles").select("id,created_at"),
        supabase.from("lounge_sessions").select("id,user_id,created_at").gte("created_at", since30),
        supabase
          .from("wallet_transactions")
          .select("id,type,amount_cents,created_at")
          .gte("created_at", since30),
        supabase.rpc("admin_dashboard_stats"),
      ]);

      const statsRow = (stats.data as DashboardStats[] | null)?.[0] ?? null;

      const matchIds = (matches.data ?? []).map((m) => m.id);
      const viewers: Record<string, number> = {};
      if (matchIds.length > 0) {
        const { data: vc } = await supabase.rpc("admin_match_viewer_counts", {
          _match_ids: matchIds,
        });
        for (const row of (vc as Array<{ match_id: string; viewers_24h: number }> | null) ?? []) {
          viewers[row.match_id] = row.viewers_24h;
        }
      }

      return {
        matches: matches.data ?? [],
        profiles: profiles.data ?? [],
        sessions: sessions.data ?? [],
        wallet: wallet.data ?? [],
        stats: statsRow,
        viewers,
        since24h,
      };
    },
    refetchInterval: 30_000,
  });
}

// Format a delta value with sign and label.
function formatDelta(
  current: number,
  previous: number,
  opts: { asPercent?: boolean; asMoney?: boolean } = {},
): { text: string; positive: boolean; neutral: boolean } {
  if (previous === 0 && current === 0) {
    return { text: "0", positive: true, neutral: true };
  }
  if (opts.asPercent) {
    if (previous === 0) return { text: "new", positive: true, neutral: false };
    const pct = ((current - previous) / previous) * 100;
    return {
      text: `${Math.abs(pct).toFixed(1)}%`,
      positive: pct >= 0,
      neutral: false,
    };
  }
  const diff = current - previous;
  const abs = Math.abs(diff);
  const text = opts.asMoney ? money(abs) : abs.toLocaleString();
  return { text, positive: diff >= 0, neutral: diff === 0 };
}

function buildRevenueSeries(
  wallet: Array<{ created_at: string; type: string; amount_cents: number }>,
  days: number,
) {
  const buckets = new Map<string, { date: string; revenueCents: number }>();
  for (let i = days - 1; i >= 0; i--) {
    const key = daysAgo(i).toISOString().slice(0, 10);
    buckets.set(key, { date: key, revenueCents: 0 });
  }
  for (const w of wallet) {
    if (
      w.type === "debit_lounge_entry" ||
      w.type === "debit_match_entry" ||
      w.type === "debit_vip_upgrade" ||
      w.type === "debit_tip"
    ) {
      const key = w.created_at.slice(0, 10);
      const b = buckets.get(key);
      if (b) b.revenueCents += Math.abs(w.amount_cents ?? 0);
    }
  }
  return Array.from(buckets.values());
}

// ---------- primitives ----------
function KpiCard({
  icon: Icon,
  label,
  value,
  delta,
  deltaLabel,
  accent,
  glow,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  delta?: { text: string; positive: boolean; neutral: boolean };
  deltaLabel?: string;
  accent: string;
  glow: string;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-arena-border bg-arena-panel p-5",
        "transition hover:border-white/20",
      )}
    >
      <div className={cn("pointer-events-none absolute inset-0 -z-10 opacity-40", glow)} />
      <div className="flex items-start gap-3">
        <div
          className={cn("grid h-12 w-12 shrink-0 place-items-center rounded-full ring-1", accent)}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            {label}
          </div>
          <div className="mt-1 font-display text-3xl font-extrabold tracking-tight text-white">
            {value}
          </div>
        </div>
      </div>
      {(delta || deltaLabel) && (
        <div className="mt-3 flex items-center gap-2 text-[11px]">
          {delta && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 font-bold",
                delta.neutral
                  ? "text-muted-foreground"
                  : delta.positive
                    ? "text-emerald-400"
                    : "text-rose-400",
              )}
            >
              {delta.neutral ? (
                <span className="opacity-60">—</span>
              ) : delta.positive ? (
                <ArrowUp className="h-3 w-3" />
              ) : (
                <ArrowDown className="h-3 w-3" />
              )}
              {delta.text}
            </span>
          )}
          {deltaLabel && <span className="text-muted-foreground">{deltaLabel}</span>}
        </div>
      )}
    </div>
  );
}

function Panel({
  title,
  action,
  children,
  className,
}: {
  title: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-2xl border border-arena-border bg-arena-panel p-5", className)}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="font-display text-lg font-bold text-white">{title}</div>
        {action}
      </div>
      {children}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const isLive = status === "live";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider",
        isLive ? "bg-emerald-500/15 text-emerald-400" : "bg-muted/40 text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          isLive ? "bg-emerald-400 animate-pulse" : "bg-muted-foreground",
        )}
      />
      {status?.toUpperCase() || "—"}
    </span>
  );
}

function MatchThumb({ url, label }: { url: string | null; label: string }) {
  if (url) {
    return (
      <img
        src={url}
        alt={label}
        className="h-8 w-12 rounded-md object-cover ring-1 ring-arena-border"
        loading="lazy"
      />
    );
  }
  return (
    <div className="grid h-8 w-12 place-items-center rounded-md bg-gradient-to-br from-arena-violet/30 to-arena-pink/30 text-[10px] font-bold uppercase text-white/70 ring-1 ring-arena-border">
      {label.slice(0, 3)}
    </div>
  );
}

// ---------- main ----------
export function AdminDashboard() {
  const { data, isLoading, error } = useAdminDashboard();
  const [revenueRange, setRevenueRange] = useState<"week" | "month">("week");
  const [revenueBySrcRange, setRevenueBySrcRange] = useState<"week" | "month">("week");

  const derived = useMemo(() => {
    if (!data) return null;

    const totalMatches = data.matches.length;
    const liveMatches = data.matches.filter((m) => m.status === "live");
    const totalUsers = data.profiles.length;
    const activeUsers = new Set(
      data.sessions.filter((s) => s.created_at >= data.since24h).map((s) => s.user_id),
    ).size;
    const revenue30d = data.wallet
      .filter(
        (w) =>
          w.type === "debit_lounge_entry" ||
          w.type === "debit_match_entry" ||
          w.type === "debit_vip_upgrade" ||
          w.type === "debit_tip",
      )
      .reduce((sum, w) => sum + Math.abs(w.amount_cents ?? 0), 0);

    const days = revenueRange === "week" ? 7 : 30;
    const series = buildRevenueSeries(data.wallet, days);

    // Revenue by source — real from wallet, categorized
    const bySource = {
      lounge_entry: 0,
      match_entry: 0,
      tips: 0,
      vip: 0,
      other: 0,
    };
    for (const w of data.wallet) {
      const amt = Math.abs(w.amount_cents ?? 0);
      if (w.type === "debit_lounge_entry") bySource.lounge_entry += amt;
      else if (w.type === "debit_match_entry") bySource.match_entry += amt;
      else if (w.type === "debit_tip") bySource.tips += amt;
      else if (w.type === "debit_vip_upgrade") bySource.vip += amt;
    }
    const sourceTotal =
      bySource.lounge_entry + bySource.match_entry + bySource.tips + bySource.vip + bySource.other;
    const sourceRows = [
      {
        key: "lounge",
        label: "Lounge Entry Fees",
        cents: bySource.lounge_entry,
        color: "#8b5cf6",
      },
      {
        key: "match",
        label: "Match Entry Fees",
        cents: bySource.match_entry,
        color: "#3b82f6",
      },
      { key: "tips", label: "Tips", cents: bySource.tips, color: "#ec4899" },
      { key: "vip", label: "VIP Memberships", cents: bySource.vip, color: "#a78bfa" },
      { key: "other", label: "Other", cents: bySource.other, color: "#f59e0b" },
    ];

    // Real deltas from the RPC (fall back to zero-neutral if unavailable).
    const s = data.stats;
    const deltas = {
      lobbies: formatDelta(s?.lobbies_today ?? 0, s?.lobbies_yesterday ?? 0),
      live: formatDelta(s?.live_lobbies_now ?? 0, s?.live_lobbies_prev_24h ?? 0),
      users: formatDelta(s?.users_today ?? 0, s?.users_yesterday ?? 0),
      active: formatDelta(s?.active_users_24h ?? 0, s?.active_users_prev_24h ?? 0),
      revenue: formatDelta(s?.revenue_today_cents ?? 0, s?.revenue_yesterday_cents ?? 0, {
        asPercent: true,
      }),
    };

    return {
      totalMatches,
      liveMatches,
      totalUsers,
      activeUsers,
      revenue30d,
      series,
      sourceRows,
      sourceTotal,
      recentMatches: data.matches.slice(0, 5),
      viewers: data.viewers,
      deltas,
    };
  }, [data, revenueRange]);

  if (isLoading || !derived) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-2xl border border-arena-border bg-arena-panel/60"
            />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="h-72 animate-pulse rounded-2xl border border-arena-border bg-arena-panel/60" />
          <div className="h-72 animate-pulse rounded-2xl border border-arena-border bg-arena-panel/60" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
        Failed to load dashboard data.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold uppercase tracking-tight text-white">
            Admin Dashboard
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Welcome back, Admin 👑</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled
            className="inline-flex items-center gap-2 rounded-lg border border-arena-border bg-arena-panel px-3 py-2 text-xs font-medium text-white/80"
          >
            <Calendar className="h-4 w-4" />
            {new Date().toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
            <ChevronDown className="h-3.5 w-3.5 opacity-60" />
          </button>
          <Select value="all">
            <SelectTrigger className="h-9 w-[130px] rounded-lg border border-arena-border bg-arena-panel text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Time</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="7d">Last 7 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
        <KpiCard
          icon={Users}
          label="Total Lobbies"
          value={String(derived.totalMatches)}
          delta={derived.deltas.lobbies}
          deltaLabel="vs yesterday"
          accent="bg-arena-violet/15 text-arena-violet ring-arena-violet/30"
          glow="bg-[radial-gradient(circle_at_top_left,rgba(139,92,246,0.25),transparent_60%)]"
        />
        <KpiCard
          icon={Video}
          label="Live Lobbies"
          value={String(derived.liveMatches.length)}
          delta={derived.deltas.live}
          deltaLabel="vs yesterday"
          accent="bg-arena-pink/15 text-arena-pink ring-arena-pink/30"
          glow="bg-[radial-gradient(circle_at_top_left,rgba(236,72,153,0.25),transparent_60%)]"
        />
        <KpiCard
          icon={Users}
          label="Total Users"
          value={derived.totalUsers.toLocaleString()}
          delta={derived.deltas.users}
          deltaLabel="vs yesterday"
          accent="bg-arena-cyan/15 text-arena-cyan ring-arena-cyan/30"
          glow="bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.25),transparent_60%)]"
        />
        <KpiCard
          icon={Users}
          label="Active Users"
          value={derived.activeUsers.toLocaleString()}
          delta={derived.deltas.active}
          deltaLabel="vs yesterday"
          accent="bg-emerald-500/15 text-emerald-400 ring-emerald-500/30"
          glow="bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.25),transparent_60%)]"
        />
        <KpiCard
          icon={CircleDollarSign}
          label="Total Revenue"
          value={money(derived.revenue30d)}
          delta={derived.deltas.revenue}
          deltaLabel="vs yesterday"
          accent="bg-amber-500/15 text-amber-400 ring-amber-500/30"
          glow="bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.25),transparent_60%)]"
        />
      </div>

      {/* Recent + Live lobbies */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Recent Lobbies"
          action={
            <Link
              to="/admin/lounges"
              className="text-xs font-semibold text-arena-violet hover:text-arena-pink"
            >
              View All
            </Link>
          }
        >
          {derived.recentMatches.length === 0 ? (
            <div className="rounded-lg border border-dashed border-arena-border p-6 text-center text-xs text-muted-foreground">
              No matches yet.
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg">
              <div className="grid grid-cols-[1.6fr_0.6fr_0.7fr_0.7fr_0.6fr_0.6fr] gap-2 border-b border-arena-border/60 pb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                <div>Lobby Name</div>
                <div>Sport</div>
                <div>Lobby #</div>
                <div>Status</div>
                <div>Viewers</div>
                <div>Started</div>
              </div>
              <ul className="divide-y divide-arena-border/60">
                {derived.recentMatches.map((m, i) => (
                  <li
                    key={m.id}
                    className="grid grid-cols-[1.6fr_0.6fr_0.7fr_0.7fr_0.6fr_0.6fr] items-center gap-2 py-2.5 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <MatchThumb url={m.thumbnail_url} label={m.title} />
                      <span className="truncate text-white font-medium">{m.title}</span>
                    </div>
                    <div className="uppercase text-muted-foreground">{m.sport ?? "—"}</div>
                    <div className="font-mono text-muted-foreground">
                      LBY-{m.id.slice(0, 6).toUpperCase()}
                    </div>
                    <div>
                      <StatusPill status={m.status} />
                    </div>
                    <div className="font-mono text-white/80">
                      {(derived.viewers[m.id] ?? 0).toLocaleString()}
                    </div>

                    <div className="text-muted-foreground">{timeAgo(m.created_at)}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>

        <Panel
          title={
            <span className="flex items-center gap-2">
              Live Lobbies
              <span className="text-xs font-normal text-muted-foreground">(Real Time)</span>
            </span>
          }
          action={
            <Link
              to="/admin/lounges"
              className="text-xs font-semibold text-arena-violet hover:text-arena-pink"
            >
              View All
            </Link>
          }
        >
          {derived.liveMatches.length === 0 ? (
            <div className="rounded-lg border border-dashed border-arena-border p-6 text-center text-xs text-muted-foreground">
              No live matches right now.
            </div>
          ) : (
            <ul className="space-y-3">
              {derived.liveMatches.slice(0, 5).map((m) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between rounded-lg border border-arena-border/60 bg-arena-bg/40 px-3 py-2.5"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <MatchThumb url={m.thumbnail_url} label={m.home_label ?? m.title} />
                    <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                      vs
                    </span>
                    <MatchThumb
                      url={null}
                      label={m.away_label ?? m.title.split(" ").pop() ?? "TBD"}
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-arena-pink/20 px-2 py-0.5 text-[11px] font-bold uppercase text-arena-pink">
                      <span className="h-1.5 w-1.5 rounded-full bg-arena-pink animate-pulse" />
                      Live
                    </span>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Users className="h-3.5 w-3.5" />
                      {(derived.viewers[m.id] ?? 0).toLocaleString()} watching
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* Revenue overview + by source */}
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Panel
          title="Revenue Overview"
          action={
            <Select
              value={revenueRange}
              onValueChange={(v) => setRevenueRange(v as "week" | "month")}
            >
              <SelectTrigger className="h-8 w-[120px] rounded-lg border border-arena-border bg-arena-bg text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="week">This Week</SelectItem>
                <SelectItem value="month">This Month</SelectItem>
              </SelectContent>
            </Select>
          }
        >
          <div className="mb-4">
            <div className="font-display text-3xl font-extrabold text-white">
              {money(derived.revenue30d)}
            </div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Total Revenue
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={derived.series} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.55} />
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="date"
                  stroke="#6b7280"
                  tick={{ fontSize: 11, fill: "#9ca3af" }}
                  tickFormatter={shortDay}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  stroke="#6b7280"
                  tick={{ fontSize: 11, fill: "#9ca3af" }}
                  tickFormatter={(v) => `€${Math.round(v / 100)}`}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                />
                <Tooltip
                  contentStyle={{
                    background: "hsl(240 10% 8%)",
                    border: "1px solid hsl(240 6% 20%)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(v: number) => money(v)}
                  labelFormatter={(l) => shortDay(String(l))}
                />
                <Area
                  type="monotone"
                  dataKey="revenueCents"
                  stroke="#8b5cf6"
                  strokeWidth={2.5}
                  fill="url(#revFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel
          title="Revenue by Source"
          action={
            <Select
              value={revenueBySrcRange}
              onValueChange={(v) => setRevenueBySrcRange(v as "week" | "month")}
            >
              <SelectTrigger className="h-8 w-[120px] rounded-lg border border-arena-border bg-arena-bg text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="week">This Week</SelectItem>
                <SelectItem value="month">This Month</SelectItem>
              </SelectContent>
            </Select>
          }
        >
          <div className="flex items-center gap-4">
            <div className="relative h-44 w-44 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={
                      derived.sourceTotal === 0
                        ? [{ label: "no data", cents: 1, color: "#374151" }]
                        : derived.sourceRows.filter((r) => r.cents > 0)
                    }
                    dataKey="cents"
                    nameKey="label"
                    innerRadius={52}
                    outerRadius={80}
                    paddingAngle={2}
                    stroke="none"
                  >
                    {(derived.sourceTotal === 0
                      ? [{ color: "#374151" }]
                      : derived.sourceRows.filter((r) => r.cents > 0)
                    ).map((r, i) => (
                      <Cell key={i} fill={r.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
                <div>
                  <div className="font-display text-sm font-extrabold text-white">
                    {money(derived.sourceTotal)}
                  </div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    Total
                  </div>
                </div>
              </div>
            </div>
            <ul className="flex-1 space-y-2 text-xs">
              {derived.sourceRows.map((r) => {
                const pct = derived.sourceTotal
                  ? Math.round((r.cents / derived.sourceTotal) * 100)
                  : 0;
                return (
                  <li key={r.key} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 truncate">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: r.color }}
                      />
                      <span className="truncate text-white/85">{r.label}</span>
                    </span>
                    <span className="flex items-center gap-2 font-mono text-white/80">
                      {money(r.cents)}
                      <span className="text-muted-foreground">({pct}%)</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </Panel>
      </div>

      {/* Footer quick links */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Link
          to="/admin/lounges"
          className="rounded-xl border border-arena-border bg-arena-panel px-4 py-3 text-xs font-semibold uppercase tracking-wider text-white/80 transition hover:border-arena-violet/60 hover:text-white"
        >
          <Building2 className="mb-1.5 h-4 w-4 text-arena-violet" />
          Manage Lounges
        </Link>
        <Link
          to="/admin/tvs"
          className="rounded-xl border border-arena-border bg-arena-panel px-4 py-3 text-xs font-semibold uppercase tracking-wider text-white/80 transition hover:border-arena-pink/60 hover:text-white"
        >
          <Video className="mb-1.5 h-4 w-4 text-arena-pink" />
          Manage TVs &amp; IPTV
        </Link>
        <Link
          to="/admin/users"
          className="rounded-xl border border-arena-border bg-arena-panel px-4 py-3 text-xs font-semibold uppercase tracking-wider text-white/80 transition hover:border-arena-cyan/60 hover:text-white"
        >
          <Users className="mb-1.5 h-4 w-4 text-arena-cyan" />
          Manage Users
        </Link>
        <Link
          to="/admin/wallet-ledger"
          className="rounded-xl border border-arena-border bg-arena-panel px-4 py-3 text-xs font-semibold uppercase tracking-wider text-white/80 transition hover:border-amber-500/60 hover:text-white"
        >
          <CircleDollarSign className="mb-1.5 h-4 w-4 text-amber-400" />
          Wallet Ledger
        </Link>
      </div>
    </div>
  );
}
