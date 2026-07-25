import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { formatDistanceToNow } from "date-fns";
import { Activity, CheckCircle2, XCircle, HelpCircle, Timer, Tv, Waves } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  AdminEmptyBlock,
  AdminEmptyRow,
  AdminLoadingBlock,
  AdminLoadingRow,
} from "@/components/admin/AdminStates";

const RANGES = {
  "1h": { label: "Last hour", ms: 3600_000 },
  "24h": { label: "Last 24h", ms: 24 * 3600_000 },
  "7d": { label: "Last 7 days", ms: 7 * 24 * 3600_000 },
} as const;
type RangeKey = keyof typeof RANGES;

const searchSchema = z.object({
  lounge: fallback(z.string(), "all").default("all"),
  range: fallback(z.enum(["1h", "24h", "7d"]), "24h").default("24h"),
});

export const Route = createFileRoute("/admin/health")({
  validateSearch: zodValidator(searchSchema),
  component: HealthPage,
});

type TvRow = {
  id: string;
  display_name: string | null;
  slot: number;
  enabled: boolean;
  status: string;
  last_status_message: string | null;
  last_checked_at: string | null;
  lounge_id: string;
  selected_channel_name: string | null;
};

type LoungeRow = { id: string; name: string };

type HealthRow = {
  id: number;
  tv_id: string;
  status: string;
  latency_ms: number | null;
  error: string | null;
  checked_at: string;
};

function HealthPage() {
  const { lounge, range } = Route.useSearch();
  const navigate = Route.useNavigate();

  const loungesQuery = useQuery({
    queryKey: ["admin", "health", "lounges"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lounges")
        .select("id, name")
        .order("name");
      if (error) throw error;
      return (data ?? []) as LoungeRow[];
    },
  });

  const tvsQuery = useQuery({
    queryKey: ["admin", "health", "tvs", lounge],
    queryFn: async () => {
      let q = supabase
        .from("tvs")
        .select(
          "id, display_name, slot, enabled, status, last_status_message, last_checked_at, lounge_id, selected_channel_name",
        )
        .order("lounge_id")
        .order("slot");
      if (lounge !== "all") q = q.eq("lounge_id", lounge);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as TvRow[];
    },
    refetchInterval: 30_000,
  });

  const sinceIso = useMemo(
    () => new Date(Date.now() - RANGES[range as RangeKey].ms).toISOString(),
    [range],
  );

  const tvIds = useMemo(() => (tvsQuery.data ?? []).map((t) => t.id), [tvsQuery.data]);

  const healthQuery = useQuery({
    queryKey: ["admin", "health", "log", lounge, range, tvIds.length],
    enabled: tvIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stream_health_log")
        .select("id, tv_id, status, latency_ms, error, checked_at")
        .in("tv_id", tvIds)
        .gte("checked_at", sinceIso)
        .order("checked_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as HealthRow[];
    },
    refetchInterval: 30_000,
  });

  const loungeName = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of loungesQuery.data ?? []) map.set(l.id, l.name);
    return map;
  }, [loungesQuery.data]);

  const tvName = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of tvsQuery.data ?? []) {
      map.set(t.id, t.display_name ?? `TV ${t.slot}`);
    }
    return map;
  }, [tvsQuery.data]);

  // Per-TV rollups over the selected window.
  const rollups = useMemo(() => {
    const rows = healthQuery.data ?? [];
    const map = new Map<string, { total: number; online: number; sumLatency: number; latencySamples: number }>();
    for (const r of rows) {
      const bucket = map.get(r.tv_id) ?? { total: 0, online: 0, sumLatency: 0, latencySamples: 0 };
      bucket.total += 1;
      if (r.status === "online") bucket.online += 1;
      if (typeof r.latency_ms === "number") {
        bucket.sumLatency += r.latency_ms;
        bucket.latencySamples += 1;
      }
      map.set(r.tv_id, bucket);
    }
    return map;
  }, [healthQuery.data]);

  const currentCounts = useMemo(() => {
    const rows = tvsQuery.data ?? [];
    return {
      total: rows.length,
      online: rows.filter((t) => t.status === "online" && t.enabled).length,
      offline: rows.filter((t) => t.status === "offline").length,
      unknown: rows.filter((t) => t.status !== "online" && t.status !== "offline").length,
    };
  }, [tvsQuery.data]);

  function setLounge(v: string) {
    void navigate({ search: (prev: z.infer<typeof searchSchema>) => ({ ...prev, lounge: v }) });
  }
  function setRange(v: RangeKey) {
    void navigate({ search: (prev: z.infer<typeof searchSchema>) => ({ ...prev, range: v }) });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold">Stream Health</h2>
          <p className="text-xs text-muted-foreground">
            Runs automatically every 2 minutes. Filter by lounge and window.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-muted-foreground">Lounge</label>
          <select
            className="rounded-md border border-arena-border bg-arena-panel-2/60 px-3 py-1.5 text-sm"
            value={lounge}
            onChange={(e) => setLounge(e.target.value)}
          >
            <option value="all">All lounges</option>
            {(loungesQuery.data ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <div className="ml-2 flex overflow-hidden rounded-md border border-arena-border">
            {(Object.keys(RANGES) as RangeKey[]).map((k) => (
              <button
                key={k}
                onClick={() => setRange(k)}
                className={cn(
                  "px-3 py-1.5 text-xs font-semibold transition",
                  range === k
                    ? "bg-primary text-primary-foreground"
                    : "bg-arena-panel-2/60 text-muted-foreground hover:bg-arena-panel-2",
                )}
              >
                {RANGES[k].label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <SummaryCard icon={Activity} label="Enabled TVs" value={currentCounts.total} />
        <SummaryCard icon={CheckCircle2} label="Online" value={currentCounts.online} tone="success" />
        <SummaryCard icon={XCircle} label="Offline" value={currentCounts.offline} tone="danger" />
        <SummaryCard icon={HelpCircle} label="Unknown" value={currentCounts.unknown} tone="muted" />
      </div>

      <div className="arena-card rounded-xl">
        <div className="border-b border-arena-border p-4">
          <h3 className="font-semibold">TVs</h3>
        </div>
        <div className="divide-y divide-arena-border/60">
          {tvsQuery.isLoading && <AdminLoadingBlock label="Loading TVs…" />}
          {!tvsQuery.isLoading && (tvsQuery.data?.length ?? 0) === 0 && (
            <AdminEmptyBlock
              icon={Tv}
              title="No TVs match this filter"
              description="Try switching lounge or widening the time range."
            />
          )}
          {(tvsQuery.data ?? []).map((tv) => {
            const roll = rollups.get(tv.id);
            const uptime = roll && roll.total > 0 ? Math.round((roll.online / roll.total) * 100) : null;
            const avgLatency = roll && roll.latencySamples > 0 ? Math.round(roll.sumLatency / roll.latencySamples) : null;
            return (
              <div key={tv.id} className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <StatusPill status={tv.status} enabled={tv.enabled} />
                    <span className="truncate text-sm font-semibold">
                      {tv.display_name ?? `TV ${tv.slot}`}
                    </span>
                    <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                      Slot {tv.slot} · {loungeName.get(tv.lounge_id) ?? "—"}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {tv.selected_channel_name ?? "No channel"}
                    {tv.last_status_message && ` · ${tv.last_status_message}`}
                    {tv.last_checked_at && (
                      <> · checked {formatDistanceToNow(new Date(tv.last_checked_at), { addSuffix: true })}</>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Uptime</div>
                    <div className="font-mono text-sm font-semibold">
                      {uptime == null ? "—" : `${uptime}%`}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Avg latency</div>
                    <div className="font-mono text-sm font-semibold">
                      {avgLatency == null ? "—" : `${avgLatency} ms`}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Checks</div>
                    <div className="font-mono text-sm font-semibold">{roll?.total ?? 0}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="arena-card rounded-xl">
        <div className="flex items-center justify-between border-b border-arena-border p-4">
          <h3 className="font-semibold">Recent checks</h3>
          <span className="text-xs text-muted-foreground">
            {healthQuery.data?.length ?? 0} entries · {RANGES[range as RangeKey].label.toLowerCase()}
          </span>
        </div>
        <div className="max-h-[520px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0">
              <tr>
                <th className="arena-th px-4 py-3 text-left">When</th>
                <th className="arena-th px-4 py-3 text-left">TV</th>
                <th className="arena-th px-4 py-3 text-left">Status</th>
                <th className="arena-th px-4 py-3 text-right">Latency</th>
                <th className="arena-th px-4 py-3 text-left">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-arena-border/60">
              {healthQuery.isLoading && <AdminLoadingRow colSpan={5} label="Loading checks…" />}
              {!healthQuery.isLoading && (healthQuery.data?.length ?? 0) === 0 && (
                <AdminEmptyRow
                  colSpan={5}
                  icon={Waves}
                  title="No checks recorded"
                  description="Nothing arrived in this window yet."
                />
              )}
              {(healthQuery.data ?? []).map((row) => (
                <tr key={row.id} className="hover:bg-arena-panel-2/40">
                  <td className="whitespace-nowrap px-4 py-2 text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(row.checked_at), { addSuffix: true })}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-xs font-semibold">
                    {tvName.get(row.tv_id) ?? row.tv_id.slice(0, 8)}
                  </td>
                  <td className="px-4 py-2">
                    <StatusPill status={row.status} enabled />
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-right font-mono text-xs">
                    {row.latency_ms == null ? "—" : `${row.latency_ms} ms`}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {row.error ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  tone = "default",
}: {
  icon: typeof Activity;
  label: string;
  value: number;
  tone?: "default" | "success" | "danger" | "muted";
}) {
  const toneCls =
    tone === "success"
      ? "bg-success/15 text-success"
      : tone === "danger"
        ? "bg-live/15 text-live"
        : tone === "muted"
          ? "bg-arena-panel-2 text-muted-foreground"
          : "bg-primary/15 text-primary";
  return (
    <div className="arena-card rounded-xl p-4">
      <div className="flex items-center justify-between">
        <div className={cn("flex h-9 w-9 items-center justify-center rounded-md", toneCls)}>
          <Icon className="h-4 w-4" />
        </div>
        <Timer className="h-3.5 w-3.5 text-muted-foreground/60" />
      </div>
      <div className="mt-3 text-2xl font-bold font-display">{value}</div>
      <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
    </div>
  );
}

function StatusPill({ status, enabled }: { status: string; enabled: boolean }) {
  if (!enabled) {
    return (
      <span className="inline-flex items-center rounded-full bg-arena-panel-2 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        ● Disabled
      </span>
    );
  }
  if (status === "online") {
    return (
      <span className="inline-flex items-center rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-success">
        ● Online
      </span>
    );
  }
  if (status === "offline") {
    return (
      <span className="inline-flex items-center rounded-full bg-live/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-live">
        ● Offline
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-arena-panel-2 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
      ● {status}
    </span>
  );
}
