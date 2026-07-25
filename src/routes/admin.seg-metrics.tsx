import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  Timer,
  Radio,
  Waves,
  TrendingUp,
  ServerCrash,
  CheckCircle2,
  Repeat,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  AdminEmptyBlock,
  AdminEmptyRow,
  AdminLoadingBlock,
  AdminLoadingRow,
} from "@/components/admin/AdminStates";

const RANGES = {
  "1h": { label: "Last hour", ms: 3600_000, buckets: 12, bucketMs: 5 * 60_000 },
  "24h": { label: "Last 24h", ms: 24 * 3600_000, buckets: 24, bucketMs: 3600_000 },
  "7d": { label: "Last 7 days", ms: 7 * 24 * 3600_000, buckets: 28, bucketMs: 6 * 3600_000 },
} as const;
type RangeKey = keyof typeof RANGES;

const REASONS = ["timeout", "non_ok", "network_error", "exception", "success"] as const;
type Reason = (typeof REASONS)[number];

const REASON_LABEL: Record<Reason, string> = {
  timeout: "Timeout",
  non_ok: "Upstream non-OK",
  network_error: "Network error",
  exception: "Exception",
  success: "Recovered",
};

const searchSchema = z.object({
  lounge: fallback(z.string(), "all").default("all"),
  range: fallback(z.enum(["1h", "24h", "7d"]), "24h").default("24h"),
});

export const Route = createFileRoute("/admin/seg-metrics")({
  validateSearch: zodValidator(searchSchema),
  component: SegMetricsPage,
});

type TvRow = {
  id: string;
  display_name: string | null;
  slot: number;
  lounge_id: string;
  selected_channel_name: string | null;
};
type LoungeRow = { id: string; name: string };
type FailureRow = {
  id: number;
  tv_id: string;
  kind: "playlist" | "segment";
  reason: Reason;
  status: number | null;
  upstream_host: string | null;
  duration_ms: number | null;
  message: string | null;
  attempts: number;
  succeeded: boolean;
  occurred_at: string;
};

function SegMetricsPage() {
  const { lounge, range } = Route.useSearch();
  const navigate = Route.useNavigate();
  const rangeCfg = RANGES[range as RangeKey];

  const loungesQuery = useQuery({
    queryKey: ["admin", "seg", "lounges"],
    queryFn: async () => {
      const { data, error } = await supabase.from("lounges").select("id, name").order("name");
      if (error) throw error;
      return (data ?? []) as LoungeRow[];
    },
  });

  const tvsQuery = useQuery({
    queryKey: ["admin", "seg", "tvs", lounge],
    queryFn: async () => {
      let q = supabase
        .from("tvs")
        .select("id, display_name, slot, lounge_id, selected_channel_name")
        .order("lounge_id")
        .order("slot");
      if (lounge !== "all") q = q.eq("lounge_id", lounge);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as TvRow[];
    },
  });

  const sinceIso = useMemo(
    () => new Date(Date.now() - rangeCfg.ms).toISOString(),
    [rangeCfg.ms],
  );
  const tvIds = useMemo(() => (tvsQuery.data ?? []).map((t) => t.id), [tvsQuery.data]);

  const failuresQuery = useQuery({
    queryKey: ["admin", "seg", "failures", lounge, range, tvIds.length],
    enabled: tvIds.length > 0,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("seg_upstream_failures")
        .select("id, tv_id, kind, reason, status, upstream_host, duration_ms, message, attempts, succeeded, occurred_at")
        .in("tv_id", tvIds)
        .gte("occurred_at", sinceIso)
        .order("occurred_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as FailureRow[];
    },
  });

  const tvName = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tvsQuery.data ?? []) m.set(t.id, t.display_name ?? `TV ${t.slot}`);
    return m;
  }, [tvsQuery.data]);

  const loungeName = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of loungesQuery.data ?? []) m.set(l.id, l.name);
    return m;
  }, [loungesQuery.data]);

  const allRows = failuresQuery.data ?? [];
  // Terminal failures (post-retry) — everything the /seg route returned as 404.
  const rows = useMemo(() => allRows.filter((r) => !r.succeeded), [allRows]);
  // Successful recoveries: succeeded=true rows are only inserted when attempts > 1.
  const recoveries = useMemo(() => allRows.filter((r) => r.succeeded), [allRows]);

  const totals = useMemo(() => {
    const t = {
      total: rows.length,
      timeout: 0,
      non_ok: 0,
      other: 0,
      sumDur: 0,
      durN: 0,
      retryAttempts: 0, // sum of (attempts - 1) across ALL logged events
      failuresAfterRetry: 0, // terminal failures where attempts > 1
      timeoutAfterRetry: 0,
      nonOkAfterRetry: 0,
    };
    for (const r of allRows) {
      t.retryAttempts += Math.max(0, (r.attempts ?? 1) - 1);
    }
    for (const r of rows) {
      if (r.reason === "timeout") t.timeout += 1;
      else if (r.reason === "non_ok") t.non_ok += 1;
      else t.other += 1;
      if (typeof r.duration_ms === "number") {
        t.sumDur += r.duration_ms;
        t.durN += 1;
      }
      if ((r.attempts ?? 1) > 1) {
        t.failuresAfterRetry += 1;
        if (r.reason === "timeout") t.timeoutAfterRetry += 1;
        else if (r.reason === "non_ok") t.nonOkAfterRetry += 1;
      }
    }
    return t;
  }, [rows, allRows]);

  // Recovery rate: of all requests that needed at least one retry, how many
  // eventually succeeded? Denominator = recoveries + terminal failures with retry.
  const recovery = useMemo(() => {
    const succeeded = recoveries.length;
    const failed = totals.failuresAfterRetry;
    const denom = succeeded + failed;
    const pct = denom > 0 ? (succeeded / denom) * 100 : null;
    return { succeeded, failed, denom, pct };
  }, [recoveries.length, totals.failuresAfterRetry]);

  // Per-TV rollup
  const perTv = useMemo(() => {
    const map = new Map<
      string,
      {
        total: number;
        timeout: number;
        non_ok: number;
        other: number;
        sumDur: number;
        durN: number;
        retryAttempts: number;
        recovered: number;
        last: string;
      }
    >();
    for (const r of allRows) {
      const b = map.get(r.tv_id) ?? {
        total: 0,
        timeout: 0,
        non_ok: 0,
        other: 0,
        sumDur: 0,
        durN: 0,
        retryAttempts: 0,
        recovered: 0,
        last: r.occurred_at,
      };
      b.retryAttempts += Math.max(0, (r.attempts ?? 1) - 1);
      if (r.succeeded) {
        b.recovered += 1;
      } else {
        b.total += 1;
        if (r.reason === "timeout") b.timeout += 1;
        else if (r.reason === "non_ok") b.non_ok += 1;
        else b.other += 1;
        if (typeof r.duration_ms === "number") {
          b.sumDur += r.duration_ms;
          b.durN += 1;
        }
      }
      if (new Date(r.occurred_at) > new Date(b.last)) b.last = r.occurred_at;
      map.set(r.tv_id, b);
    }
    return Array.from(map.entries())
      .map(([tv_id, v]) => {
        const denom = v.recovered + v.total;
        const recoveryPct = denom > 0 ? (v.recovered / denom) * 100 : null;
        return { tv_id, ...v, recoveryPct };
      })
      .sort((a, b) => b.total - a.total);
  }, [allRows]);

  // Time-bucketed sparkline data (terminal failures only)
  const buckets = useMemo(() => {
    const now = Date.now();
    const start = now - rangeCfg.ms;
    const size = rangeCfg.bucketMs;
    const count = rangeCfg.buckets;
    const arr = Array.from({ length: count }, (_, i) => ({
      start: start + i * size,
      total: 0,
      timeout: 0,
    }));
    for (const r of rows) {
      const t = new Date(r.occurred_at).getTime();
      const idx = Math.min(count - 1, Math.max(0, Math.floor((t - start) / size)));
      arr[idx].total += 1;
      if (r.reason === "timeout") arr[idx].timeout += 1;
    }
    return arr;
  }, [rows, rangeCfg]);

  const maxBucket = Math.max(1, ...buckets.map((b) => b.total));

  function setLounge(v: string) {
    void navigate({ search: (prev: z.infer<typeof searchSchema>) => ({ ...prev, lounge: v }) });
  }
  function setRange(v: RangeKey) {
    void navigate({ search: (prev: z.infer<typeof searchSchema>) => ({ ...prev, range: v }) });
  }

  const avgDur = totals.durN > 0 ? Math.round(totals.sumDur / totals.durN) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold">Segment Upstream Failures</h2>
          <p className="text-xs text-muted-foreground">
            Failure counts, timeouts and latency for the <code>/seg</code> proxy, per TV.
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

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard icon={AlertTriangle} label="Total failures" value={totals.total} tone="danger" />
        <SummaryCard icon={Timer} label="Timeouts" value={totals.timeout} tone="warn" />
        <SummaryCard icon={ServerCrash} label="Upstream non-OK" value={totals.non_ok} tone="danger" />
        <SummaryCard
          icon={TrendingUp}
          label="Avg duration"
          value={avgDur == null ? "—" : `${avgDur} ms`}
          tone="muted"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          icon={Repeat}
          label="Retry attempts"
          value={totals.retryAttempts}
          tone="muted"
        />
        <SummaryCard
          icon={Timer}
          label="Timeouts after retry"
          value={totals.timeoutAfterRetry}
          tone="warn"
        />
        <SummaryCard
          icon={ServerCrash}
          label="Non-OK after retry"
          value={totals.nonOkAfterRetry}
          tone="danger"
        />
        <SummaryCard
          icon={CheckCircle2}
          label="Recovered after retry"
          value={
            recovery.pct == null
              ? "—"
              : `${recovery.pct.toFixed(1)}%`
          }
          hint={
            recovery.denom > 0
              ? `${recovery.succeeded} of ${recovery.denom} retried requests`
              : "No retried requests in window"
          }
          tone={
            recovery.pct == null
              ? "muted"
              : recovery.pct >= 80
                ? "ok"
                : recovery.pct >= 50
                  ? "warn"
                  : "danger"
          }
        />
      </div>

      <div className="arena-card rounded-xl p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold">Failures over time</h3>
          <span className="text-xs text-muted-foreground">
            {rangeCfg.buckets} buckets · {Math.round(rangeCfg.bucketMs / 60_000)} min each
          </span>
        </div>
        {failuresQuery.isLoading ? (
          <AdminLoadingBlock label="Loading metrics…" />
        ) : totals.total === 0 ? (
          <AdminEmptyBlock
            icon={Waves}
            title="No failures in this window"
            description="The /seg proxy is healthy for the selected filter."
          />
        ) : (
          <div className="flex h-32 items-end gap-1">
            {buckets.map((b, i) => {
              const h = Math.round((b.total / maxBucket) * 100);
              const tH = b.total > 0 ? Math.round((b.timeout / b.total) * h) : 0;
              return (
                <div
                  key={i}
                  className="group relative flex-1"
                  title={`${new Date(b.start).toLocaleString()} — ${b.total} total, ${b.timeout} timeouts`}
                >
                  <div
                    className="w-full rounded-t bg-live/40"
                    style={{ height: `${h}%`, minHeight: b.total > 0 ? 2 : 0 }}
                  />
                  <div
                    className="absolute bottom-0 w-full rounded-t bg-yellow-500/70"
                    style={{ height: `${tH}%` }}
                  />
                </div>
              );
            })}
          </div>
        )}
        <div className="mt-2 flex items-center gap-4 text-[10px] uppercase tracking-widest text-muted-foreground">
          <LegendDot className="bg-live/40" label="All failures" />
          <LegendDot className="bg-yellow-500/70" label="Timeouts" />
        </div>
      </div>

      <div className="arena-card rounded-xl">
        <div className="border-b border-arena-border p-4">
          <h3 className="font-semibold">Per-TV rollup</h3>
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-arena-panel-2/80 backdrop-blur">
              <tr>
                <th className="arena-th px-4 py-3 text-left">TV</th>
                <th className="arena-th px-4 py-3 text-right">Failures</th>
                <th className="arena-th px-4 py-3 text-right">Timeouts</th>
                <th className="arena-th px-4 py-3 text-right">Non-OK</th>
                <th className="arena-th px-4 py-3 text-right">Other</th>
                <th className="arena-th px-4 py-3 text-right">Retries</th>
                <th className="arena-th px-4 py-3 text-right">Recovered</th>
                <th className="arena-th px-4 py-3 text-right">Recovery %</th>
                <th className="arena-th px-4 py-3 text-right">Avg ms</th>
                <th className="arena-th px-4 py-3 text-left">Last</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-arena-border/60">
              {failuresQuery.isLoading && <AdminLoadingRow colSpan={10} label="Loading…" />}
              {!failuresQuery.isLoading && perTv.length === 0 && (
                <AdminEmptyRow
                  colSpan={10}
                  icon={Radio}
                  title="No per-TV activity"
                  description="No /seg failures or retries for these TVs in the selected window."
                />
              )}
              {perTv.map((r) => {
                const avg = r.durN > 0 ? Math.round(r.sumDur / r.durN) : null;
                return (
                  <tr key={r.tv_id} className="hover:bg-arena-panel-2/40">
                    <td className="px-4 py-2 text-xs">
                      <div className="font-semibold">{tvName.get(r.tv_id) ?? r.tv_id.slice(0, 8)}</div>
                      <div className="text-[10px] text-muted-foreground">{r.tv_id}</div>
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-sm font-semibold">{r.total}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs">{r.timeout}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs">{r.non_ok}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs">{r.other}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs">{r.retryAttempts}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-emerald-400">{r.recovered}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs">
                      {r.recoveryPct == null ? "—" : `${r.recoveryPct.toFixed(0)}%`}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs">{avg == null ? "—" : avg}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(r.last), { addSuffix: true })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="arena-card rounded-xl">
        <div className="flex items-center justify-between border-b border-arena-border p-4">
          <h3 className="font-semibold">Recent failures</h3>
          <span className="text-xs text-muted-foreground">
            {rows.length} entries · {rangeCfg.label.toLowerCase()}
          </span>
        </div>
        <div className="max-h-[520px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-arena-panel-2/80 backdrop-blur">
              <tr>
                <th className="arena-th px-4 py-3 text-left">When</th>
                <th className="arena-th px-4 py-3 text-left">TV</th>
                <th className="arena-th px-4 py-3 text-left">Kind</th>
                <th className="arena-th px-4 py-3 text-left">Reason</th>
                <th className="arena-th px-4 py-3 text-right">Status</th>
                <th className="arena-th px-4 py-3 text-right">Duration</th>
                <th className="arena-th px-4 py-3 text-left">Upstream host</th>
                <th className="arena-th px-4 py-3 text-left">Message</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-arena-border/60">
              {failuresQuery.isLoading && <AdminLoadingRow colSpan={8} label="Loading…" />}
              {!failuresQuery.isLoading && rows.length === 0 && (
                <AdminEmptyRow
                  colSpan={8}
                  icon={Waves}
                  title="No failures logged"
                  description="No /seg upstream failures in this window."
                />
              )}
              {rows.slice(0, 200).map((row) => (
                <tr key={row.id} className="hover:bg-arena-panel-2/40">
                  <td className="whitespace-nowrap px-4 py-2 text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(row.occurred_at), { addSuffix: true })}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-xs font-semibold">
                    {tvName.get(row.tv_id) ?? row.tv_id.slice(0, 8)}
                    <div className="text-[10px] font-normal text-muted-foreground">
                      {loungeName.get(
                        (tvsQuery.data ?? []).find((t) => t.id === row.tv_id)?.lounge_id ?? "",
                      ) ?? ""}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-xs">{row.kind}</td>
                  <td className="px-4 py-2">
                    <ReasonPill reason={row.reason} />
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs">{row.status ?? "—"}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">
                    {row.duration_ms == null ? "—" : `${row.duration_ms} ms`}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{row.upstream_host ?? "—"}</td>
                  <td className="max-w-[280px] truncate px-4 py-2 text-xs text-muted-foreground" title={row.message ?? ""}>
                    {row.message ?? ""}
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
  hint,
  tone = "default",
}: {
  icon: typeof AlertTriangle;
  label: string;
  value: number | string;
  hint?: string;
  tone?: "default" | "danger" | "warn" | "muted" | "ok";
}) {
  const toneCls =
    tone === "danger"
      ? "bg-live/15 text-live"
      : tone === "warn"
        ? "bg-yellow-500/15 text-yellow-400"
        : tone === "ok"
          ? "bg-emerald-500/15 text-emerald-400"
          : tone === "muted"
            ? "bg-arena-panel-2 text-muted-foreground"
            : "bg-primary/15 text-primary";
  return (
    <div className="arena-card rounded-xl p-4">
      <div className="flex items-center justify-between">
        <div className={cn("flex h-9 w-9 items-center justify-center rounded-md", toneCls)}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="mt-3 font-display text-2xl font-bold">{value}</div>
      <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
      {hint && <div className="mt-1 text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function ReasonPill({ reason }: { reason: Reason }) {
  const cls =
    reason === "timeout"
      ? "bg-yellow-500/15 text-yellow-400"
      : reason === "non_ok"
        ? "bg-live/15 text-live"
        : "bg-arena-panel-2 text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
        cls,
      )}
    >
      {REASON_LABEL[reason]}
    </span>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("inline-block h-2 w-3 rounded-sm", className)} />
      {label}
    </span>
  );
}
