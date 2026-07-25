import { useEffect, useMemo, useState } from "react";
import { withAuth } from "@/components/RequireAuth";
import { createFileRoute, stripSearchParams, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { toast } from "sonner";
import {
  Wallet as WalletIcon,
  ArrowDownRight,
  ArrowUpRight,
  RefreshCw,
  Search,
  Filter,
  X,
  Plus,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Loader2,
  CircleDollarSign,
  Ticket,
  Undo2,
  Download,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ThumbHeader } from "@/components/ThumbFallback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AdminLoadingBlock, AdminErrorBlock, AdminEmptyRow } from "@/components/admin/AdminStates";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  getWalletOverview,
  listWalletTransactions,
  getWalletTransactionDetail,
  type WalletTxType,
  type WalletTransaction,
  type WalletTransactionDetail,
} from "@/lib/wallet.functions";
import { creditOwnWallet } from "@/lib/lounge-access.functions";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Link } from "@tanstack/react-router";
import { WithdrawSection } from "@/components/wallet/WithdrawSection";
import { TopupSection } from "@/components/wallet/TopupSection";
import { WalletCharts } from "@/components/wallet/WalletCharts";
import { TipsTab } from "@/components/wallet/TipsTab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const walletSearchSchema = z.object({
  q: fallback(z.string(), "").default(""),
  type: fallback(z.enum(["", "credit", "refund", "debit_lounge_entry", "debit_tip"]), "").default(""),
  from: fallback(z.string(), "").default(""),
  to: fallback(z.string(), "").default(""),
  page: fallback(z.number().int().min(1), 1).default(1),
  pageSize: fallback(z.number().int().min(5).max(100), 20).default(20),
  tab: fallback(z.enum(["transactions", "tips"]), "transactions").default("transactions"),
  tipDir: fallback(z.enum(["all", "sent", "received"]), "all").default("all"),
  tipPage: fallback(z.number().int().min(1), 1).default(1),
  // Analytics chart state
  chartRange: fallback(z.enum(["7d", "30d", "90d", "all"]), "30d").default("30d"),
  chartSpend: fallback(
    z
      .string()
      .transform((s) => {
        const allowed = new Set(["credit", "refund", "debit_lounge_entry", "debit_tip"]);
        const tokens = Array.from(
          new Set(
            s
              .split(",")
              .map((t) => t.trim())
              .filter((t) => allowed.has(t)),
          ),
        );
        // Empty toggle set is valid (user disabled all types) — preserve it as "".
        return tokens.join(",");
      }),
    "debit_lounge_entry,debit_tip",
  ).default("debit_lounge_entry,debit_tip"),
  // Drill-down modal state. Start/end must be valid ISO timestamps to open.
  drillStart: fallback(
    z.string().refine((v) => v === "" || !Number.isNaN(Date.parse(v)), "invalid ISO date"),
    "",
  ).default(""),
  drillEnd: fallback(
    z.string().refine((v) => v === "" || !Number.isNaN(Date.parse(v)), "invalid ISO date"),
    "",
  ).default(""),
  drillTitle: fallback(z.string().max(200), "").default(""),
  drillSub: fallback(z.string().max(400), "").default(""),
  drillTypes: fallback(
    z.string().transform((s) => {
      const allowed = new Set(["credit", "refund", "debit_lounge_entry", "debit_tip"]);
      return Array.from(
        new Set(
          s
            .split(",")
            .map((t) => t.trim())
            .filter((t) => allowed.has(t)),
        ),
      ).join(",");
    }),
    "",
  ).default(""),
});

type SearchState = z.infer<typeof walletSearchSchema>;

export const Route = createFileRoute("/wallet")({
  validateSearch: zodValidator(walletSearchSchema),
  search: {
    middlewares: [
      stripSearchParams({
        q: "",
        type: "",
        from: "",
        to: "",
        page: 1,
        pageSize: 20,
        tab: "transactions",
        tipDir: "all",
        tipPage: 1,
        chartRange: "30d",
        chartSpend: "debit_lounge_entry,debit_tip",
        drillStart: "",
        drillEnd: "",
        drillTitle: "",
        drillSub: "",
        drillTypes: "",
      }),
    ],
  },
  head: () => ({
    meta: [
      { title: "Wallet — PGX Arena" },
      { name: "description", content: "Track your PGX Arena balance, credits, refunds, and lounge entries." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: withAuth(WalletPage),
});

function toIsoStart(v: string): string | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
function toIsoEnd(v: string): string | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return undefined;
  if (v.length === 10) d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

function fmtDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildTxCsv(rows: WalletTransaction[]): string {
  const header = ["id", "created_at", "type", "amount_cents", "amount_usd", "memo", "external_ref", "lounge_session_id"];
  const lines = rows.map((r) => {
    const meta = typeMeta(r.type);
    const signed = meta.sign === "-" ? -r.amount_cents : r.amount_cents;
    return [
      r.id,
      r.created_at,
      r.type,
      signed,
      (signed / 100).toFixed(2),
      r.memo ?? "",
      r.external_ref ?? "",
      r.lounge_session_id ?? "",
    ]
      .map(csvEscape)
      .join(",");
  });
  return [header.join(","), ...lines].join("\n");
}

function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function typeMeta(t: WalletTxType) {
  switch (t) {
    case "credit":
      return { label: "Credit", icon: ArrowUpRight, tone: "text-emerald-400", sign: "+" as const };
    case "refund":
      return { label: "Refund", icon: Undo2, tone: "text-sky-400", sign: "+" as const };
    case "debit_lounge_entry":
      return { label: "Lounge entry", icon: Ticket, tone: "text-amber-400", sign: "-" as const };
    case "debit_tip":
      return { label: "Tip", icon: ArrowDownRight, tone: "text-fuchsia-400", sign: "-" as const };
    default:
      return { label: t, icon: CircleDollarSign, tone: "text-muted-foreground", sign: "" as const };
  }
}

function WalletPage() {
  const { user, loading: authLoading } = useAuth();
  const rawNavigate = useNavigate();
  const navigate = rawNavigate as unknown as (opts: {
    search?: (prev: SearchState) => SearchState;
    to?: string;
    replace?: boolean;
  }) => Promise<void>;
  const search = Route.useSearch();
  const qc = useQueryClient();

  const overviewFn = useServerFn(getWalletOverview);
  const listFn = useServerFn(listWalletTransactions) as unknown as (opts: {
    data: {
      type?: WalletTxType;
      q?: string;
      from?: string;
      to?: string;
      page: number;
      pageSize: number;
    };
  }) => Promise<Awaited<ReturnType<typeof listWalletTransactions>>>;
  const creditFn = useServerFn(creditOwnWallet);
  const detailFn = useServerFn(getWalletTransactionDetail);

  const [selectedTxId, setSelectedTxId] = useState<string | null>(null);

  const detailQuery = useQuery({
    queryKey: ["wallet", "tx-detail", selectedTxId],
    queryFn: () => detailFn({ data: { id: selectedTxId! } }),
    enabled: Boolean(selectedTxId),
    staleTime: 10_000,
  });

  // Redirect to /auth if signed out (matches profile.tsx pattern).
  useEffect(() => {
    if (!authLoading && !user) void navigate({ to: "/auth", replace: true });
  }, [authLoading, user, navigate]);

  const overview = useQuery({
    queryKey: ["wallet", "overview", user?.id ?? "anon"],
    queryFn: () => overviewFn(),
    enabled: Boolean(user),
    staleTime: 5_000,
  });

  const filters = useMemo(
    () => ({
      type: search.type || undefined,
      q: search.q || undefined,
      from: toIsoStart(search.from),
      to: toIsoEnd(search.to),
      page: search.page,
      pageSize: search.pageSize,
    }),
    [search],
  );

  const txs = useQuery({
    queryKey: ["wallet", "tx", user?.id ?? "anon", filters],
    queryFn: () => listFn({ data: filters }),
    enabled: Boolean(user),
    placeholderData: keepPreviousData,
  });

  // Realtime: append/patch cache directly so lists update without a refetch.
  useEffect(() => {
    if (!user) return;
    const suffix = Math.random().toString(36).slice(2);

    const rowMatchesFilters = (
      row: WalletTransaction,
      f: { type?: string; q?: string; from?: string; to?: string },
    ): boolean => {
      if (f.type && row.type !== f.type) return false;
      if (f.from && row.created_at < f.from) return false;
      if (f.to && row.created_at > f.to) return false;
      if (f.q) {
        const needle = f.q.toLowerCase();
        const hay = [row.memo, row.external_ref, row.lounge_session_id]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    };

    const channel = supabase
      .channel(`wallet-${user.id}-${suffix}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "wallet_transactions",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          // Balance/overview totals: cheap to recompute — always invalidate.
          void qc.invalidateQueries({ queryKey: ["wallet", "overview"] });
          void qc.invalidateQueries({ queryKey: ["wallet", "analytics"] });
          void qc.invalidateQueries({ queryKey: ["wallet", "tips"] });

          const txCaches = qc.getQueriesData<{
            rows: WalletTransaction[];
            total: number;
            page: number;
            pageSize: number;
          }>({ queryKey: ["wallet", "tx", user.id] });

          if (payload.eventType === "INSERT") {
            const row = payload.new as WalletTransaction & { user_id: string };
            const dto: WalletTransaction = {
              id: row.id,
              type: row.type,
              amount_cents: row.amount_cents,
              memo: row.memo ?? null,
              external_ref: row.external_ref ?? null,
              lounge_session_id: row.lounge_session_id ?? null,
              created_at: row.created_at,
            };
            for (const [key, cache] of txCaches) {
              if (!cache) continue;
              const filters = (Array.isArray(key) ? key[3] : undefined) as
                | { type?: string; q?: string; from?: string; to?: string; page: number }
                | undefined;
              if (!filters) continue;
              if (!rowMatchesFilters(dto, filters)) continue;
              if (filters.page !== 1) {
                // Row belongs to page 1 view; other pages just need a refresh.
                void qc.invalidateQueries({ queryKey: key });
                continue;
              }
              if (cache.rows.some((r) => r.id === dto.id)) continue;
              qc.setQueryData(key, {
                ...cache,
                rows: [dto, ...cache.rows].slice(0, cache.pageSize),
                total: cache.total + 1,
              });
            }
          } else if (payload.eventType === "UPDATE") {
            const row = payload.new as WalletTransaction;
            for (const [key, cache] of txCaches) {
              if (!cache) continue;
              const idx = cache.rows.findIndex((r) => r.id === row.id);
              if (idx === -1) continue;
              const next = cache.rows.slice();
              next[idx] = { ...next[idx], ...row };
              qc.setQueryData(key, { ...cache, rows: next });
            }
          } else if (payload.eventType === "DELETE") {
            const row = payload.old as { id?: string };
            if (!row?.id) return;
            for (const [key, cache] of txCaches) {
              if (!cache) continue;
              const next = cache.rows.filter((r) => r.id !== row.id);
              if (next.length === cache.rows.length) continue;
              qc.setQueryData(key, { ...cache, rows: next, total: Math.max(0, cache.total - 1) });
            }
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "withdrawal_requests",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          type WR = {
            id: string;
            amount_cents: number;
            method: string;
            destination: string;
            user_note: string | null;
            status: string;
            admin_note: string | null;
            processed_at: string | null;
            created_at: string;
            updated_at: string;
          };
          const key = ["wallet", "withdrawals"] as const;
          const cache = qc.getQueryData<WR[]>(key);

          if (payload.eventType === "INSERT" && cache) {
            const row = payload.new as WR;
            if (!cache.some((r) => r.id === row.id)) {
              qc.setQueryData(key, [row, ...cache].slice(0, 25));
            }
          } else if (payload.eventType === "UPDATE" && cache) {
            const row = payload.new as WR;
            const idx = cache.findIndex((r) => r.id === row.id);
            if (idx >= 0) {
              const next = cache.slice();
              next[idx] = { ...next[idx], ...row };
              qc.setQueryData(key, next);
            }
          } else if (payload.eventType === "DELETE" && cache) {
            const row = payload.old as { id?: string };
            if (row?.id) qc.setQueryData(key, cache.filter((r) => r.id !== row.id));
          } else {
            void qc.invalidateQueries({ queryKey: ["wallet", "withdrawals"] });
          }

          const next = (payload.new ?? null) as { status?: string } | null;
          const prev = (payload.old ?? null) as { status?: string } | null;
          if (payload.eventType === "UPDATE" && next?.status && prev?.status !== next.status) {
            const msgs: Record<string, string> = {
              approved: "Withdrawal approved — payout in progress",
              paid: "Withdrawal paid out",
              rejected: "Withdrawal was rejected",
              cancelled: "Withdrawal cancelled",
            };
            const msg = msgs[next.status];
            if (msg) toast(msg);
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user, qc]);


  const [qDraft, setQDraft] = useState(search.q);
  useEffect(() => setQDraft(search.q), [search.q]);
  useEffect(() => {
    const h = setTimeout(() => {
      if (qDraft !== search.q) {
        navigate({
          search: (prev: SearchState) => ({ ...prev, q: qDraft, page: 1 }),
          replace: true,
        });
      }
    }, 300);
    return () => clearTimeout(h);
  }, [qDraft, search.q, navigate]);

  const setFilter = <K extends keyof SearchState>(key: K, value: SearchState[K]) =>
    navigate({
      search: (prev: SearchState) => ({ ...prev, [key]: value, page: 1 }),
      replace: true,
    });

  const clearAll = () =>
    navigate({
      search: (prev: SearchState) => ({
        ...prev,
        q: "",
        type: "" as SearchState["type"],
        from: "",
        to: "",
        page: 1,
      }),
      replace: true,
    });

  const activeFilterCount = [search.q, search.type, search.from, search.to].filter(Boolean).length;

  const total = txs.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / search.pageSize));
  const currentPage = Math.min(search.page, pageCount);
  const firstIdx = total === 0 ? 0 : (currentPage - 1) * search.pageSize + 1;
  const lastIdx = Math.min(currentPage * search.pageSize, total);
  const gotoPage = (p: number) =>
    navigate({
      search: (prev: SearchState) => ({ ...prev, page: Math.max(1, Math.min(pageCount, p)) }),
      replace: true,
    });

  const [creditAmount, setCreditAmount] = useState<string>("10.00");
  const creditMutation = useMutation({
    mutationFn: async () => {
      const dollars = Number.parseFloat(creditAmount);
      if (!Number.isFinite(dollars) || dollars <= 0) throw new Error("Enter an amount greater than 0");
      const cents = Math.round(dollars * 100);
      if (cents < 100) throw new Error("Minimum top-up is $1.00");
      if (cents > 50_000) throw new Error("Test credits are capped at $500.00");
      return creditFn({ data: { amountCents: cents } });
    },
    onSuccess: () => {
      toast.success("Wallet credited");
      void qc.invalidateQueries({ queryKey: ["wallet"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Credit failed"),
  });

  if (authLoading || !user) {
    return (
      <AppShell>
        <div className="mx-auto max-w-6xl px-4 py-10">
          <AdminLoadingBlock label="Loading wallet…" />
        </div>
      </AppShell>
    );
  }

  const totals = overview.data?.totals;

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-arena-violet">
              <WalletIcon className="h-4 w-4" /> Wallet
            </div>
            <h1 className="mt-1 font-display text-3xl font-extrabold uppercase tracking-tight text-arena-gradient sm:text-4xl">
              Your Balance
            </h1>
          </div>
          <Button
            variant="arenaOutline"
            size="sm"
            onClick={() => void qc.invalidateQueries({ queryKey: ["wallet"] })}
            disabled={overview.isFetching || txs.isFetching}
            className="gap-2"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${overview.isFetching || txs.isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </header>

        <section className="grid gap-4 md:grid-cols-4">
          <BalanceCard
            label="Available balance"
            value={overview.data ? fmtDollars(overview.data.balanceCents) : "—"}
            icon={CircleDollarSign}
            highlight
            loading={overview.isLoading}
          />
          <BalanceCard
            label="Credits added"
            value={totals ? fmtDollars(totals.creditCents) : "—"}
            icon={ArrowUpRight}
            tone="text-emerald-400"
            loading={overview.isLoading}
          />
          <BalanceCard
            label="Refunds"
            value={totals ? fmtDollars(totals.refundCents) : "—"}
            icon={Undo2}
            tone="text-sky-400"
            loading={overview.isLoading}
          />
          <BalanceCard
            label="Spent on lounges"
            value={totals ? fmtDollars(totals.debitCents) : "—"}
            icon={ArrowDownRight}
            tone="text-amber-400"
            loading={overview.isLoading}
          />
        </section>

        {(() => {
          const parsedDollars = Number.parseFloat(creditAmount);
          const validDollars = Number.isFinite(parsedDollars) && parsedDollars > 0 ? parsedDollars : 0;
          const cents = Math.round(validDollars * 100);
          const capped = cents > 50_000;
          const tooSmall = cents > 0 && cents < 1;
          const invalid = cents <= 0 || capped;
          const currentBal = overview.data?.balanceCents ?? 0;
          const projected = currentBal + Math.min(cents, 50_000);
          const presets = [10, 25, 50, 100, 250, 500];
          return (
            <section className="arena-card rounded-xl p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-lg bg-arena-violet/15 text-arena-violet">
                    <CircleDollarSign className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-arena-violet">
                      Add test credit
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Instantly credits your wallet. Min $1.00 · Max $500.00 per top-up.
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                    New balance
                  </div>
                  <div className="font-display text-lg font-extrabold text-arena-gradient">
                    {fmtDollars(projected)}
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {presets.map((p) => {
                  const active = Math.round(validDollars * 100) === p * 100;
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setCreditAmount(p.toFixed(2))}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-bold uppercase tracking-[0.12em] transition ${
                        active
                          ? "border-arena-violet bg-arena-violet/15 text-arena-violet"
                          : "border-white/10 bg-white/[0.02] text-muted-foreground hover:border-arena-violet/60 hover:text-foreground"
                      }`}
                    >
                      +${p}
                    </button>
                  );
                })}
              </div>

              <div className="mt-4 flex flex-wrap items-end gap-3">
                <label className="flex flex-1 flex-col gap-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground sm:flex-none">
                  Amount (USD)
                  <Input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="1"
                    max="500"
                    value={creditAmount}
                    onChange={(e) => setCreditAmount(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !invalid && !creditMutation.isPending) {
                        e.preventDefault();
                        creditMutation.mutate();
                      }
                    }}
                    aria-invalid={invalid || undefined}
                    className={`h-10 w-full font-mono text-base font-normal normal-case tracking-normal sm:w-40 ${
                      invalid ? "border-destructive focus-visible:ring-destructive" : ""
                    }`}
                  />
                </label>
                <Button
                  onClick={() => creditMutation.mutate()}
                  disabled={creditMutation.isPending || invalid}
                  className="h-10 gap-2"
                >
                  {creditMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  {creditMutation.isPending ? "Adding…" : `Add ${validDollars > 0 && !capped ? fmtDollars(cents) : "credit"}`}
                </Button>
              </div>

              {(capped || tooSmall || (creditAmount !== "" && cents <= 0)) && (
                <p className="mt-2 text-xs text-destructive">
                  {capped
                    ? "Amount is capped at $500.00 per top-up."
                    : tooSmall
                      ? "Minimum top-up is $1.00."
                      : "Enter an amount greater than 0."}
                </p>
              )}
            </section>
          );
        })()}

        <TopupSection />

        <WithdrawSection
          availableCents={overview.data?.balanceCents ?? 0}
          balanceLoading={overview.isLoading}
        />

        <WalletCharts userId={user.id} />




        <Tabs
          value={search.tab}
          onValueChange={(v) =>
            navigate({
              search: (prev: SearchState) => ({ ...prev, tab: v as SearchState["tab"] }),
              replace: true,
            })
          }
          className="space-y-4"
        >
          <TabsList>
            <TabsTrigger value="transactions">Transactions</TabsTrigger>
            <TabsTrigger value="tips">Tipping history</TabsTrigger>
          </TabsList>

          <TabsContent value="transactions" className="mt-0">
        <section className="arena-card space-y-4 rounded-xl p-4 sm:p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={qDraft}
                onChange={(e) => setQDraft(e.target.value)}
                placeholder="Search memo, external ref, or lounge session…"
                className="pl-9"
                aria-label="Search transactions"
              />
            </div>
            <Select
              value={search.type || "__all"}
              onValueChange={(v) => setFilter("type", (v === "__all" ? "" : v) as SearchState["type"])}
            >
              <SelectTrigger className="md:w-56">
                <SelectValue placeholder="Any type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">Any type</SelectItem>
                <SelectItem value="credit">Credit</SelectItem>
                <SelectItem value="refund">Refund</SelectItem>
                <SelectItem value="debit_lounge_entry">Lounge entry</SelectItem>
                <SelectItem value="debit_tip">Tip</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={search.from}
              onChange={(e) => setFilter("from", e.target.value)}
              className="md:w-40"
              aria-label="From date"
            />
            <Input
              type="date"
              value={search.to}
              onChange={(e) => setFilter("to", e.target.value)}
              className="md:w-40"
              aria-label="To date"
            />
            <Button
              variant="arenaOutline"
              onClick={clearAll}
              disabled={activeFilterCount === 0}
              className="gap-1"
            >
              <X className="h-4 w-4" /> Clear
            </Button>
            <Button
              variant="arenaOutline"
              onClick={() => {
                const rows = txs.data?.rows ?? [];
                if (rows.length === 0) {
                  toast.error("No transactions to export");
                  return;
                }
                const parts = [
                  `page-${currentPage}`,
                  search.type ? `type-${search.type}` : null,
                  search.from ? `from-${search.from}` : null,
                  search.to ? `to-${search.to}` : null,
                ].filter(Boolean);
                const suffix = parts.length ? `_${parts.join("_")}` : "";
                downloadCsv(`wallet-transactions${suffix}.csv`, buildTxCsv(rows));
                toast.success(`Exported ${rows.length} transaction${rows.length === 1 ? "" : "s"}`);
              }}
              disabled={txs.isLoading || (txs.data?.rows.length ?? 0) === 0}
              className="gap-1"
              aria-label="Export current page to CSV"
            >
              <Download className="h-4 w-4" /> Export CSV
            </Button>
          </div>

          {activeFilterCount > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <Filter className="h-3.5 w-3.5 text-muted-foreground" />
              {search.q && <Chip label={`search: ${search.q}`} onClear={() => setFilter("q", "")} />}
              {search.type && <Chip label={`type: ${search.type}`} onClear={() => setFilter("type", "" as SearchState["type"])} />}
              {search.from && <Chip label={`from: ${search.from}`} onClear={() => setFilter("from", "")} />}
              {search.to && <Chip label={`to: ${search.to}`} onClear={() => setFilter("to", "")} />}
            </div>
          )}

          <div className="overflow-x-auto rounded-md border border-arena-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[170px]">When</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Memo / reference</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {txs.isLoading && !txs.data ? (
                  <tr>
                    <td colSpan={4}>
                      <AdminLoadingBlock label="Loading transactions…" />
                    </td>
                  </tr>
                ) : txs.error ? (
                  <tr>
                    <td colSpan={4} className="p-5">
                      <AdminErrorBlock
                        message={txs.error instanceof Error ? txs.error.message : "Failed to load transactions"}
                      />
                    </td>
                  </tr>
                ) : (txs.data?.rows.length ?? 0) === 0 ? (
                  <AdminEmptyRow
                    colSpan={4}
                    icon={WalletIcon}
                    title="No transactions match"
                    description={
                      activeFilterCount > 0
                        ? "Adjust or clear filters to see more."
                        : "Credits, refunds, and lounge entries will appear here."
                    }
                  />
                ) : (
                  txs.data!.rows.map((row) => (
                    <TxRow key={row.id} row={row} onClick={() => setSelectedTxId(row.id)} />
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-col items-center justify-between gap-3 border-t border-arena-border pt-3 sm:flex-row">
            <div className="text-xs text-muted-foreground">
              {total === 0
                ? "No transactions"
                : `Showing ${firstIdx.toLocaleString()}–${lastIdx.toLocaleString()} of ${total.toLocaleString()}`}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Rows</span>
              <Select
                value={String(search.pageSize)}
                onValueChange={(v) =>
                  navigate({
                    search: (prev: SearchState) => ({ ...prev, pageSize: Number(v), page: 1 }),
                    replace: true,
                  })
                }
              >
                <SelectTrigger className="h-8 w-[80px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[10, 20, 50, 100].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="ml-2 flex items-center gap-1">
                <Button size="icon" variant="arenaGhost" onClick={() => gotoPage(1)} disabled={currentPage <= 1} aria-label="First page">
                  <ChevronsLeft className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="arenaGhost" onClick={() => gotoPage(currentPage - 1)} disabled={currentPage <= 1} aria-label="Previous page">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="min-w-[80px] text-center text-xs text-muted-foreground">
                  Page {currentPage} / {pageCount}
                </span>
                <Button size="icon" variant="arenaGhost" onClick={() => gotoPage(currentPage + 1)} disabled={currentPage >= pageCount} aria-label="Next page">
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="arenaGhost" onClick={() => gotoPage(pageCount)} disabled={currentPage >= pageCount} aria-label="Last page">
                  <ChevronsRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </section>
          </TabsContent>

          <TabsContent value="tips" className="mt-0">
            <TipsTab
              userId={user.id}
              direction={search.tipDir}
              page={search.tipPage}
              pageSize={search.pageSize}
              onDirectionChange={(v) =>
                navigate({
                  search: (prev: SearchState) => ({ ...prev, tipDir: v, tipPage: 1 }),
                  replace: true,
                })
              }
              onPageChange={(p) =>
                navigate({
                  search: (prev: SearchState) => ({ ...prev, tipPage: Math.max(1, p) }),
                  replace: true,
                })
              }
            />
          </TabsContent>
        </Tabs>
      </div>

      <TxDetailDrawer
        open={Boolean(selectedTxId)}
        onOpenChange={(v) => !v && setSelectedTxId(null)}
        loading={detailQuery.isLoading}
        error={detailQuery.error instanceof Error ? detailQuery.error.message : null}
        detail={detailQuery.data ?? null}
      />
    </AppShell>
  );
}

function BalanceCard({
  label,
  value,
  icon: Icon,
  tone,
  highlight,
  loading,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: string;
  highlight?: boolean;
  loading?: boolean;
}) {
  return (
    <div
      className={`arena-card relative overflow-hidden rounded-xl p-4 ${
        highlight ? "ring-1 ring-arena-violet/40 shadow-[0_0_28px_-14px_var(--arena-violet)]" : ""
      }`}
    >
      {highlight && (
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[image:var(--gradient-arena-glow)] opacity-70" />
      )}
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
        <Icon className={`h-4 w-4 ${tone ?? "text-arena-violet"}`} />
      </div>
      <div className={`mt-2 font-display text-2xl font-extrabold tabular-nums ${tone ?? "text-white"}`}>
        {loading ? <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /> : value}
      </div>
    </div>
  );
}

function Chip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <Badge variant="secondary" className="gap-1">
      {label}
      <button type="button" onClick={onClear} aria-label={`Remove ${label}`} className="rounded hover:text-destructive">
        <X className="h-3 w-3" />
      </button>
    </Badge>
  );
}

function TxRow({ row, onClick }: { row: WalletTransaction; onClick: () => void }) {
  const meta = typeMeta(row.type);
  const Icon = meta.icon;
  const created = new Date(row.created_at);
  return (
    <TableRow
      onClick={onClick}
      className="cursor-pointer"
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      aria-label="View transaction details"
    >
      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
        <div>{created.toLocaleDateString()}</div>
        <div>{created.toLocaleTimeString()}</div>
      </TableCell>
      <TableCell>
        <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${meta.tone}`}>
          <Icon className="h-3.5 w-3.5" />
          {meta.label}
        </span>
      </TableCell>
      <TableCell className="max-w-[420px] text-sm">
        <div className="truncate text-white" title={row.memo ?? ""}>
          {row.memo ?? <span className="text-muted-foreground">—</span>}
        </div>
        {(row.external_ref || row.lounge_session_id) && (
          <div className="truncate font-mono text-[10px] text-muted-foreground">
            {row.external_ref ?? row.lounge_session_id}
          </div>
        )}
      </TableCell>
      <TableCell className={`text-right font-display text-sm font-bold tabular-nums ${meta.tone}`}>
        {meta.sign}
        {fmtDollars(row.amount_cents)}
      </TableCell>
    </TableRow>
  );
}

function DetailField({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[130px_1fr] items-start gap-3 border-b border-arena-border/60 py-2 last:border-b-0">
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className={`text-sm text-white break-all ${mono ? "font-mono text-xs" : ""}`}>
        {value ?? <span className="text-muted-foreground">—</span>}
      </div>
    </div>
  );
}

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
}

function TxDetailDrawer({
  open,
  onOpenChange,
  loading,
  error,
  detail,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  loading: boolean;
  error: string | null;
  detail: WalletTransactionDetail | null;
}) {
  const tx = detail?.tx;
  const meta = tx ? typeMeta(tx.type) : null;
  const Icon = meta?.icon;
  const ls = detail?.loungeSession ?? null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {Icon && meta && <Icon className={`h-4 w-4 ${meta.tone}`} />}
            Transaction details
          </SheetTitle>
          <SheetDescription>Full ledger entry and related references.</SheetDescription>
        </SheetHeader>

        <div className="mt-4">
          {loading ? (
            <AdminLoadingBlock label="Loading transaction…" />
          ) : error ? (
            <AdminErrorBlock message={error} />
          ) : !tx || !meta ? (
            <div className="text-sm text-muted-foreground">No transaction selected.</div>
          ) : (
            <>
              <div className="arena-card mb-4 rounded-xl p-4">
                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  {meta.label}
                </div>
                <div className={`mt-1 font-display text-3xl font-extrabold tabular-nums ${meta.tone}`}>
                  {meta.sign}
                  {fmtDollars(tx.amount_cents)}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {fmtDateTime(tx.created_at)}
                </div>
              </div>

              <div className="rounded-md border border-arena-border p-3">
                <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  Ledger fields
                </div>
                <DetailField label="ID" value={tx.id} mono />
                <DetailField label="Type" value={tx.type} mono />
                <DetailField label="Amount (cents)" value={tx.amount_cents.toLocaleString()} mono />
                <DetailField label="Memo" value={tx.memo} />
                <DetailField label="External ref" value={tx.external_ref} mono />
                <DetailField
                  label="Lounge session"
                  value={tx.lounge_session_id}
                  mono
                />
                <DetailField label="Created at" value={fmtDateTime(tx.created_at)} />
              </div>

              {ls && (
                <div className="mt-4 rounded-md border border-arena-border p-3">
                  <div className="mb-1 flex items-center justify-between">
                    <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                      Related lounge session
                    </div>
                    {ls.lounge && (
                      <Link
                        to="/lounge/$loungeId"
                        params={{ loungeId: ls.lounge.slug }}
                        className="text-xs text-arena-violet hover:underline"
                      >
                        Open lounge →
                      </Link>
                    )}
                  </div>
                  <DetailField
                    label="Lounge"
                    value={
                      ls.lounge ? (
                        <div>
                          <div className="font-medium">{ls.lounge.name}</div>
                          {ls.lounge.tagline && (
                            <div className="text-xs text-muted-foreground">
                              {ls.lounge.tagline}
                            </div>
                          )}
                        </div>
                      ) : (
                        ls.lounge_id
                      )
                    }
                  />
                  <DetailField label="Session ID" value={ls.id} mono />
                  <DetailField label="Status" value={<Badge variant="secondary">{ls.status}</Badge>} />
                  <DetailField label="Amount" value={fmtDollars(ls.amount_cents)} />
                  <DetailField label="Entered at" value={fmtDateTime(ls.entered_at)} />
                  <DetailField label="Paid at" value={fmtDateTime(ls.paid_at)} />
                  <DetailField label="Expires at" value={fmtDateTime(ls.expires_at)} />
                </div>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
