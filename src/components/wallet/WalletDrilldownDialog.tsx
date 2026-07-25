import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import {
  ArrowDown,
  ArrowDownRight,
  ArrowUp,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Filter,
  Link2,
  Loader2,
  Receipt,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { listWalletTransactions, type WalletTxType } from "@/lib/wallet.functions";

function fmt(cents: number) {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

const TYPE_META: Record<
  WalletTxType,
  { label: string; tone: string; sign: "+" | "-"; icon: typeof ArrowUpRight }
> = {
  credit: { label: "Credit", tone: "text-emerald-400", sign: "+", icon: ArrowUpRight },
  refund: { label: "Refund", tone: "text-sky-400", sign: "+", icon: ArrowUpRight },
  debit_lounge_entry: {
    label: "Lounge",
    tone: "text-amber-400",
    sign: "-",
    icon: ArrowDownRight,
  },
  debit_match_entry: {
    label: "Match",
    tone: "text-blue-400",
    sign: "-",
    icon: ArrowDownRight,
  },
  debit_tip: { label: "Tip", tone: "text-fuchsia-400", sign: "-", icon: ArrowDownRight },
};

const CATEGORY_OPTIONS: { type: WalletTxType; label: string }[] = [
  { type: "credit", label: "Credit" },
  { type: "refund", label: "Refund" },
  { type: "debit_lounge_entry", label: "Lounge" },
  { type: "debit_match_entry", label: "Match" },
  { type: "debit_tip", label: "Tip" },
];

type Direction = "all" | "credit" | "debit";

export type WalletDrilldownTarget = {
  title: string;
  subtitle?: string;
  startISO: string;
  endISO: string;
  /** If provided, only these types are fetched. */
  types?: WalletTxType[];
};

export function WalletDrilldownDialog({
  open,
  onOpenChange,
  target,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  target: WalletDrilldownTarget | null;
}) {
  const listFn = useServerFn(listWalletTransactions);

  const [categories, setCategories] = useState<Set<WalletTxType>>(new Set());
  const [direction, setDirection] = useState<Direction>("all");
  const [minAmount, setMinAmount] = useState<string>("");
  const [sortBy, setSortBy] = useState<"date" | "amount">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);

  // Reset local filters whenever a new bucket is opened.
  useEffect(() => {
    if (!open) return;
    setCategories(new Set(target?.types ?? []));
    setDirection("all");
    setMinAmount("");
    setSortBy("date");
    setSortDir("desc");
    setPage(1);
  }, [open, target]);


  const q = useQuery({
    queryKey: [
      "wallet",
      "drilldown",
      target?.startISO,
      target?.endISO,
      (target?.types ?? []).join(","),
    ],
    queryFn: () =>
      listFn({
        data: {
          from: target!.startISO,
          to: target!.endISO,
          page: 1,
          pageSize: 100,
        },
      }),
    enabled: Boolean(open && target),
    staleTime: 10_000,
  });

  const minCents = useMemo(() => {
    const n = Number.parseFloat(minAmount);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.round(n * 100);
  }, [minAmount]);

  const allRows = q.data?.rows ?? [];

  const rows = useMemo(() => {
    return allRows.filter((r) => {
      if (target?.types && target.types.length > 0 && !target.types.includes(r.type)) {
        return false;
      }
      if (categories.size > 0 && !categories.has(r.type)) return false;
      const meta = TYPE_META[r.type];
      if (direction === "credit" && meta.sign !== "+") return false;
      if (direction === "debit" && meta.sign !== "-") return false;
      if (minCents > 0 && r.amount_cents < minCents) return false;
      return true;
    });
  }, [allRows, target, categories, direction, minCents]);

  const sortedRows = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortBy === "amount") {
        cmp = a.amount_cents - b.amount_cents;
      } else {
        cmp =
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [rows, sortBy, sortDir]);

  const totalCents = rows.reduce((s, r) => {
    const t = TYPE_META[r.type];
    return s + (t.sign === "+" ? r.amount_cents : -r.amount_cents);
  }, 0);

  const activeFilterCount =
    (categories.size > 0 ? 1 : 0) + (direction !== "all" ? 1 : 0) + (minCents > 0 ? 1 : 0);
  const filtered = rows.length !== allRows.length;

  const pageCount = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageStart = (safePage - 1) * pageSize;
  const pageRows = sortedRows.slice(pageStart, pageStart + pageSize);

  // Reset to first page whenever the filtered/sorted set shrinks below current page.
  useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [page, pageCount]);
  // Reset to first page when filters change.
  useEffect(() => {
    setPage(1);
  }, [categories, direction, minCents, sortBy, sortDir, pageSize]);


  function toggleCategory(t: WalletTxType) {
    setCategories((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }

  function clearFilters() {
    setCategories(new Set());
    setDirection("all");
    setMinAmount("");
  }

  const availableCategories = target?.types?.length
    ? CATEGORY_OPTIONS.filter((c) => target.types!.includes(c.type))
    : CATEGORY_OPTIONS;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-4 w-4 text-arena-violet" /> {target?.title ?? "Transactions"}
            {target && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(window.location.href);
                    toast.success("Link copied — opens this view");
                  } catch {
                    toast.error("Couldn't copy link");
                  }
                }}
                title="Copy shareable link"
                className="ml-1 rounded-md border border-arena-border p-1 text-muted-foreground hover:text-white"
              >
                <Link2 className="h-3.5 w-3.5" />
              </button>
            )}
          </DialogTitle>
          <DialogDescription>
            {target?.subtitle ?? "Transactions in this range."}
          </DialogDescription>
        </DialogHeader>


        <div className="space-y-2 rounded-md border border-arena-border bg-arena-panel-2/40 p-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
              <Filter className="h-3 w-3" /> Filters
              {activeFilterCount > 0 && (
                <span className="rounded-full bg-arena-violet/20 px-1.5 py-0.5 text-[10px] text-arena-violet">
                  {activeFilterCount}
                </span>
              )}
            </div>
            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={clearFilters}
                className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground hover:text-white"
              >
                <X className="h-3 w-3" /> Clear
              </button>
            )}
          </div>

          <div>
            <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
              Category
            </div>
            <div className="flex flex-wrap gap-1.5">
              {availableCategories.map((c) => {
                const active = categories.has(c.type);
                const meta = TYPE_META[c.type];
                return (
                  <button
                    key={c.type}
                    type="button"
                    onClick={() => toggleCategory(c.type)}
                    aria-pressed={active}
                    className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold transition ${
                      active
                        ? `border-arena-violet/50 bg-arena-violet/10 ${meta.tone}`
                        : "border-arena-border text-muted-foreground hover:text-white"
                    }`}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                Direction
              </div>
              <div className="inline-flex w-full rounded-md border border-arena-border bg-arena-panel/40 p-0.5">
                {(
                  [
                    { v: "all", label: "All" },
                    { v: "credit", label: "In" },
                    { v: "debit", label: "Out" },
                  ] as { v: Direction; label: string }[]
                ).map((opt) => {
                  const active = direction === opt.v;
                  return (
                    <button
                      key={opt.v}
                      type="button"
                      onClick={() => setDirection(opt.v)}
                      aria-pressed={active}
                      className={`flex-1 rounded px-2 py-0.5 text-[11px] font-semibold transition ${
                        active
                          ? "bg-arena-violet/20 text-white"
                          : "text-muted-foreground hover:text-white"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <label
                htmlFor="drill-min"
                className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
              >
                Min amount (USD)
              </label>
              <Input
                id="drill-min"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                placeholder="0.00"
                value={minAmount}
                onChange={(e) => setMinAmount(e.target.value)}
                className="h-7 text-xs"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-md border border-arena-border bg-arena-panel-2/40 px-3 py-2 text-xs">
          <span className="font-bold uppercase tracking-[0.14em] text-muted-foreground">
            {rows.length} of {allRows.length}{" "}
            {allRows.length === 1 ? "transaction" : "transactions"}
            {filtered && <span className="ml-1 text-arena-violet">· filtered</span>}
          </span>
          <span
            className={`font-extrabold ${totalCents >= 0 ? "text-emerald-400" : "text-rose-400"}`}
          >
            Net {totalCents >= 0 ? "+" : "-"}
            {fmt(Math.abs(totalCents))}
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div
            role="group"
            aria-label="Sort transactions"
            className="inline-flex rounded-md border border-arena-border bg-arena-panel-2/40 p-0.5 text-[11px] font-semibold"
          >
            {(
              [
                { v: "date", label: "Date" },
                { v: "amount", label: "Amount" },
              ] as { v: "date" | "amount"; label: string }[]
            ).map((opt) => {
              const active = sortBy === opt.v;
              return (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => {
                    if (sortBy === opt.v) {
                      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                    } else {
                      setSortBy(opt.v);
                    }
                  }}
                  aria-pressed={active}
                  className={`flex items-center gap-1 rounded px-2 py-0.5 transition ${
                    active
                      ? "bg-arena-violet/20 text-white"
                      : "text-muted-foreground hover:text-white"
                  }`}
                >
                  {opt.label}
                  {active &&
                    (sortDir === "asc" ? (
                      <ArrowUp className="h-3 w-3" />
                    ) : (
                      <ArrowDown className="h-3 w-3" />
                    ))}
                </button>
              );
            })}
          </div>
          <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Per page
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="rounded-md border border-arena-border bg-arena-panel-2/40 px-1.5 py-0.5 text-xs font-semibold text-white"
            >
              {[10, 25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="max-h-[360px] overflow-y-auto rounded-md border border-arena-border">
          {q.isLoading ? (
            <div className="flex items-center justify-center gap-2 p-6 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading transactions…
            </div>
          ) : pageRows.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground">
              {allRows.length === 0
                ? "No transactions in this range."
                : "No transactions match the current filters."}
            </div>
          ) : (
            <ul className="divide-y divide-arena-border">
              {pageRows.map((r) => {
                const meta = TYPE_META[r.type];
                const Icon = meta.icon;
                return (
                  <li key={r.id} className="flex items-start gap-3 px-3 py-2.5 text-xs">
                    <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${meta.tone}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`font-bold ${meta.tone}`}>{meta.label}</span>
                        <span className="text-muted-foreground">
                          {new Date(r.created_at).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      {r.memo && (
                        <p className="mt-0.5 line-clamp-2 text-white/80">{r.memo}</p>
                      )}
                      {r.external_ref && !r.memo && (
                        <p className="mt-0.5 truncate text-muted-foreground">
                          Ref: {r.external_ref}
                        </p>
                      )}
                    </div>
                    <span className={`font-extrabold ${meta.tone}`}>
                      {meta.sign}
                      {fmt(r.amount_cents)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {sortedRows.length > pageSize && (
          <div className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground">
            <span>
              Showing {pageStart + 1}–{Math.min(pageStart + pageSize, sortedRows.length)} of{" "}
              {sortedRows.length}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage <= 1}
                className="flex items-center gap-1 rounded-md border border-arena-border px-2 py-0.5 text-xs transition hover:text-white disabled:opacity-40"
              >
                <ChevronLeft className="h-3 w-3" /> Prev
              </button>
              <span className="px-1 text-white">
                {safePage} / {pageCount}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                disabled={safePage >= pageCount}
                className="flex items-center gap-1 rounded-md border border-arena-border px-2 py-0.5 text-xs transition hover:text-white disabled:opacity-40"
              >
                Next <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}

      </DialogContent>
    </Dialog>
  );
}
