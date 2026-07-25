import { createFileRoute, Link } from "@tanstack/react-router";
import {
  queryOptions,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowDownRight,
  ArrowUpRight,
  Coins,
  ExternalLink,
  RefreshCw,
  ScrollText,
  Trophy,
  User,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listWalletLedgerForAdmin } from "@/lib/admin-wallet-ledger.functions";

const ledgerQuery = () =>
  queryOptions({
    queryKey: ["admin", "wallet-ledger"],
    queryFn: () => listWalletLedgerForAdmin(),
    staleTime: 15_000,
  });

export const Route = createFileRoute("/admin/wallet-ledger")({
  head: () => ({
    meta: [
      { title: "Wallet Ledger — Admin" },
      {
        name: "description",
        content: "Every wallet transaction related to a tip, grouped by match.",
      },
    ],
  }),
  component: AdminWalletLedgerPage,
  errorComponent: ({ error, reset }) => (
    <div className="rounded-2xl border border-rose-500/40 bg-rose-500/5 p-6 text-sm text-rose-300">
      Failed to load ledger: {error.message}
      <button className="ml-3 underline" onClick={reset}>
        Retry
      </button>
    </div>
  ),
  notFoundComponent: () => <div className="p-6 text-sm">Not found.</div>,
});

function money(cents: number) {
  return `$${(cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function initials(name: string | null) {
  const n = (name ?? "").trim();
  if (!n) return "?";
  const parts = n.split(/\s+/);
  return (
    ((parts[0]?.[0] ?? "") +
      (parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "")).toUpperCase() ||
    "?"
  );
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString();
}

function AdminWalletLedgerPage() {
  const listFn = useServerFn(listWalletLedgerForAdmin);
  const qc = useQueryClient();
  const q = useSuspenseQuery({
    ...ledgerQuery(),
    queryFn: () => listFn(),
  });
  const { groups, grandTotalCents, grandTipCount, grandRowCount } = q.data;

  return (
    <div className="space-y-6">
      <div className="arena-card rounded-2xl p-5 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-arena-violet">
              PGX Wallet
            </div>
            <h2 className="mt-1 flex items-center gap-2 font-display text-2xl font-extrabold uppercase tracking-tight text-arena-gradient">
              <ScrollText className="h-5 w-5" /> Wallet Ledger
            </h2>
            <p className="mt-2 max-w-2xl text-xs uppercase tracking-wider text-muted-foreground">
              Every tip-related wallet transaction — sender debits and host
              credits — paired and grouped by match.
            </p>
          </div>
          <Button
            variant="arenaOutline"
            size="sm"
            onClick={() =>
              qc.invalidateQueries({ queryKey: ["admin", "wallet-ledger"] })
            }
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
          </Button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Matches" value={String(groups.filter((g) => g.matchId).length)} />
          <Stat label="Tips" value={String(grandTipCount)} />
          <Stat label="Ledger rows" value={String(grandRowCount)} />
          <Stat label="Total tipped" value={money(grandTotalCents)} accent />
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="arena-card rounded-2xl p-10 text-center text-sm text-muted-foreground">
          No tip transactions yet. Once a viewer tips a host, both the debit
          and credit rows show up here paired by match.
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.matchId ?? "no-match"} className="arena-card rounded-2xl">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-arena-border px-5 py-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-arena-violet">
                    <Trophy className="h-3.5 w-3.5" /> Match
                  </div>
                  <div className="mt-1 truncate font-display text-lg font-bold uppercase tracking-tight text-white">
                    {g.matchTitle}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <User className="h-3 w-3" /> Host:{" "}
                      <span className="text-white/90">
                        {g.hostName?.trim() ||
                          (g.hostUserId ? g.hostUserId.slice(0, 8) : "—")}
                      </span>
                    </span>
                    {g.matchId && (
                      <>
                        <span className="font-mono text-[10px] opacity-60">
                          {g.matchId.slice(0, 8)}
                        </span>
                        <Link
                          to="/arena/$matchId"
                          params={{ matchId: g.matchId }}
                          className="inline-flex items-center gap-1 text-arena-violet hover:underline"
                        >
                          Open match <ExternalLink className="h-3 w-3" />
                        </Link>
                      </>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                    Total tipped
                  </div>
                  <div className="flex items-center justify-end gap-1 font-mono text-2xl font-extrabold text-emerald-300">
                    <Coins className="h-4 w-4" /> {money(g.totalCents)}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {g.tipCount} tip{g.tipCount === 1 ? "" : "s"} · {g.entries.length}{" "}
                    ledger row{g.entries.length === 1 ? "" : "s"}
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    <tr className="border-b border-arena-border/60">
                      <th className="px-4 py-2 font-bold">When</th>
                      <th className="px-4 py-2 font-bold">Direction</th>
                      <th className="px-4 py-2 font-bold">Sender</th>
                      <th className="px-4 py-2 font-bold">Wallet</th>
                      <th className="px-4 py-2 font-bold">Memo</th>
                      <th className="px-4 py-2 text-right font-bold">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-arena-border/40">
                    {g.entries.map((e) => {
                      const isCredit = e.direction === "credit";
                      return (
                        <tr key={e.id} className="align-top">
                          <td className="whitespace-nowrap px-4 py-3 font-mono text-[11px] text-muted-foreground">
                            {fmtTime(e.createdAt)}
                          </td>
                          <td className="px-4 py-3">
                            <Badge
                              variant="outline"
                              className={
                                isCredit
                                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                                  : "border-rose-500/40 bg-rose-500/10 text-rose-300"
                              }
                            >
                              {isCredit ? (
                                <ArrowDownRight className="mr-1 h-3 w-3" />
                              ) : (
                                <ArrowUpRight className="mr-1 h-3 w-3" />
                              )}
                              {isCredit ? "Credit (host)" : "Debit (sender)"}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <Avatar className="h-6 w-6 border border-arena-border">
                                {e.senderAvatarUrl && (
                                  <AvatarImage src={e.senderAvatarUrl} alt="" />
                                )}
                                <AvatarFallback className="bg-gradient-to-br from-arena-violet/40 to-arena-cyan/30 text-[9px] font-bold uppercase text-white/90">
                                  {initials(e.senderName ?? e.senderUserId)}
                                </AvatarFallback>
                              </Avatar>
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold text-white">
                                  {e.senderName?.trim() ||
                                    `User ${e.senderUserId.slice(0, 8)}`}
                                </div>
                                <div className="font-mono text-[10px] text-muted-foreground">
                                  {e.senderUserId.slice(0, 8)}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="text-sm text-white/90">
                              {e.walletUserName?.trim() ||
                                `User ${e.walletUserId.slice(0, 8)}`}
                            </div>
                            <div className="font-mono text-[10px] text-muted-foreground">
                              {e.walletUserId.slice(0, 8)}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {e.memo ? (
                              <span className="italic text-white/80">"{e.memo}"</span>
                            ) : (
                              <span className="opacity-40">—</span>
                            )}
                          </td>
                          <td
                            className={`whitespace-nowrap px-4 py-3 text-right font-mono text-sm font-bold ${
                              isCredit ? "text-emerald-300" : "text-rose-300"
                            }`}
                          >
                            {isCredit ? "+" : "−"}
                            {money(e.amountCents)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-arena-border bg-arena-panel-2/40 p-3">
      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-1 truncate font-mono text-lg font-extrabold ${
          accent ? "text-emerald-300" : "text-white"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
