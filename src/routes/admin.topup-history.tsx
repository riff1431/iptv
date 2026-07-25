import { useMemo, useState, useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import {
  Loader2,
  Search,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Eye,
  Clock,
  BadgeCheck,
  XCircle,
  Ban,
  Download,
  Info,
  ExternalLink,
  Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "sonner";
import {
  adminListTopupHistory,
  adminGetTopupProofUrl,
  adminExportTopupHistory,
  type AdminTopupRow,
} from "@/lib/admin-topups.functions";
import type { TopupStatus } from "@/lib/topups.functions";

const searchSchema = z.object({
  q: fallback(z.string(), "").default(""),
  status: fallback(z.string(), "approved,rejected").default("approved,rejected"),
  from: fallback(z.string(), "").default(""),
  to: fallback(z.string(), "").default(""),
  page: fallback(z.number().int(), 1).default(1),
  pageSize: fallback(z.number().int(), 20).default(20),
});

export const Route = createFileRoute("/admin/topup-history")({
  validateSearch: zodValidator(searchSchema),
  component: AdminTopupHistoryPage,
});

const STATUS_META: Record<
  TopupStatus,
  { label: string; tone: string; icon: React.ComponentType<{ className?: string }> }
> = {
  pending: {
    label: "Pending",
    tone: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    icon: Clock,
  },
  approved: {
    label: "Approved",
    tone: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    icon: BadgeCheck,
  },
  rejected: {
    label: "Rejected",
    tone: "bg-rose-500/15 text-rose-300 border-rose-500/30",
    icon: XCircle,
  },
  cancelled: {
    label: "Cancelled",
    tone: "bg-muted text-muted-foreground border-arena-border",
    icon: Ban,
  },
};

const STATUS_PRESETS: Array<{ value: string; label: string }> = [
  { value: "approved,rejected", label: "Approved + Rejected" },
  { value: "approved", label: "Approved only" },
  { value: "rejected", label: "Rejected only" },
  { value: "pending", label: "Pending only" },
  { value: "cancelled", label: "Cancelled only" },
  { value: "all", label: "All statuses" },
];

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

function fmt(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function parseStatuses(v: string): TopupStatus[] | undefined {
  if (!v || v === "all") return undefined;
  const parts = v
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is TopupStatus =>
      ["pending", "approved", "rejected", "cancelled"].includes(s),
    );
  return parts.length > 0 ? parts : undefined;
}

function toIsoStart(v: string): string | undefined {
  if (!v) return undefined;
  const d = new Date(`${v}T00:00:00`);
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}
function toIsoEnd(v: string): string | undefined {
  if (!v) return undefined;
  const d = new Date(`${v}T23:59:59.999`);
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}

function AdminTopupHistoryPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/admin/topup-history" });
  const listFn = useServerFn(adminListTopupHistory);
  const proofFn = useServerFn(adminGetTopupProofUrl);
  const exportFn = useServerFn(adminExportTopupHistory);
  const [exporting, setExporting] = useState(false);

  const safePage = Math.max(1, search.page || 1);
  const safeSize = PAGE_SIZE_OPTIONS.includes(search.pageSize)
    ? search.pageSize
    : 20;
  const safeStatusValue = STATUS_PRESETS.some((s) => s.value === search.status)
    ? search.status
    : "approved,rejected";

  const [qDraft, setQDraft] = useState(search.q);
  useEffect(() => {
    setQDraft(search.q);
  }, [search.q]);

  const params = useMemo(
    () => ({
      status: parseStatuses(safeStatusValue),
      userQuery: search.q.trim() || undefined,
      from: toIsoStart(search.from),
      to: toIsoEnd(search.to),
      page: safePage,
      pageSize: safeSize,
    }),
    [safeStatusValue, search.q, search.from, search.to, safePage, safeSize],
  );

  const listQuery = useQuery({
    queryKey: ["admin", "topups", "history", params],
    queryFn: () => listFn({ data: params }),
    staleTime: 5_000,
  });

  const [proofOpen, setProofOpen] = useState<AdminTopupRow | null>(null);
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [proofLoading, setProofLoading] = useState(false);

  const [detailsRow, setDetailsRow] = useState<AdminTopupRow | null>(null);
  const [detailsProofUrl, setDetailsProofUrl] = useState<string | null>(null);
  const [detailsProofLoading, setDetailsProofLoading] = useState(false);

  const openProof = async (row: AdminTopupRow) => {
    setProofOpen(row);
    setProofUrl(null);
    if (!row.proof_path) return;
    setProofLoading(true);
    try {
      const { url } = await proofFn({ data: { id: row.id } });
      setProofUrl(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load proof");
    } finally {
      setProofLoading(false);
    }
  };

  const openDetails = async (row: AdminTopupRow) => {
    setDetailsRow(row);
    setDetailsProofUrl(null);
    if (!row.proof_path) return;
    setDetailsProofLoading(true);
    try {
      const { url } = await proofFn({ data: { id: row.id } });
      setDetailsProofUrl(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load proof");
    } finally {
      setDetailsProofLoading(false);
    }
  };

  const refreshDetailsProof = async () => {
    if (!detailsRow?.proof_path) return;
    setDetailsProofLoading(true);
    try {
      const { url } = await proofFn({ data: { id: detailsRow.id } });
      setDetailsProofUrl(url);
      toast.success("Signed URL refreshed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not refresh proof");
    } finally {
      setDetailsProofLoading(false);
    }
  };

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Copy failed");
    }
  };

  const patchSearch = (
    p: Partial<z.infer<typeof searchSchema>>,
    resetPage = true,
  ) => {
    void navigate({
      search: (prev: z.infer<typeof searchSchema>) => ({
        ...prev,
        ...p,
        ...(resetPage ? { page: 1 } : {}),
      }),
    });
  };

  const rows = listQuery.data?.rows ?? [];
  const total = listQuery.data?.total ?? 0;
  const totals = listQuery.data?.totals;
  const totalPages = Math.max(1, Math.ceil(total / safeSize));

  const summaryCards: Array<{
    key: "approved" | "rejected" | "pending" | "cancelled" | "all";
    label: string;
    tone: string;
  }> = [
    { key: "approved", label: "Approved credited", tone: "text-emerald-300" },
    { key: "rejected", label: "Rejected", tone: "text-rose-300" },
    { key: "pending", label: "Pending", tone: "text-amber-300" },
    { key: "all", label: "All (filtered)", tone: "text-white" },
  ];

  const buildCsv = (data: AdminTopupRow[]) => {
    const header = [
      "created_at",
      "status",
      "amount_usd",
      "user_email",
      "user_display_name",
      "user_id",
      "method",
      "payment_method",
      "reference",
      "user_note",
      "admin_note",
      "processed_at",
      "id",
    ];
    const escape = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      return `"${s.replace(/"/g, '""')}"`;
    };
    const lines = [header.join(",")];
    data.forEach((r) => {
      lines.push(
        [
          r.created_at,
          r.status,
          (r.amount_cents / 100).toFixed(2),
          r.user_email ?? "",
          r.user_display_name ?? "",
          r.user_id,
          r.method,
          r.payment_method_label ?? "",
          r.reference ?? "",
          r.user_note ?? "",
          r.admin_note ?? "",
          r.processed_at ?? "",
          r.id,
        ]
          .map(escape)
          .join(","),
      );
    });
    return lines.join("\n");
  };

  const downloadCsv = (csv: string, filename: string) => {
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportCsv = () => {
    if (rows.length === 0) return;
    downloadCsv(buildCsv(rows), `topup-history-page${safePage}.csv`);
  };

  const exportAll = async () => {
    setExporting(true);
    try {
      const result = await exportFn({
        data: {
          status: parseStatuses(safeStatusValue),
          userQuery: search.q.trim() || undefined,
          from: toIsoStart(search.from),
          to: toIsoEnd(search.to),
          limit: 10000,
        },
      });
      if (result.rows.length === 0) {
        toast.info("No rows match the current filters");
        return;
      }
      downloadCsv(
        buildCsv(result.rows),
        `topup-history-all-${new Date().toISOString().slice(0, 10)}.csv`,
      );
      if (result.truncated) {
        toast.warning(
          `Export truncated at ${result.limit} rows. Narrow the filters for the rest.`,
        );
      } else {
        toast.success(`Exported ${result.rows.length} rows`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className="arena-card space-y-4 rounded-2xl p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Wallet operations
          </div>
          <h2 className="mt-1 font-display text-xl font-extrabold uppercase tracking-tight text-white">
            Top-up wallet history
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            Browse a user's approved and rejected top-up requests. Filter by status,
            date, or user, and paginate through the results.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="arenaOutline"
            size="sm"
            className="gap-2"
            onClick={exportCsv}
            disabled={rows.length === 0}
            title="Download the current page as CSV"
          >
            <Download className="h-3.5 w-3.5" /> Page CSV
          </Button>
          <Button
            variant="arenaOutline"
            size="sm"
            className="gap-2"
            onClick={exportAll}
            disabled={exporting || listQuery.isLoading}
            title="Download every row matching the current filters"
          >
            {exporting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            Export all
          </Button>
          <Button
            variant="arenaOutline"
            size="sm"
            className="gap-2"
            onClick={() => listQuery.refetch()}
            disabled={listQuery.isFetching}
          >
            <RefreshCw
              className={"h-3.5 w-3.5 " + (listQuery.isFetching ? "animate-spin" : "")}
            />
            Refresh
          </Button>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="space-y-1.5 lg:col-span-2">
          <Label htmlFor="th-q">User</Label>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              patchSearch({ q: qDraft.trim() });
            }}
            className="relative"
          >
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="th-q"
              className="pl-7"
              placeholder="Email or display name…"
              value={qDraft}
              onChange={(e) => setQDraft(e.target.value)}
            />
          </form>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="th-status">Status</Label>
          <Select
            value={safeStatusValue}
            onValueChange={(v) => patchSearch({ status: v })}
          >
            <SelectTrigger id="th-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_PRESETS.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="th-from">From</Label>
          <Input
            id="th-from"
            type="date"
            value={search.from}
            onChange={(e) => patchSearch({ from: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="th-to">To</Label>
          <Input
            id="th-to"
            type="date"
            value={search.to}
            onChange={(e) => patchSearch({ to: e.target.value })}
          />
        </div>
      </div>

      {(search.q || search.from || search.to || safeStatusValue !== "approved,rejected") && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>Filters active</span>
          <button
            type="button"
            className="rounded border border-arena-border px-2 py-0.5 uppercase tracking-wide hover:text-white"
            onClick={() =>
              patchSearch({
                q: "",
                status: "approved,rejected",
                from: "",
                to: "",
              })
            }
          >
            Clear
          </button>
        </div>
      )}

      {totals && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {summaryCards.map((c) => {
            const t = totals[c.key];
            return (
              <div
                key={c.key}
                className="rounded-lg border border-arena-border bg-arena-surface/40 px-3 py-2"
              >
                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  {c.label}
                </div>
                <div className={"mt-1 font-display text-lg font-extrabold " + c.tone}>
                  {fmt(t.amount_cents)}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {t.count} {t.count === 1 ? "request" : "requests"}
                </div>
              </div>
            );
          })}
        </div>
      )}


      {listQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading history…
        </div>
      ) : listQuery.isError ? (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {listQuery.error instanceof Error
            ? listQuery.error.message
            : "Failed to load history"}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-arena-border px-4 py-10 text-center text-sm text-muted-foreground">
          No top-up requests match these filters.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-arena-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-arena-surface/40 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">User</th>
                <th className="px-3 py-2">Amount</th>
                <th className="px-3 py-2">Method</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Notes</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-arena-border/60">
              {rows.map((r) => {
                const meta = STATUS_META[r.status];
                const Icon = meta.icon;
                return (
                  <tr key={r.id} className="align-top">
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {fmtDate(r.created_at)}
                      {r.processed_at && r.processed_at !== r.created_at && (
                        <div className="text-[10px] text-muted-foreground/70">
                          proc {fmtDate(r.processed_at)}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-xs text-white/90">
                        {r.user_display_name ?? r.user_email ?? r.user_id.slice(0, 8)}
                      </div>
                      {r.user_email && r.user_display_name && (
                        <div className="text-[10px] text-muted-foreground">
                          {r.user_email}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 font-display text-base font-extrabold text-white">
                      {fmt(r.amount_cents)}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {r.payment_method_label ?? r.method}
                      {r.reference && (
                        <div className="text-[10px] text-muted-foreground/80">
                          ref {r.reference}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Badge className={"gap-1 " + meta.tone}>
                        <Icon className="h-3 w-3" />
                        {meta.label}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 max-w-[240px] text-[11px] text-muted-foreground">
                      {r.admin_note && (
                        <div>
                          <span className="text-white/70">Admin:</span> {r.admin_note}
                        </div>
                      )}
                      {r.user_note && (
                        <div>
                          <span className="text-white/70">User:</span> {r.user_note}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="arenaOutline"
                          size="sm"
                          className="gap-1"
                          onClick={() => openDetails(r)}
                        >
                          <Info className="h-3.5 w-3.5" /> Details
                        </Button>
                        {r.proof_path && (
                          <Button
                            variant="arenaOutline"
                            size="sm"
                            className="gap-1"
                            onClick={() => openProof(r)}
                          >
                            <Eye className="h-3.5 w-3.5" /> Proof
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <div className="text-xs text-muted-foreground">
          {total > 0
            ? `Showing ${(safePage - 1) * safeSize + 1}–${Math.min(safePage * safeSize, total)} of ${total}`
            : "No results"}
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="th-size" className="text-[11px] text-muted-foreground">
            Per page
          </Label>
          <Select
            value={String(safeSize)}
            onValueChange={(v) => patchSearch({ pageSize: Number(v) })}
          >
            <SelectTrigger id="th-size" className="h-8 w-[80px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((s) => (
                <SelectItem key={s} value={String(s)}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="arenaOutline"
            size="sm"
            className="gap-1"
            disabled={safePage <= 1 || listQuery.isFetching}
            onClick={() => patchSearch({ page: safePage - 1 }, false)}
          >
            <ChevronLeft className="h-3.5 w-3.5" /> Prev
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {safePage} / {totalPages}
          </span>
          <Button
            variant="arenaOutline"
            size="sm"
            className="gap-1"
            disabled={safePage >= totalPages || listQuery.isFetching}
            onClick={() => patchSearch({ page: safePage + 1 }, false)}
          >
            Next <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <Dialog
        open={!!proofOpen}
        onOpenChange={(o) => {
          if (!o) {
            setProofOpen(null);
            setProofUrl(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Payment proof</DialogTitle>
            <DialogDescription>
              {proofOpen ? fmt(proofOpen.amount_cents) : ""} ·{" "}
              {proofOpen?.user_display_name ?? proofOpen?.user_email ?? ""}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-[200px]">
            {proofLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading proof…
              </div>
            ) : proofUrl ? (
              proofUrl.toLowerCase().includes(".pdf") ? (
                <iframe
                  src={proofUrl}
                  title="Payment proof"
                  className="h-[60vh] w-full rounded-md border border-arena-border"
                />
              ) : (
                <img
                  src={proofUrl}
                  alt="Payment proof"
                  className="max-h-[60vh] w-full rounded-md border border-arena-border object-contain"
                />
              )
            ) : (
              <div className="text-sm text-muted-foreground">No proof attached.</div>
            )}
          </div>
          <DialogFooter>
            {proofUrl && (
              <a
                href={proofUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-arena-violet hover:underline"
              >
                Open in new tab
              </a>
            )}
            <Button variant="arenaOutline" onClick={() => setProofOpen(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet
        open={!!detailsRow}
        onOpenChange={(o) => {
          if (!o) {
            setDetailsRow(null);
            setDetailsProofUrl(null);
          }
        }}
      >
        <SheetContent
          side="right"
          className="w-full overflow-y-auto border-l border-arena-border bg-background p-0 sm:max-w-xl"
        >
          {detailsRow && (() => {
            const r = detailsRow;
            const meta = STATUS_META[r.status];
            const Icon = meta.icon;
            const isPdf = (detailsProofUrl ?? "").toLowerCase().includes(".pdf");
            return (
              <>
                <SheetHeader className="space-y-2 border-b border-arena-border px-6 py-5">
                  <div className="flex items-center gap-2">
                    <Badge className={"gap-1 " + meta.tone}>
                      <Icon className="h-3 w-3" />
                      {meta.label}
                    </Badge>
                    <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                      Top-up request
                    </span>
                  </div>
                  <SheetTitle className="font-display text-2xl font-extrabold text-white">
                    {fmt(r.amount_cents)}
                  </SheetTitle>
                  <SheetDescription className="text-xs text-muted-foreground">
                    {r.user_display_name ?? r.user_email ?? r.user_id}
                    {r.user_email && r.user_display_name && (
                      <span className="ml-1 text-muted-foreground/70">· {r.user_email}</span>
                    )}
                  </SheetDescription>
                </SheetHeader>

                <div className="space-y-6 px-6 py-5">
                  <section className="space-y-2">
                    <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                      Request metadata
                    </div>
                    <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                      <DetailField label="Request ID" value={r.id} onCopy={() => copyText(r.id, "Request ID")} mono />
                      <DetailField label="User ID" value={r.user_id} onCopy={() => copyText(r.user_id, "User ID")} mono />
                      <DetailField label="Method" value={r.payment_method_label ?? r.method} />
                      <DetailField label="Reference" value={r.reference ?? "—"} />
                      <DetailField label="Created" value={fmtDate(r.created_at)} />
                      <DetailField label="Updated" value={fmtDate(r.updated_at)} />
                      <DetailField label="Processed" value={fmtDate(r.processed_at)} />
                      <DetailField
                        label="Processed by"
                        value={r.processed_by ?? "—"}
                        mono={!!r.processed_by}
                        onCopy={r.processed_by ? () => copyText(r.processed_by!, "Processed by ID") : undefined}
                      />
                    </dl>
                  </section>

                  <section className="space-y-2">
                    <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                      Notes
                    </div>
                    <div className="space-y-2">
                      <NoteBlock label="Admin note" value={r.admin_note} />
                      <NoteBlock label="User note" value={r.user_note} />
                    </div>
                  </section>

                  <section className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                        Payment proof
                      </div>
                      {r.proof_path && (
                        <div className="flex items-center gap-2">
                          <Button
                            variant="arenaOutline"
                            size="sm"
                            className="gap-1"
                            onClick={refreshDetailsProof}
                            disabled={detailsProofLoading}
                          >
                            <RefreshCw
                              className={
                                "h-3.5 w-3.5 " + (detailsProofLoading ? "animate-spin" : "")
                              }
                            />
                            Refresh
                          </Button>
                          {detailsProofUrl && (
                            <a
                              href={detailsProofUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 rounded-md border border-arena-border px-2 py-1 text-[11px] text-arena-violet hover:text-white"
                            >
                              <ExternalLink className="h-3 w-3" /> Open
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                    {!r.proof_path ? (
                      <div className="rounded-md border border-dashed border-arena-border px-3 py-6 text-center text-xs text-muted-foreground">
                        No proof was attached.
                      </div>
                    ) : detailsProofLoading ? (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" /> Loading signed URL…
                      </div>
                    ) : detailsProofUrl ? (
                      <div className="space-y-2">
                        {isPdf ? (
                          <iframe
                            src={detailsProofUrl}
                            title="Payment proof"
                            className="h-[55vh] w-full rounded-md border border-arena-border"
                          />
                        ) : (
                          <img
                            src={detailsProofUrl}
                            alt="Payment proof"
                            className="max-h-[55vh] w-full rounded-md border border-arena-border object-contain"
                          />
                        )}
                        <p className="text-[10px] text-muted-foreground/70">
                          Signed URL expires shortly. Use Refresh to generate a new link.
                        </p>
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">
                        Could not load a signed URL.
                      </div>
                    )}
                  </section>
                </div>
              </>
            );
          })()}
        </SheetContent>
      </Sheet>
    </section>
  );
}

function DetailField({
  label,
  value,
  mono,
  onCopy,
}: {
  label: string;
  value: string;
  mono?: boolean;
  onCopy?: () => void;
}) {
  return (
    <div className="rounded-md border border-arena-border/60 bg-arena-surface/30 px-3 py-2">
      <dt className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 flex items-start justify-between gap-2">
        <span
          className={
            "break-all text-xs text-white/90 " + (mono ? "font-mono text-[11px]" : "")
          }
        >
          {value}
        </span>
        {onCopy && (
          <button
            type="button"
            onClick={onCopy}
            className="shrink-0 rounded p-1 text-muted-foreground hover:text-white"
            aria-label={`Copy ${label}`}
          >
            <Copy className="h-3 w-3" />
          </button>
        )}
      </dd>
    </div>
  );
}

function NoteBlock({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-md border border-arena-border/60 bg-arena-surface/30 px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 whitespace-pre-wrap text-xs text-white/90">
        {value && value.trim().length > 0 ? value : (
          <span className="text-muted-foreground">—</span>
        )}
      </div>
    </div>
  );
}
