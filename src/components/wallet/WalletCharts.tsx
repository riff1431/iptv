import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { TrendingUp, BarChart3, Download, FileText } from "lucide-react";
import { toast } from "sonner";
import {
  getWalletAnalytics,
  type WalletAnalyticsRange,
  type WalletTxType,
} from "@/lib/wallet.functions";
import { AdminLoadingBlock } from "@/components/admin/AdminStates";
import { ThumbHeader } from "@/components/ThumbFallback";
import {
  WalletDrilldownDialog,
  type WalletDrilldownTarget,
} from "@/components/wallet/WalletDrilldownDialog";

function fmt(cents: number) {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

const RANGES: { value: WalletAnalyticsRange; label: string }[] = [
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "90d", label: "90D" },
  { value: "all", label: "All" },
];

const SPEND_TYPES: { type: WalletTxType; label: string; color: string; swatch: string }[] = [
  {
    type: "debit_lounge_entry",
    label: "Lounges",
    color: "rgb(251 191 36)",
    swatch: "bg-amber-400",
  },
  { type: "debit_match_entry", label: "Matches", color: "rgb(96 165 250)", swatch: "bg-blue-400" },
  { type: "debit_tip", label: "Tips", color: "rgb(232 121 249)", swatch: "bg-fuchsia-400" },
  { type: "debit_vip_upgrade", label: "VIP", color: "rgb(167 139 250)", swatch: "bg-violet-400" },
];

function labelForBucket(key: string, unit: "day" | "week" | "month") {
  if (unit === "month") {
    const [y, m] = key.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, {
      month: "short",
      year: "2-digit",
    });
  }
  if (unit === "week") {
    const d = new Date(key + "T00:00:00Z");
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  const d = new Date(key + "T00:00:00Z");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function labelForBalance(key: string, unit: "day" | "week" | "month") {
  if (unit === "month") {
    const [y, m] = key.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, {
      month: "short",
      year: "2-digit",
    });
  }
  const d = new Date(key + "T00:00:00Z");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

type WalletChartsSearch = {
  chartRange: WalletAnalyticsRange;
  chartSpend: string;
  drillStart: string;
  drillEnd: string;
  drillTitle: string;
  drillSub: string;
  drillTypes: string;
};

const ALL_SPEND_TYPES: WalletTxType[] = [
  "credit",
  "refund",
  "debit_lounge_entry",
  "debit_match_entry",
  "debit_vip_upgrade",
  "debit_tip",
];

function parseSpendCsv(csv: string): Record<WalletTxType, boolean> {
  const set = new Set(
    csv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  return {
    credit: set.has("credit"),
    refund: set.has("refund"),
    debit_lounge_entry: set.has("debit_lounge_entry"),
    debit_match_entry: set.has("debit_match_entry"),
    debit_tip: set.has("debit_tip"),
    debit_vip_upgrade: set.has("debit_vip_upgrade"),
  };
}

function stringifySpend(enabled: Record<WalletTxType, boolean>): string {
  return ALL_SPEND_TYPES.filter((t) => enabled[t]).join(",");
}

export function WalletCharts({ userId }: { userId: string }) {
  const analyticsFn = useServerFn(getWalletAnalytics);
  const search = useSearch({ from: "/wallet" }) as WalletChartsSearch;
  const rawNavigate = useNavigate();
  const navigate = rawNavigate as unknown as (opts: {
    search?: (prev: WalletChartsSearch) => WalletChartsSearch;
    replace?: boolean;
  }) => Promise<void>;

  const range = search.chartRange;
  const enabledTypes = useMemo(() => parseSpendCsv(search.chartSpend), [search.chartSpend]);

  const setRange = useCallback(
    (r: WalletAnalyticsRange) => {
      if (r === search.chartRange) return;
      void navigate({
        search: (prev) => ({ ...prev, chartRange: r }),
        // Push so back/forward steps through range changes.
        replace: false,
      });
    },
    [navigate, search.chartRange],
  );

  const toggleType = useCallback(
    (t: WalletTxType) => {
      const next = { ...enabledTypes, [t]: !enabledTypes[t] };
      void navigate({
        search: (prev) => ({ ...prev, chartSpend: stringifySpend(next) }),
        // Push so back/forward steps through toggle changes.
        replace: false,
      });
    },
    [enabledTypes, navigate],
  );

  const drillTarget = useMemo<WalletDrilldownTarget | null>(() => {
    const startMs = Date.parse(search.drillStart);
    const endMs = Date.parse(search.drillEnd);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
    const types = search.drillTypes
      ? (search.drillTypes.split(",").filter(Boolean) as WalletTxType[])
      : undefined;
    return {
      title: search.drillTitle || "Transactions",
      subtitle: search.drillSub || undefined,
      startISO: new Date(startMs).toISOString(),
      endISO: new Date(endMs).toISOString(),
      types,
    };
  }, [search.drillStart, search.drillEnd, search.drillTitle, search.drillSub, search.drillTypes]);

  const setDrillTarget = useCallback(
    (t: WalletDrilldownTarget | null) => {
      void navigate({
        search: (prev) => ({
          ...prev,
          drillStart: t?.startISO ?? "",
          drillEnd: t?.endISO ?? "",
          drillTitle: t?.title ?? "",
          drillSub: t?.subtitle ?? "",
          drillTypes: t?.types?.join(",") ?? "",
        }),
        // Push when opening so Back closes the modal; replace when closing
        // so we don't leave an empty drill state in history.
        replace: t === null,
      });
    },
    [navigate],
  );

  function openBalanceDrill(datum: { label: string; startISO: string; endISO: string }) {
    setDrillTarget({
      title: `Balance · ${datum.label}`,
      subtitle: "All wallet activity in this period.",
      startISO: datum.startISO,
      endISO: datum.endISO,
    });
  }

  function openSpendDrill(datum: { label: string; startISO: string; endISO: string }) {
    const activeTypes = SPEND_TYPES.filter((s) => enabledTypes[s.type]).map((s) => s.type);
    setDrillTarget({
      title: `Spending · ${datum.label}`,
      subtitle:
        activeTypes.length === SPEND_TYPES.length
          ? "All spend transactions in this period."
          : `Filtered to: ${SPEND_TYPES.filter((s) => enabledTypes[s.type])
              .map((s) => s.label)
              .join(", ")}`,
      startISO: datum.startISO,
      endISO: datum.endISO,
      types: activeTypes.length ? activeTypes : SPEND_TYPES.map((s) => s.type),
    });
  }

  const q = useQuery({
    queryKey: ["wallet", "analytics", userId, range],
    queryFn: () => analyticsFn({ data: { range } }),
    staleTime: 15_000,
  });

  const balanceData = useMemo(
    () =>
      (q.data?.balanceSeries ?? []).map((p) => ({
        label: labelForBalance(p.date, q.data?.bucketUnit ?? "day"),
        balance: p.balanceCents / 100,
        startISO: p.startISO,
        endISO: p.endISO,
      })),
    [q.data],
  );

  const spendData = useMemo(() => {
    const unit = q.data?.bucketUnit ?? "day";
    return (q.data?.spendBuckets ?? []).map((b) => {
      const row: Record<string, string | number> = {
        label: labelForBucket(b.key, unit),
        startISO: b.startISO,
        endISO: b.endISO,
      };
      for (const s of SPEND_TYPES) {
        row[s.type] = enabledTypes[s.type] ? b.byType[s.type] / 100 : 0;
      }
      return row;
    });
  }, [q.data, enabledTypes]);

  const currentBalance = balanceData.length ? balanceData[balanceData.length - 1].balance : 0;
  const firstBalance = balanceData.length ? balanceData[0].balance : 0;
  const delta = currentBalance - firstBalance;
  const totalSpend = spendData.reduce(
    (s, r) => s + SPEND_TYPES.reduce((a, t) => a + (Number(r[t.type]) || 0), 0),
    0,
  );

  const rangeLabel = RANGES.find((r) => r.value === range)?.label ?? "";

  function downloadBlob(filename: string, mime: string, content: string) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function csvEscape(v: string | number): string {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function exportCSV() {
    if (!q.data) return;
    const lines: string[] = [];
    lines.push(`Wallet analytics export`);
    lines.push(`Range,${range}`);
    lines.push(`Bucket unit,${q.data.bucketUnit}`);
    lines.push(`Generated,${new Date().toISOString()}`);
    lines.push("");
    lines.push("Balance sparkline");
    lines.push(["Date", "Balance (USD)", "Balance (cents)"].join(","));
    for (const p of q.data.balanceSeries) {
      lines.push([csvEscape(p.date), (p.balanceCents / 100).toFixed(2), p.balanceCents].join(","));
    }
    lines.push("");
    lines.push("Spending by bucket");
    const header = ["Bucket start", "Bucket end", "Label"];
    for (const s of SPEND_TYPES) header.push(`${s.label} (USD)`);
    header.push("Total (USD)");
    lines.push(header.map(csvEscape).join(","));
    for (const b of q.data.spendBuckets) {
      const row: (string | number)[] = [b.startISO.slice(0, 10), b.endISO.slice(0, 10), b.label];
      let total = 0;
      for (const s of SPEND_TYPES) {
        const c = enabledTypes[s.type] ? b.byType[s.type] : 0;
        row.push((c / 100).toFixed(2));
        total += c;
      }
      row.push((total / 100).toFixed(2));
      lines.push(row.map(csvEscape).join(","));
    }
    const fname = `wallet-analytics-${range}-${new Date().toISOString().slice(0, 10)}.csv`;
    downloadBlob(fname, "text/csv;charset=utf-8", lines.join("\n"));
    toast.success("Wallet analytics CSV downloaded");
  }

  async function exportPDF() {
    if (!q.data) return;
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
      import("jspdf"),
      import("jspdf-autotable"),
    ]);
    const doc = new jsPDF({ unit: "pt", format: "letter" });
    const now = new Date();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("Wallet Analytics Report", 40, 50);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(
      `Range: ${rangeLabel}  ·  Bucket: ${q.data.bucketUnit}  ·  Generated ${now.toLocaleString()}`,
      40,
      68,
    );

    // Summary block
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Summary", 40, 96);
    autoTable(doc, {
      startY: 104,
      theme: "grid",
      styles: { fontSize: 10, cellPadding: 6 },
      headStyles: { fillColor: [88, 28, 135], textColor: 255 },
      head: [["Metric", "Value"]],
      body: [
        ["Current balance", fmt(Math.round(currentBalance * 100))],
        ["Balance change", `${delta >= 0 ? "+" : ""}${fmt(Math.round(delta * 100))}`],
        [
          `Total spending (${
            SPEND_TYPES.filter((s) => enabledTypes[s.type])
              .map((s) => s.label)
              .join(", ") || "none"
          })`,
          fmt(Math.round(totalSpend * 100)),
        ],
        ["Balance points", String(q.data.balanceSeries.length)],
        ["Spend buckets", String(q.data.spendBuckets.length)],
      ],
    });

    // Balance table
    const afterSummaryY =
      (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 160;
    doc.setFont("helvetica", "bold");
    doc.text("Balance sparkline", 40, afterSummaryY + 24);
    autoTable(doc, {
      startY: afterSummaryY + 32,
      theme: "striped",
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [30, 41, 59], textColor: 255 },
      head: [["Date", "Balance"]],
      body: q.data.balanceSeries.map((p) => [p.date, fmt(p.balanceCents)]),
    });

    // Spending table
    const afterBalanceY =
      (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ??
      afterSummaryY + 40;
    doc.setFont("helvetica", "bold");
    doc.text("Spending by bucket", 40, afterBalanceY + 24);
    const spendHead = ["Bucket", ...SPEND_TYPES.map((s) => s.label), "Total"];
    autoTable(doc, {
      startY: afterBalanceY + 32,
      theme: "striped",
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [30, 41, 59], textColor: 255 },
      head: [spendHead],
      body: q.data.spendBuckets.map((b) => {
        let total = 0;
        const cols = SPEND_TYPES.map((s) => {
          const c = enabledTypes[s.type] ? b.byType[s.type] : 0;
          total += c;
          return fmt(c);
        });
        return [b.label, ...cols, fmt(total)];
      }),
    });

    // Footer page numbers
    const pageCount = doc.getNumberOfPages();
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.text(
        `PGX Arena · Wallet Analytics · Page ${i} of ${pageCount}`,
        40,
        doc.internal.pageSize.getHeight() - 24,
      );
    }

    const fname = `wallet-analytics-${range}-${now.toISOString().slice(0, 10)}.pdf`;
    doc.save(fname);
    toast.success("Wallet analytics PDF downloaded");
  }

  const canExport = Boolean(q.data) && !q.isLoading;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          role="group"
          aria-label="Analytics range"
          className="inline-flex rounded-md border border-arena-border bg-arena-panel-2/40 p-0.5"
        >
          {RANGES.map((r) => {
            const active = r.value === range;
            return (
              <button
                key={r.value}
                type="button"
                onClick={() => setRange(r.value)}
                aria-pressed={active}
                className={`rounded px-2.5 py-1 text-xs font-semibold transition ${
                  active
                    ? "bg-arena-violet/20 text-white"
                    : "text-muted-foreground hover:text-white"
                }`}
              >
                {r.label}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Spend types
          </span>
          {SPEND_TYPES.map((s) => {
            const active = enabledTypes[s.type];
            return (
              <button
                key={s.type}
                type="button"
                onClick={() => toggleType(s.type)}
                aria-pressed={active}
                className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-semibold transition ${
                  active
                    ? "border-arena-violet/50 bg-arena-violet/10 text-white"
                    : "border-arena-border text-muted-foreground hover:text-white"
                }`}
              >
                <span className={`h-2 w-2 rounded-sm ${s.swatch} ${active ? "" : "opacity-40"}`} />
                {s.label}
              </button>
            );
          })}
          <span className="mx-1 h-4 w-px bg-arena-border" aria-hidden />
          <button
            type="button"
            onClick={exportCSV}
            disabled={!canExport}
            className="flex items-center gap-1.5 rounded-md border border-arena-border px-2 py-1 text-xs font-semibold text-muted-foreground transition hover:text-white disabled:opacity-40"
            title="Download analytics as CSV"
          >
            <Download className="h-3.5 w-3.5" /> CSV
          </button>
          <button
            type="button"
            onClick={exportPDF}
            disabled={!canExport}
            className="flex items-center gap-1.5 rounded-md border border-arena-border px-2 py-1 text-xs font-semibold text-muted-foreground transition hover:text-white disabled:opacity-40"
            title="Download analytics as PDF report"
          >
            <FileText className="h-3.5 w-3.5" /> PDF
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="arena-card rounded-xl p-4 sm:p-5">
          <ThumbHeader icon={TrendingUp} label="Balance chart" />
          <header className="mb-3 flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                Balance · {rangeLabel}
              </div>
              <div className="mt-1 text-2xl font-extrabold tracking-tight">
                {fmt(Math.round(currentBalance * 100))}
              </div>
            </div>
            <div
              className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                delta >= 0 ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400"
              }`}
            >
              {delta >= 0 ? "+" : ""}
              {fmt(Math.round(delta * 100))}
            </div>
          </header>
          <div className="h-40">
            {q.isLoading ? (
              <AdminLoadingBlock label="Loading trend…" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={balanceData}
                  margin={{ left: 0, right: 8, top: 4, bottom: 0 }}
                  style={{ cursor: "pointer" }}
                  onClick={(e: unknown) => {
                    const p = (e as { activePayload?: { payload: (typeof balanceData)[number] }[] })
                      ?.activePayload?.[0]?.payload;
                    if (p) openBalanceDrill(p);
                  }}
                >
                  <defs>
                    <linearGradient id="balGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.55} />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    stroke="hsl(var(--border))"
                    strokeOpacity={0.15}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    interval="preserveStartEnd"
                    minTickGap={24}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    width={44}
                    tickFormatter={(v) => `$${Number(v).toFixed(0)}`}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(v: number) => [fmt(Math.round(v * 100)), "Balance"]}
                    labelStyle={{ color: "hsl(var(--muted-foreground))" }}
                  />
                  <Area
                    type="monotone"
                    dataKey="balance"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    fill="url(#balGrad)"
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="arena-card rounded-xl p-4 sm:p-5">
          <ThumbHeader icon={BarChart3} label="Spending chart" />
          <header className="mb-3 flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                Spending · {rangeLabel}
              </div>
              <div className="mt-1 text-2xl font-extrabold tracking-tight">
                {fmt(Math.round(totalSpend * 100))}
              </div>
            </div>
          </header>
          <div className="h-40">
            {q.isLoading ? (
              <AdminLoadingBlock label="Loading spending…" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={spendData}
                  margin={{ left: 0, right: 8, top: 4, bottom: 0 }}
                  style={{ cursor: "pointer" }}
                  onClick={(e: unknown) => {
                    const p = (e as { activePayload?: { payload: (typeof spendData)[number] }[] })
                      ?.activePayload?.[0]?.payload;
                    if (p)
                      openSpendDrill(
                        p as unknown as { label: string; startISO: string; endISO: string },
                      );
                  }}
                >
                  <CartesianGrid
                    stroke="hsl(var(--border))"
                    strokeOpacity={0.15}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    interval="preserveStartEnd"
                    minTickGap={24}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    width={44}
                    tickFormatter={(v) => `$${Number(v).toFixed(0)}`}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(v: number, name) => {
                      const meta = SPEND_TYPES.find((s) => s.type === name);
                      return [fmt(Math.round(v * 100)), meta?.label ?? String(name)];
                    }}
                    labelStyle={{ color: "hsl(var(--muted-foreground))" }}
                    cursor={{ fill: "hsl(var(--muted))", opacity: 0.2 }}
                  />
                  {SPEND_TYPES.map((s, i) => (
                    <Bar
                      key={s.type}
                      dataKey={s.type}
                      stackId="s"
                      fill={s.color}
                      radius={i === SPEND_TYPES.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                      isAnimationActive={false}
                      hide={!enabledTypes[s.type]}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
      <WalletDrilldownDialog
        open={drillTarget !== null}
        onOpenChange={(v) => {
          if (!v) setDrillTarget(null);
        }}
        target={drillTarget}
      />
    </section>
  );
}
