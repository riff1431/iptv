import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { queryOptions, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Coins, RefreshCw, Trophy, User, ExternalLink } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { listMatchTipsForAdmin } from "@/lib/admin-match-tips.functions";

const tipsQuery = () =>
  queryOptions({
    queryKey: ["admin", "match-tips"],
    queryFn: () => listMatchTipsForAdmin(),
    staleTime: 15_000,
  });

export const Route = createFileRoute("/admin/tips")({
  head: () => ({
    meta: [
      { title: "Match Tips — Admin" },
      { name: "description", content: "Tips received per match by the host." },
    ],
  }),
  component: AdminMatchTipsPage,
  errorComponent: ({ error, reset }) => (
    <div className="rounded-2xl border border-rose-500/40 bg-rose-500/5 p-6 text-sm text-rose-300">
      Failed to load tips: {error.message}
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
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : ""))
    .toUpperCase() || "?";
}

function timeAgo(iso: string) {
  const t = new Date(iso).getTime();
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleString();
}

function AdminMatchTipsPage() {
  const listFn = useServerFn(listMatchTipsForAdmin);
  const qc = useQueryClient();
  const q = useSuspenseQuery({
    ...tipsQuery(),
    queryFn: () => listFn(),
  });

  const { groups, grandTotalCents, grandTipCount } = q.data;

  return (
    <div className="space-y-6">
      <div className="arena-card rounded-2xl p-5 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-arena-violet">
              PGX Wallet
            </div>
            <h2 className="mt-1 flex items-center gap-2 font-display text-2xl font-extrabold uppercase tracking-tight text-arena-gradient">
              <Coins className="h-5 w-5" /> Match Tips
            </h2>
            <p className="mt-2 max-w-2xl text-xs uppercase tracking-wider text-muted-foreground">
              Every tip sent by viewers to the host of each match. The host's
              wallet is credited immediately when a tip is sent.
            </p>
          </div>
          <Button
            variant="arenaOutline"
            size="sm"
            onClick={() => qc.invalidateQueries({ queryKey: ["admin", "match-tips"] })}
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
          </Button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Matches with tips" value={String(groups.filter((g) => g.matchId).length)} />
          <Stat label="Total tips" value={String(grandTipCount)} />
          <Stat label="Total amount" value={money(grandTotalCents)} accent />
          <Stat
            label="Top match"
            value={groups[0]?.matchTitle ?? "—"}
            sub={groups[0] ? money(groups[0].totalCents) : ""}
          />
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="arena-card rounded-2xl p-10 text-center text-sm text-muted-foreground">
          No tips have been sent yet. Once viewers tip the host of a match, they
          appear here grouped by match.
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
                        {g.hostName?.trim() || (g.hostUserId ? g.hostUserId.slice(0, 8) : "—")}
                      </span>
                    </span>
                    {g.matchId && (
                      <Link
                        to="/arena/$matchId"
                        params={{ matchId: g.matchId }}
                        className="inline-flex items-center gap-1 text-arena-violet hover:underline"
                      >
                        Open match <ExternalLink className="h-3 w-3" />
                      </Link>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                    Total tipped
                  </div>
                  <div className="font-mono text-2xl font-extrabold text-emerald-300">
                    {money(g.totalCents)}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {g.tipCount} tip{g.tipCount === 1 ? "" : "s"}
                  </div>
                </div>
              </div>

              <ul className="divide-y divide-arena-border/60">
                {g.tips.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-5 py-3">
                    <Avatar className="h-8 w-8 border border-arena-border">
                      {t.senderAvatarUrl && <AvatarImage src={t.senderAvatarUrl} alt="" />}
                      <AvatarFallback className="bg-gradient-to-br from-arena-violet/40 to-arena-cyan/30 text-[10px] font-bold uppercase text-white/90">
                        {initials(t.senderName ?? t.senderId)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-white">
                        {t.senderName?.trim() || `User ${t.senderId.slice(0, 8)}`}
                      </div>
                      {t.memo && (
                        <div className="truncate text-xs italic text-muted-foreground">
                          "{t.memo}"
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-sm font-bold text-emerald-300">
                        +{money(t.amountCents)}
                      </div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {timeAgo(t.createdAt)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
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
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
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
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
