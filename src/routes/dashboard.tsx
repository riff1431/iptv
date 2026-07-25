import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  BellOff,
  Building2,
  CircleDollarSign,
  Coins,
  Crown,
  Flame,
  Heart,
  History,
  Loader2,
  MessageSquare,
  Search,
  Send,
  RotateCcw,
  Sparkles,
  Trophy,
  Users as UsersIcon,
  Wallet as WalletIcon,
  XCircle,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { withAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { sendTestNotification } from "@/lib/notifications.functions";


export const Route = createFileRoute("/dashboard")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Your Dashboard — Sports Lounge" },
      {
        name: "description",
        content: "Your wallet, hosted matches, and recent activity.",
      },
    ],
  }),
  component: withAuth(DashboardPage),
});

// ---------- helpers ----------
const money = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format((cents ?? 0) / 100);

function timeAgo(iso: string | null) {
  if (!iso) return "—";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// ---------- data hooks ----------
function useUserDashboard(userId: string | undefined) {
  return useQuery({
    enabled: !!userId,
    queryKey: ["user", "dashboard", userId],
    queryFn: async () => {
      const since30 = new Date(
        Date.now() - 30 * 24 * 3600_000,
      ).toISOString();

      const [wallet, hostedMatches, sessions, notifications] =
        await Promise.all([
          supabase
            .from("wallet_transactions")
            .select("id,type,amount_cents,memo,created_at,match_id,lounge_id")
            .eq("user_id", userId!)
            .order("created_at", { ascending: false })
            .limit(50),
          supabase
            .from("matches")
            .select(
              "id,title,sport,status,starts_at,created_at,thumbnail_url,is_active",
            )
            .eq("owner_id", userId!)
            .order("created_at", { ascending: false })
            .limit(10),
          supabase
            .from("lounge_sessions")
            .select("id,lounge_id,amount_cents,entered_at,created_at")
            .eq("user_id", userId!)
            .gte("created_at", since30)
            .order("created_at", { ascending: false })
            .limit(20),
          supabase
            .from("notifications")
            .select("id,kind,title,body,created_at,link")
            .eq("user_id", userId!)
            .order("created_at", { ascending: false })
            .limit(10),
        ]);

      return {
        wallet: wallet.data ?? [],
        hostedMatches: hostedMatches.data ?? [],
        sessions: sessions.data ?? [],
        notifications: notifications.data ?? [],
      };
    },
    refetchInterval: 60_000,
  });
}

// ---------- primitives ----------
function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  accent,
  glow,
}: {
  icon: typeof UsersIcon;
  label: string;
  value: string;
  sub?: string;
  accent: string;
  glow: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-arena-border bg-arena-panel p-5">
      <div
        className={cn(
          "pointer-events-none absolute inset-0 -z-10 opacity-40",
          glow,
        )}
      />
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "grid h-12 w-12 shrink-0 place-items-center rounded-full ring-1",
            accent,
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            {label}
          </div>
          <div className="mt-1 font-display text-2xl font-extrabold tracking-tight text-white">
            {value}
          </div>
          {sub && (
            <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>
          )}
        </div>
      </div>
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
    <div
      className={cn(
        "rounded-2xl border border-arena-border bg-arena-panel p-5",
        className,
      )}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="font-display text-lg font-bold text-white">{title}</div>
        {action}
      </div>
      {children}
    </div>
  );
}

function walletDirection(type: string): {
  sign: 1 | -1;
  color: string;
  Icon: typeof ArrowUpRight;
} {
  const debit =
    type === "debit_lounge_entry" ||
    type === "debit_match_entry" ||
    type === "debit_tip";
  return debit
    ? { sign: -1, color: "text-rose-400", Icon: ArrowUpRight }
    : { sign: 1, color: "text-emerald-400", Icon: ArrowDownRight };
}

function walletLabel(type: string) {
  switch (type) {
    case "credit":
      return "Top-up / Credit";
    case "debit_lounge_entry":
      return "Lounge entry";
    case "debit_match_entry":
      return "Match entry";
    case "debit_tip":
      return "Tip sent";
    default:
      return type;
  }
}

// ---------- transaction history ----------
type WalletTx = {
  id: string;
  type: string;
  amount_cents: number | null;
  memo: string | null;
  created_at: string;
};

function useWalletHistory(userId: string | undefined) {
  return useQuery({
    enabled: !!userId,
    queryKey: ["user", "wallet-history", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wallet_transactions")
        .select("id,type,amount_cents,memo,created_at")
        .eq("user_id", userId!)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as WalletTx[];
    },
    refetchInterval: 60_000,
  });
}

function toLocalDateInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function TransactionHistoryTable({ userId }: { userId: string | undefined }) {
  const { data: txs = [], isLoading } = useWalletHistory(userId);
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [preset, setPreset] = useState<"all" | "7d" | "30d" | "90d">("all");

  // Compute running balance across ALL transactions (chronological order),
  // then filter for display so "balance after" reflects true history.
  const withRunning = useMemo(() => {
    const asc = [...txs].sort((a, b) =>
      a.created_at < b.created_at ? -1 : 1,
    );
    let bal = 0;
    const map = new Map<string, number>();
    for (const t of asc) {
      const { sign } = walletDirection(t.type);
      bal += sign * Math.abs(t.amount_cents ?? 0);
      map.set(t.id, bal);
    }
    // Return descending (newest first) with running balance attached.
    return [...txs].map((t) => ({ ...t, balance_after: map.get(t.id) ?? 0 }));
  }, [txs]);

  const applyPreset = (p: "all" | "7d" | "30d" | "90d") => {
    setPreset(p);
    if (p === "all") {
      setFrom("");
      setTo("");
      return;
    }
    const days = p === "7d" ? 7 : p === "30d" ? 30 : 90;
    const end = new Date();
    const start = new Date(Date.now() - days * 24 * 3600_000);
    setFrom(toLocalDateInput(start));
    setTo(toLocalDateInput(end));
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const fromTs = from ? new Date(from + "T00:00:00").getTime() : null;
    const toTs = to ? new Date(to + "T23:59:59.999").getTime() : null;
    return withRunning.filter((t) => {
      const ts = new Date(t.created_at).getTime();
      if (fromTs !== null && ts < fromTs) return false;
      if (toTs !== null && ts > toTs) return false;
      if (needle) {
        const hay =
          `${walletLabel(t.type)} ${t.memo ?? ""} ${t.type}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [withRunning, q, from, to]);

  const totalIn = filtered
    .filter((t) => walletDirection(t.type).sign === 1)
    .reduce((s, t) => s + Math.abs(t.amount_cents ?? 0), 0);
  const totalOut = filtered
    .filter((t) => walletDirection(t.type).sign === -1)
    .reduce((s, t) => s + Math.abs(t.amount_cents ?? 0), 0);

  const clearAll = () => {
    setQ("");
    setFrom("");
    setTo("");
    setPreset("all");
  };

  const hasFilters = q !== "" || from !== "" || to !== "" || preset !== "all";

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <History className="h-4 w-4 text-arena-cyan" /> Transaction History
        </span>
      }
      action={
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span>
            <span className="text-emerald-400 font-mono font-semibold">
              +{money(totalIn)}
            </span>{" "}
            in
          </span>
          <span>
            <span className="text-rose-400 font-mono font-semibold">
              -{money(totalOut)}
            </span>{" "}
            out
          </span>
          <span className="hidden sm:inline">· {filtered.length} rows</span>
        </div>
      }
    >
      {/* Toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search type or memo…"
            className="h-9 pl-8 pr-8 text-xs"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-white"
              aria-label="Clear search"
            >
              <XCircle className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1 rounded-md border border-arena-border bg-arena-bg/50 p-0.5">
          {(["all", "7d", "30d", "90d"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => applyPreset(p)}
              className={cn(
                "rounded px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider transition",
                preset === p
                  ? "bg-arena-violet text-white"
                  : "text-muted-foreground hover:text-white",
              )}
            >
              {p === "all" ? "All" : p}
            </button>
          ))}
        </div>
        <Input
          type="date"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            setPreset("all");
          }}
          className="h-9 w-[140px] text-xs"
          aria-label="From date"
        />
        <span className="text-xs text-muted-foreground">→</span>
        <Input
          type="date"
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setPreset("all");
          }}
          className="h-9 w-[140px] text-xs"
          aria-label="To date"
        />
        {hasFilters && (
          <Button
            size="sm"
            variant="arenaOutline"
            className="h-9 px-2 text-[11px]"
            onClick={clearAll}
          >
            Reset
          </Button>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-10 animate-pulse rounded-lg bg-arena-bg/60"
            />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-arena-border p-8 text-center text-xs text-muted-foreground">
          {txs.length === 0
            ? "No transactions yet."
            : "No transactions match your filters."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-arena-border/60">
          <table className="w-full text-xs">
            <thead className="bg-arena-bg/50 text-[10px] uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Date</th>
                <th className="px-3 py-2 text-left font-semibold">Type</th>
                <th className="px-3 py-2 text-left font-semibold">Memo</th>
                <th className="px-3 py-2 text-right font-semibold">Amount</th>
                <th className="px-3 py-2 text-right font-semibold">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-arena-border/40">
              {filtered.slice(0, 100).map((t) => {
                const dir = walletDirection(t.type);
                const Icon = dir.Icon;
                const d = new Date(t.created_at);
                return (
                  <tr
                    key={t.id}
                    className="transition hover:bg-arena-bg/40"
                  >
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                      <div className="text-white/85">
                        {d.toLocaleDateString()}
                      </div>
                      <div className="text-[10px]">
                        {d.toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className={cn(
                            "grid h-6 w-6 place-items-center rounded-full bg-arena-bg/60",
                            dir.color,
                          )}
                        >
                          <Icon className="h-3 w-3" />
                        </span>
                        <span className="font-medium text-white/90">
                          {walletLabel(t.type)}
                        </span>
                      </span>
                    </td>
                    <td className="max-w-[280px] truncate px-3 py-2 text-muted-foreground">
                      {t.memo ?? "—"}
                    </td>
                    <td
                      className={cn(
                        "whitespace-nowrap px-3 py-2 text-right font-mono font-bold",
                        dir.color,
                      )}
                    >
                      {dir.sign === -1 ? "-" : "+"}
                      {money(Math.abs(t.amount_cents ?? 0))}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-mono font-semibold text-white/90">
                      {money(t.balance_after)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length > 100 && (
            <div className="border-t border-arena-border/60 bg-arena-bg/40 px-3 py-2 text-center text-[11px] text-muted-foreground">
              Showing 100 of {filtered.length} — narrow filters to see more.
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

// ---------- activity feed ----------
type ActivityCategory = "hosted" | "joined" | "winnings" | "system";
type ActivityRange = "24h" | "7d" | "30d" | "all";

type FeedItem = {
  id: string;
  title: string;
  detail: string;
  at: string;
  category: ActivityCategory;
  icon: typeof Trophy;
  accent: string;
};

const CATEGORY_META: Record<
  ActivityCategory,
  { label: string; color: string; ring: string }
> = {
  hosted: {
    label: "Hosted",
    color: "text-arena-cyan",
    ring: "ring-arena-cyan/40",
  },
  joined: {
    label: "Joined",
    color: "text-arena-violet",
    ring: "ring-arena-violet/40",
  },
  winnings: {
    label: "Winnings",
    color: "text-emerald-400",
    ring: "ring-emerald-400/40",
  },
  system: {
    label: "System",
    color: "text-muted-foreground",
    ring: "ring-muted/50",
  },
};

const RANGE_MS: Record<ActivityRange, number | null> = {
  "24h": 24 * 3600_000,
  "7d": 7 * 24 * 3600_000,
  "30d": 30 * 24 * 3600_000,
  all: null,
};

function ActivityFeed({
  isLoading,
  wallet,
  notifications,
  sessions,
  hosted,
}: {
  isLoading: boolean;
  wallet: Array<{
    id: string;
    type: string;
    amount_cents: number | null;
    memo: string | null;
    created_at: string;
  }>;
  notifications: Array<{
    id: string;
    kind: string;
    title: string;
    body: string | null;
    created_at: string;
  }>;
  sessions: Array<{
    id: string;
    lounge_id: string | null;
    amount_cents: number | null;
    entered_at: string | null;
    created_at: string;
  }>;
  hosted: Array<{
    id: string;
    title: string;
    sport: string | null;
    status: string;
    created_at: string;
  }>;
}) {
  const [active, setActive] = useState<Set<ActivityCategory>>(
    new Set(["hosted", "joined", "winnings", "system"]),
  );
  const [range, setRange] = useState<ActivityRange>("30d");

  const items = useMemo<FeedItem[]>(() => {
    const out: FeedItem[] = [];

    // Hosted matches: creation events + status changes
    for (const m of hosted) {
      out.push({
        id: `h-${m.id}`,
        title:
          m.status === "live"
            ? `Your match is LIVE: ${m.title}`
            : `You hosted ${m.title}`,
        detail: `${m.sport ?? "match"} · ${m.status}`,
        at: m.created_at,
        category: "hosted",
        icon: Trophy,
        accent: "text-arena-cyan",
      });
    }

    // Joined lounges (sessions) + entry-fee debits
    for (const s of sessions) {
      out.push({
        id: `s-${s.id}`,
        title: "Joined a lounge",
        detail: s.amount_cents
          ? `Paid ${money(Math.abs(s.amount_cents))}`
          : "Free entry",
        at: s.entered_at ?? s.created_at,
        category: "joined",
        icon: Building2,
        accent: "text-arena-violet",
      });
    }

    // Wallet events → classify
    for (const w of wallet) {
      const memo = (w.memo ?? "").toLowerCase();
      const dir = walletDirection(w.type);
      const amount = `${dir.sign === -1 ? "-" : "+"}${money(
        Math.abs(w.amount_cents ?? 0),
      )}`;

      if (
        w.type === "debit_lounge_entry" ||
        w.type === "debit_match_entry"
      ) {
        out.push({
          id: `w-${w.id}`,
          title:
            w.type === "debit_lounge_entry"
              ? "Lounge entry paid"
              : "Match entry paid",
          detail: `${amount}${w.memo ? ` · ${w.memo}` : ""}`,
          at: w.created_at,
          category: "joined",
          icon: CircleDollarSign,
          accent: "text-arena-violet",
        });
      } else if (
        w.type === "credit" &&
        (memo.includes("tip") || memo.includes("win") || memo.includes("prize"))
      ) {
        out.push({
          id: `w-${w.id}`,
          title: memo.includes("tip") ? "Tip received" : "Winnings credited",
          detail: `${amount}${w.memo ? ` · ${w.memo}` : ""}`,
          at: w.created_at,
          category: "winnings",
          icon: Coins,
          accent: "text-emerald-400",
        });
      } else if (w.type === "debit_tip") {
        out.push({
          id: `w-${w.id}`,
          title: "Tip sent",
          detail: `${amount}${w.memo ? ` · ${w.memo}` : ""}`,
          at: w.created_at,
          category: "joined",
          icon: Heart,
          accent: "text-arena-pink",
        });
      }
      // top-ups and other credits fall through — surfaced in Transaction History
    }

    // Notifications → classify by kind
    for (const n of notifications) {
      const kind = (n.kind ?? "").toLowerCase();
      let category: ActivityCategory = "system";
      let Icon: typeof Trophy = Flame;
      if (kind === "match") {
        category = "hosted";
        Icon = Trophy;
      } else if (kind === "tip" || kind === "wallet") {
        const body = (n.body ?? "").toLowerCase();
        category =
          body.includes("received") || body.includes("won") ||
          body.includes("credit") || body.includes("approved")
            ? "winnings"
            : "joined";
        Icon = kind === "tip" ? Heart : CircleDollarSign;
      } else if (kind === "chat") {
        Icon = MessageSquare;
      }
      out.push({
        id: `n-${n.id}`,
        title: n.title,
        detail: n.body ?? "",
        at: n.created_at,
        category,
        icon: Icon,
        accent: CATEGORY_META[category].color,
      });
    }

    return out.sort((a, b) => (a.at < b.at ? 1 : -1));
  }, [wallet, notifications, sessions, hosted]);

  const cutoff = RANGE_MS[range];
  const now = Date.now();
  const filtered = items.filter((i) => {
    if (!active.has(i.category)) return false;
    if (cutoff !== null && now - new Date(i.at).getTime() > cutoff) return false;
    return true;
  });

  const counts: Record<ActivityCategory, number> = {
    hosted: 0,
    joined: 0,
    winnings: 0,
    system: 0,
  };
  for (const i of items) {
    if (cutoff === null || now - new Date(i.at).getTime() <= cutoff) {
      counts[i.category]++;
    }
  }

  const toggle = (c: ActivityCategory) => {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(c)) {
        // Don't allow zero-filter (fall back to all)
        if (next.size === 1) return new Set(["hosted", "joined", "winnings", "system"]);
        next.delete(c);
      } else {
        next.add(c);
      }
      return next;
    });
  };

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-arena-pink" /> Recent Activity
        </span>
      }
      action={
        <div className="flex items-center gap-1 rounded-md border border-arena-border bg-arena-bg/50 p-0.5">
          {(["24h", "7d", "30d", "all"] as ActivityRange[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={cn(
                "rounded px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider transition",
                range === r
                  ? "bg-arena-violet text-white"
                  : "text-muted-foreground hover:text-white",
              )}
            >
              {r === "all" ? "All time" : r}
            </button>
          ))}
        </div>
      }
    >
      {/* Category chips */}
      <div className="mb-4 flex flex-wrap gap-2">
        {(Object.keys(CATEGORY_META) as ActivityCategory[]).map((c) => {
          const meta = CATEGORY_META[c];
          const on = active.has(c);
          return (
            <button
              key={c}
              type="button"
              onClick={() => toggle(c)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider ring-1 transition",
                on
                  ? cn("bg-arena-bg/70", meta.color, meta.ring)
                  : "bg-transparent text-muted-foreground/60 ring-arena-border hover:text-white",
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  on ? meta.color.replace("text-", "bg-") : "bg-muted",
                )}
              />
              {meta.label}
              <span
                className={cn(
                  "ml-0.5 rounded bg-arena-bg/80 px-1.5 py-0.5 text-[9px] font-mono",
                  on ? "text-white/90" : "text-muted-foreground/60",
                )}
              >
                {counts[c]}
              </span>
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-12 animate-pulse rounded-lg bg-arena-bg/60"
            />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-arena-border p-8 text-center text-xs text-muted-foreground">
          No activity in this range. Try widening the time or category filters.
        </div>
      ) : (
        <ul className="divide-y divide-arena-border/60">
          {filtered.slice(0, 15).map((a) => {
            const Icon = a.icon;
            const meta = CATEGORY_META[a.category];
            return (
              <li
                key={a.id}
                className="flex items-center gap-3 py-2.5 text-xs"
              >
                <span
                  className={cn(
                    "grid h-8 w-8 shrink-0 place-items-center rounded-full bg-arena-bg/60 ring-1",
                    a.accent,
                    meta.ring,
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-white/90">
                    {a.title}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {a.detail}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-0.5">
                  <span
                    className={cn(
                      "text-[9px] font-bold uppercase tracking-widest",
                      meta.color,
                    )}
                  >
                    {meta.label}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {timeAgo(a.at)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

// ---------- page ----------

function DashboardPage() {
  const { user, roles, isAdmin, isModerator } = useAuth();

  const { data, isLoading } = useUserDashboard(user?.id);

  const displayName =
    (user?.user_metadata as { display_name?: string } | null)?.display_name ??
    user?.email?.split("@")[0] ??
    "You";

  // Derived
  const wallet = data?.wallet ?? [];
  const balanceCents = wallet.reduce((sum, w) => {
    const { sign } = walletDirection(w.type);
    return sum + sign * Math.abs(w.amount_cents ?? 0);
  }, 0);

  const totalSpent = wallet
    .filter((w) => walletDirection(w.type).sign === -1)
    .reduce((s, w) => s + Math.abs(w.amount_cents ?? 0), 0);

  const tipsSent = wallet
    .filter((w) => w.type === "debit_tip")
    .reduce((s, w) => s + Math.abs(w.amount_cents ?? 0), 0);

  const tipsReceived = wallet
    .filter(
      (w) => w.type === "credit" && (w.memo?.toLowerCase().includes("tip") ?? false),
    )
    .reduce((s, w) => s + Math.abs(w.amount_cents ?? 0), 0);

  const sessionsCount = data?.sessions.length ?? 0;
  const hosted = data?.hostedMatches ?? [];
  const liveHosted = hosted.filter((m) => m.status === "live");

  return (
    <AppShell>
      <div className="relative min-h-[calc(100vh-64px)] bg-arena-bg">
        <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 sm:py-8">
          {/* Header */}
          <div className="relative mb-6 overflow-hidden rounded-2xl border border-arena-border bg-arena-panel p-6">
            <div className="pointer-events-none absolute inset-0 -z-10 opacity-30 bg-[radial-gradient(circle_at_top_right,rgba(139,92,246,0.35),transparent_60%)]" />
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-arena-violet">
                  Your PGX Dashboard
                </div>
                <h1 className="mt-1 flex items-center gap-2 font-display text-2xl font-extrabold uppercase tracking-tight text-white sm:text-3xl">
                  Welcome back, {displayName}
                  {isAdmin && (
                    <Crown className="h-5 w-5 text-amber-400" />
                  )}
                </h1>
                <p className="mt-1 text-xs text-muted-foreground">
                  {user?.email}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {roles.length === 0 ? (
                    <Badge variant="outline">Member</Badge>
                  ) : (
                    roles.map((r) => (
                      <Badge
                        key={r}
                        variant={
                          r === "admin"
                            ? "default"
                            : r === "moderator"
                              ? "secondary"
                              : "outline"
                        }
                      >
                        {r}
                      </Badge>
                    ))
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <Link to="/wallet">
                    <WalletIcon className="mr-1.5 h-4 w-4" /> Wallet
                  </Link>
                </Button>
                <Button asChild size="sm" variant="arenaOutline">
                  <Link to="/">
                    <Trophy className="mr-1.5 h-4 w-4" /> Browse Lounges
                  </Link>
                </Button>
                {(isAdmin || isModerator) && (
                  <Button asChild size="sm" variant="arenaOutline">
                    <Link to="/admin">
                      <Sparkles className="mr-1.5 h-4 w-4" /> Admin
                    </Link>
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Stat cards */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard
              icon={WalletIcon}
              label="Wallet Balance"
              value={money(balanceCents)}
              sub="Available now"
              accent="bg-emerald-500/15 text-emerald-400 ring-emerald-500/30"
              glow="bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.25),transparent_60%)]"
            />
            <StatCard
              icon={CircleDollarSign}
              label="Total Spent (30d)"
              value={money(totalSpent)}
              sub="Entry fees + tips"
              accent="bg-arena-pink/15 text-arena-pink ring-arena-pink/30"
              glow="bg-[radial-gradient(circle_at_top_left,rgba(236,72,153,0.25),transparent_60%)]"
            />
            <StatCard
              icon={Coins}
              label="Tips Sent"
              value={money(tipsSent)}
              sub={`${money(tipsReceived)} received`}
              accent="bg-amber-500/15 text-amber-400 ring-amber-500/30"
              glow="bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.25),transparent_60%)]"
            />
            <StatCard
              icon={Trophy}
              label="Lounges Joined"
              value={String(sessionsCount)}
              sub="Last 30 days"
              accent="bg-arena-violet/15 text-arena-violet ring-arena-violet/30"
              glow="bg-[radial-gradient(circle_at_top_left,rgba(139,92,246,0.25),transparent_60%)]"
            />
          </div>

          {/* Wallet snapshot + Hosted matches */}
          <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_1.2fr]">
            <Panel
              title={
                <span className="flex items-center gap-2">
                  <WalletIcon className="h-4 w-4 text-emerald-400" /> Wallet
                  Snapshot
                </span>
              }
              action={
                <Link
                  to="/wallet"
                  className="text-xs font-semibold text-arena-violet hover:text-arena-pink"
                >
                  Manage
                </Link>
              }
            >
              <div className="rounded-xl border border-arena-border bg-arena-bg/50 p-4">
                <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
                  Current Balance
                </div>
                <div className="mt-1 font-display text-3xl font-extrabold text-white">
                  {money(balanceCents)}
                </div>
                <div className="mt-3 flex gap-2">
                  <Button asChild size="sm" className="flex-1">
                    <Link to="/wallet">
                      <ArrowDownRight className="mr-1.5 h-3.5 w-3.5" /> Top up
                    </Link>
                  </Button>
                  <Button asChild size="sm" variant="arenaOutline" className="flex-1">
                    <Link to="/wallet">
                      <ArrowUpRight className="mr-1.5 h-3.5 w-3.5" /> Withdraw
                    </Link>
                  </Button>
                </div>
              </div>

              <div className="mt-4">
                <div className="mb-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                  Recent transactions
                </div>
                {isLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div
                        key={i}
                        className="h-10 animate-pulse rounded-lg bg-arena-bg/60"
                      />
                    ))}
                  </div>
                ) : wallet.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-arena-border p-4 text-center text-xs text-muted-foreground">
                    No transactions yet.
                  </div>
                ) : (
                  <ul className="divide-y divide-arena-border/60">
                    {wallet.slice(0, 5).map((w) => {
                      const dir = walletDirection(w.type);
                      const Icon = dir.Icon;
                      return (
                        <li
                          key={w.id}
                          className="flex items-center justify-between gap-2 py-2.5 text-xs"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className={cn(
                                "grid h-7 w-7 place-items-center rounded-full bg-arena-bg/60",
                                dir.color,
                              )}
                            >
                              <Icon className="h-3.5 w-3.5" />
                            </span>
                            <div className="min-w-0">
                              <div className="truncate font-medium text-white/90">
                                {walletLabel(w.type)}
                              </div>
                              <div className="text-[10px] text-muted-foreground">
                                {timeAgo(w.created_at)}
                              </div>
                            </div>
                          </div>
                          <div
                            className={cn(
                              "font-mono text-sm font-bold",
                              dir.color,
                            )}
                          >
                            {dir.sign === -1 ? "-" : "+"}
                            {money(Math.abs(w.amount_cents ?? 0))}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </Panel>

            <Panel
              title={
                <span className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-arena-cyan" /> My Hosted
                  Matches
                </span>
              }
              action={
                liveHosted.length > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    {liveHosted.length} live
                  </span>
                )
              }
            >
              {isLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div
                      key={i}
                      className="h-14 animate-pulse rounded-lg bg-arena-bg/60"
                    />
                  ))}
                </div>
              ) : hosted.length === 0 ? (
                <div className="rounded-lg border border-dashed border-arena-border p-6 text-center text-xs text-muted-foreground">
                  You haven't hosted any matches yet.
                </div>
              ) : (
                <ul className="space-y-2">
                  {hosted.slice(0, 6).map((m) => (
                    <li key={m.id}>
                      <Link
                        to="/matches/$matchId"
                        params={{ matchId: m.id }}
                        className="group flex items-center justify-between gap-3 rounded-lg border border-arena-border/60 bg-arena-bg/40 px-3 py-2.5 transition hover:border-arena-violet/50 hover:bg-arena-panel-2/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-arena-violet/60"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {m.thumbnail_url ? (
                            <img
                              src={m.thumbnail_url}
                              alt={m.title}
                              className="h-10 w-14 rounded-md object-cover ring-1 ring-arena-border"
                              loading="lazy"
                            />
                          ) : (
                            <div className="grid h-10 w-14 place-items-center rounded-md bg-gradient-to-br from-arena-violet/30 to-arena-pink/30 text-[10px] font-bold uppercase text-white/70 ring-1 ring-arena-border">
                              {(m.sport ?? m.title).slice(0, 3)}
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-white group-hover:text-arena-violet">
                              {m.title}
                            </div>
                            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                              {m.sport ?? "match"} · {timeAgo(m.created_at)}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                              m.status === "live"
                                ? "bg-emerald-500/15 text-emerald-400"
                                : "bg-muted/40 text-muted-foreground",
                            )}
                          >
                            {m.status === "live" && (
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            )}
                            {m.status}
                          </span>
                          <span className="hidden text-[11px] font-semibold uppercase tracking-wider text-arena-violet opacity-0 transition group-hover:opacity-100 sm:inline">
                            Details →
                          </span>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>

              )}
            </Panel>
          </div>

          {/* Transaction history */}
          <div className="mt-6">
            <TransactionHistoryTable userId={user?.id} />
          </div>

          {/* Recent activity */}
          <div className="mt-6">
            <ActivityFeed
              isLoading={isLoading}
              wallet={wallet}
              notifications={data?.notifications ?? []}
              sessions={data?.sessions ?? []}
              hosted={hosted}
            />
          </div>

          {/* Notification preferences */}
          <div className="mt-6">
            <NotificationPreferencesPanel userId={user?.id} />
          </div>




          {/* Quick links row */}
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <QuickLink to="/" icon={Trophy} title="Browse Lounges" />
            <QuickLink to="/friends" icon={UsersIcon} title="Friends" />
            <QuickLink to="/wallet" icon={History} title="Full history" />
            <QuickLink to="/profile" icon={Sparkles} title="Edit profile" />
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function QuickLink({
  to,
  icon: Icon,
  title,
}: {
  to: "/" | "/friends" | "/wallet" | "/profile";
  icon: typeof Trophy;
  title: string;
}) {
  return (
    <Link
      to={to}
      className="group flex items-center gap-3 rounded-xl border border-arena-border bg-arena-panel px-4 py-3 transition hover:border-arena-violet/50 hover:bg-arena-panel-2/60"
    >
      <span className="grid h-9 w-9 place-items-center rounded-full bg-arena-violet/15 text-arena-violet ring-1 ring-arena-violet/30">
        <Icon className="h-4 w-4" />
      </span>
      <span className="text-sm font-semibold uppercase tracking-wider text-white/85 group-hover:text-white">
        {title}
      </span>
    </Link>
  );
}

// ---------- Notification preferences ----------
import {
  useNotifPrefs,
  DEFAULT_PREFS,
  detectTimezone,
  isQuietHourNow,
  type NotifPrefs,
  type NotifPrefKey,
  type QuietHours,
} from "@/hooks/useNotificationPrefs";
import { usePushPermission } from "@/hooks/usePushPermission";

/** Compact "just now / 3m ago / Jul 12" label that auto-refreshes each minute. */
function useRelativeTime(iso: string | null): string | null {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!iso) return;
    const id = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [iso]);
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  const diff = Math.max(0, Date.now() - then);
  const sec = Math.floor(diff / 1000);
  if (sec < 45) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return "a while ago";
  }
}

/** Absolute-time tooltip for the "Last synced" chip. */
function formatSyncedAbsolute(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}


const CATEGORIES: {
  key: NotifPrefKey;
  title: string;
  desc: string;
  icon: typeof Trophy;
  accent: string;
}[] = [
  {
    key: "hostedMatches",
    title: "Hosted matches",
    desc: "Updates on matches you host — joins, status changes, results.",
    icon: Building2,
    accent: "bg-arena-cyan/15 text-arena-cyan ring-arena-cyan/30",
  },
  {
    key: "liveLobbies",
    title: "Live lobbies",
    desc: "Alerts when lounges you follow go live or fill up.",
    icon: Flame,
    accent: "bg-arena-pink/15 text-arena-pink ring-arena-pink/30",
  },
  {
    key: "walletChanges",
    title: "Wallet changes",
    desc: "Top-ups, withdrawals, entry fees and refunds.",
    icon: WalletIcon,
    accent: "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30",
  },
  {
    key: "tips",
    title: "Tips received",
    desc: "Notify me when someone sends me a tip.",
    icon: Coins,
    accent: "bg-amber-500/15 text-amber-400 ring-amber-500/30",
  },
  {
    key: "friendRequests",
    title: "Friend requests",
    desc: "New requests and accepted invites.",
    icon: UsersIcon,
    accent: "bg-arena-violet/15 text-arena-violet ring-arena-violet/30",
  },
  {
    key: "system",
    title: "System & announcements",
    desc: "Product updates and maintenance notices.",
    icon: Sparkles,
    accent: "bg-muted/40 text-muted-foreground ring-arena-border",
  },
];


function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition",
        checked
          ? "border-arena-violet/60 bg-arena-violet/40"
          : "border-arena-border bg-arena-bg/70",
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 transform rounded-full bg-white shadow transition",
          checked ? "translate-x-6" : "translate-x-1",
        )}
      />
    </button>
  );
}

function NotificationPreferencesPanel({
  userId,
}: {
  userId: string | undefined;
}) {
  const {
    prefs,
    setPrefs,
    hydrated,
    saveStatus,
    saveError,
    lastSyncedAt,
    retrySave,
  } = useNotifPrefs(userId);
  const lastSyncedLabel = useRelativeTime(lastSyncedAt);

  const enabledCount = Object.values(prefs.categories).filter(Boolean).length;
  const anyChannel =
    prefs.channels.inApp || prefs.channels.email || prefs.channels.push;

  const push = usePushPermission();

  // Auto-disable stored push channel if the browser revokes permission.
  useEffect(() => {
    if (!hydrated) return;
    if (prefs.channels.push && (push.denied || !push.supported)) {
      setPrefs((p) => ({ ...p, channels: { ...p.channels, push: false } }));
    }
  }, [push.denied, push.supported, hydrated, prefs.channels.push, setPrefs]);

  const setCategory = (key: NotifPrefKey, v: boolean) =>
    setPrefs((p) => ({ ...p, categories: { ...p.categories, [key]: v } }));
  const setChannel = async (
    key: keyof NotifPrefs["channels"],
    v: boolean,
  ) => {
    if (key === "push" && v) {
      if (!push.supported) {
        toast.error("Push not supported", {
          description: "This browser doesn't support web notifications.",
        });
        return;
      }
      if (push.permission === "denied") {
        toast.error("Push blocked", {
          description:
            "Notifications are blocked in your browser settings. Allow them for this site, then try again.",
        });
        return;
      }
      if (push.permission !== "granted") {
        const next = await push.request();
        if (next !== "granted") {
          toast.warning("Push permission not granted", {
            description:
              next === "denied"
                ? "You blocked notifications. Update your browser site settings to enable."
                : "Permission dismissed — try again to enable push.",
          });
          return;
        }
      }
    }
    setPrefs((p) => ({ ...p, channels: { ...p.channels, [key]: v } }));
  };

  const enableAll = () =>
    setPrefs((p) => ({
      ...p,
      categories: Object.fromEntries(
        Object.keys(p.categories).map((k) => [k, true]),
      ) as NotifPrefs["categories"],
    }));
  const muteAll = () =>
    setPrefs((p) => ({
      ...p,
      categories: Object.fromEntries(
        Object.keys(p.categories).map((k) => [k, false]),
      ) as NotifPrefs["categories"],
    }));
  const resetDefaults = () => {
    setPrefs(DEFAULT_PREFS);
    toast.success("Notification preferences reset to defaults", {
      description: userId
        ? "Syncing the change to your profile…"
        : "Signed-out — saved to this device only.",
    });
  };
  const resetCategories = () =>
    setPrefs((p) => ({ ...p, categories: DEFAULT_PREFS.categories }));

  const isDefault =
    JSON.stringify(prefs) === JSON.stringify(DEFAULT_PREFS);


  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          {anyChannel ? (
            <Bell className="h-4 w-4 text-arena-violet" />
          ) : (
            <BellOff className="h-4 w-4 text-muted-foreground" />
          )}
          Notification Preferences
        </span>
      }
      action={
        <div className="flex items-center gap-2">
          {saveStatus === "saving" && (
            <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-300">
              Saving…
            </span>
          )}
          {saveStatus === "saved" && (
            <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
              Synced
            </span>
          )}
          {saveStatus === "error" && (
            <button
              type="button"
              onClick={() => void retrySave()}
              title={saveError ?? "Failed to save"}
              className="text-[10px] font-semibold uppercase tracking-wider text-rose-300 underline decoration-dotted underline-offset-2 hover:text-rose-200"
            >
              Retry save
            </button>
          )}
          {userId && lastSyncedLabel && saveStatus !== "saving" && (
            <span
              title={`Last synced ${formatSyncedAbsolute(lastSyncedAt)}`}
              className="text-[10px] uppercase tracking-wider text-muted-foreground"
            >
              Synced {lastSyncedLabel}
            </span>
          )}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                disabled={isDefault || !hydrated}
                className="h-7 gap-1.5 border-arena-border/70 text-[11px]"
              >
                <RotateCcw className="h-3 w-3" />
                Reset to defaults
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset notification preferences?</AlertDialogTitle>
                <AlertDialogDescription>
                  This restores every channel, category, and quiet-hours
                  setting to the defaults{" "}
                  {userId
                    ? "and syncs the change to your profile so all your devices update."
                    : "on this device."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={resetDefaults}>
                  Reset to defaults
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <span className="text-[11px] uppercase tracking-widest text-muted-foreground">
            {enabledCount} of {CATEGORIES.length} on
          </span>
        </div>
      }
    >
      {/* Channels */}
      <div className="rounded-xl border border-arena-border bg-arena-bg/50 p-4">
        <div className="mb-3 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          Delivery channels
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {(
            [
              { key: "inApp", label: "In-app" },
              { key: "email", label: "Email" },
              { key: "push", label: "Push" },
            ] as const
          ).map((c) => (
            <div
              key={c.key}
              className="flex items-center justify-between rounded-lg border border-arena-border/60 bg-arena-panel-2/40 px-3 py-2"
            >
              <span className="text-sm font-medium text-white/90">
                {c.label}
              </span>
              <Toggle
                checked={prefs.channels[c.key]}
                onChange={(v) => setChannel(c.key, v)}
                label={`${c.label} notifications`}
              />
            </div>
          ))}
        </div>
        {!anyChannel && (
          <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
            All channels are off — you won't receive any notifications.
          </div>
        )}
      </div>

      {/* Push permission status */}
      <PushStatusCard push={push} channelOn={prefs.channels.push} />



      {/* Categories */}
      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            Categories
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={enableAll}>
              Enable all
            </Button>
            <Button size="sm" variant="ghost" onClick={muteAll}>
              Mute all
            </Button>
            <Button size="sm" variant="ghost" onClick={resetCategories}>
              Reset
            </Button>
          </div>
        </div>
        <ul className="divide-y divide-arena-border/60 rounded-xl border border-arena-border bg-arena-bg/40">
          {CATEGORIES.map((c) => {
            const Icon = c.icon;
            const on = prefs.categories[c.key];
            return (
              <li
                key={c.key}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={cn(
                      "grid h-9 w-9 place-items-center rounded-full ring-1",
                      c.accent,
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-white/90">
                      {c.title}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {c.desc}
                    </div>
                  </div>
                </div>
                <Toggle
                  checked={on}
                  onChange={(v) => setCategory(c.key, v)}
                  label={c.title}
                />
              </li>
            );
          })}
        </ul>
      </div>

      {/* Quiet hours */}
      <QuietHoursSection
        quiet={prefs.quietHours}
        onChange={(next) => setPrefs((p) => ({ ...p, quietHours: next }))}
      />


      <SendTestSection
        prefs={prefs}
        disabled={!hydrated}
      />
    </Panel>
  );
}

// A curated shortlist keeps the picker small; the free-text field below
// covers users whose IANA zone isn't on the list.
const TIMEZONE_SHORTLIST = [
  "UTC",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Athens",
  "Africa/Johannesburg",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
];

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function formatZoneNow(tz: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZoneName: "short",
    }).format(new Date());
  } catch {
    return "—";
  }
}

function PushStatusCard({
  push,
  channelOn,
}: {
  push: ReturnType<typeof usePushPermission>;
  channelOn: boolean;
}) {
  const { permission, supported, request, showTest } = push;

  const meta = !supported
    ? {
        label: "Unsupported",
        chip: "bg-muted/40 text-muted-foreground ring-white/10",
        dot: "bg-muted-foreground",
        desc: "This browser can't receive web push notifications.",
      }
    : permission === "granted"
      ? {
          label: channelOn ? "Enabled" : "Allowed",
          chip: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
          dot: "bg-emerald-400",
          desc: channelOn
            ? "Push notifications will surface via your browser."
            : "Browser allows push — turn on the Push channel above to receive them.",
        }
      : permission === "denied"
        ? {
            label: "Blocked",
            chip: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
            dot: "bg-rose-400",
            desc: "You blocked notifications for this site. Update your browser's site settings to re-enable.",
          }
        : {
            label: "Not requested",
            chip: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
            dot: "bg-amber-400",
            desc: "Grant permission to receive push notifications from this browser.",
          };

  const handleRequest = async () => {
    const next = await request();
    if (next === "granted") {
      toast.success("Push notifications enabled");
    } else if (next === "denied") {
      toast.error("Push blocked", {
        description:
          "Update your browser's site settings for this page to re-enable.",
      });
    } else if (next === "unsupported") {
      toast.error("Push not supported in this browser");
    } else {
      toast.warning("Permission dismissed");
    }
  };

  const handleTest = () => {
    const ok = showTest("Test push", "This is a browser push preview.");
    if (!ok) toast.error("Couldn't send a browser push right now.");
  };

  return (
    <div className="mt-3 rounded-xl border border-arena-border bg-arena-bg/50 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          Browser push status
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset",
            meta.chip,
          )}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
          {meta.label}
        </span>
      </div>
      <p className="text-xs leading-relaxed text-white/70">{meta.desc}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {supported && permission !== "granted" && permission !== "denied" && (
          <button
            type="button"
            onClick={handleRequest}
            className="rounded-md bg-arena-violet px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-arena-violet/90"
          >
            Enable browser push
          </button>
        )}
        {supported && permission === "granted" && (
          <button
            type="button"
            onClick={handleTest}
            className="rounded-md border border-arena-border bg-arena-panel-2/60 px-3 py-1.5 text-xs font-semibold text-white/90 hover:bg-arena-panel-2"
          >
            Send browser test
          </button>
        )}
        {supported && permission === "denied" && (
          <span className="text-[11px] text-white/60">
            Click the lock icon in your address bar → Site settings → allow
            Notifications.
          </span>
        )}
      </div>
    </div>
  );
}



function QuietHoursSection({
  quiet,
  onChange,
}: {
  quiet: QuietHours;
  onChange: (next: QuietHours) => void;
}) {
  const detected = useMemo(() => detectTimezone(), []);
  const [tzDraft, setTzDraft] = useState(quiet.timezone);
  const [tzError, setTzError] = useState<string | null>(null);

  useEffect(() => {
    setTzDraft(quiet.timezone);
    setTzError(null);
  }, [quiet.timezone]);

  const options = useMemo(() => {
    const set = new Set<string>(TIMEZONE_SHORTLIST);
    set.add(detected);
    set.add(quiet.timezone);
    return Array.from(set);
  }, [detected, quiet.timezone]);

  const overnight = toMinutesLocal(quiet.start) > toMinutesLocal(quiet.end);
  const emptyWindow =
    quiet.enabled && toMinutesLocal(quiet.start) === toMinutesLocal(quiet.end);
  const activeNow = isQuietHourNow(quiet);

  const commitTz = (v: string) => {
    const trimmed = v.trim();
    if (!trimmed) {
      setTzError("Timezone can't be empty");
      return;
    }
    if (!isValidTimezone(trimmed)) {
      setTzError("Unknown timezone");
      return;
    }
    setTzError(null);
    onChange({ ...quiet, timezone: trimmed });
  };

  return (
    <div className="mt-4 rounded-xl border border-arena-border bg-arena-bg/50 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-white/90">
            Quiet hours
          </div>
          <div className="text-[11px] text-muted-foreground">
            Silence non-urgent notifications during a window in your account
            timezone. Overnight ranges and daylight-saving are handled
            automatically.
          </div>
        </div>
        <Toggle
          checked={quiet.enabled}
          onChange={(v) => onChange({ ...quiet, enabled: v })}
          label="Enable quiet hours"
        />
      </div>

      <div
        className={cn(
          "mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_1.4fr] transition",
          quiet.enabled ? "opacity-100" : "opacity-60",
        )}
      >
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Start
          </span>
          <input
            type="time"
            value={quiet.start}
            disabled={!quiet.enabled}
            onChange={(e) =>
              onChange({
                ...quiet,
                start: normalizeInputTime(e.target.value, quiet.start),
              })
            }
            className="h-9 rounded-md border border-arena-border bg-arena-panel-2/40 px-2 text-sm text-white/90 focus:border-arena-violet focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            End
          </span>
          <input
            type="time"
            value={quiet.end}
            disabled={!quiet.enabled}
            onChange={(e) =>
              onChange({
                ...quiet,
                end: normalizeInputTime(e.target.value, quiet.end),
              })
            }
            className="h-9 rounded-md border border-arena-border bg-arena-panel-2/40 px-2 text-sm text-white/90 focus:border-arena-violet focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Timezone
          </span>
          <div className="flex gap-2">
            <select
              value={options.includes(tzDraft) ? tzDraft : ""}
              disabled={!quiet.enabled}
              onChange={(e) => {
                setTzDraft(e.target.value);
                commitTz(e.target.value);
              }}
              className="h-9 min-w-0 flex-1 rounded-md border border-arena-border bg-arena-panel-2/40 px-2 text-sm text-white/90 focus:border-arena-violet focus:outline-none"
            >
              <option value="" disabled>
                Custom…
              </option>
              {options.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                  {tz === detected ? " (device)" : ""}
                </option>
              ))}
            </select>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={!quiet.enabled || quiet.timezone === detected}
              onClick={() => {
                setTzDraft(detected);
                commitTz(detected);
              }}
            >
              Use device
            </Button>
          </div>
          <input
            type="text"
            value={tzDraft}
            disabled={!quiet.enabled}
            placeholder="e.g. America/New_York"
            onChange={(e) => setTzDraft(e.target.value)}
            onBlur={(e) => commitTz(e.target.value)}
            aria-invalid={!!tzError}
            className={cn(
              "h-8 rounded-md border bg-arena-panel-2/40 px-2 text-xs text-white/80 focus:outline-none",
              tzError
                ? "border-red-500/60 focus:border-red-500"
                : "border-arena-border/60 focus:border-arena-violet",
            )}
          />
          {tzError && (
            <span className="text-[10px] text-red-400">{tzError}</span>
          )}
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <div className="flex flex-wrap items-center gap-2">
          <span>
            Now in {quiet.timezone}:{" "}
            <span className="font-mono text-white/80">
              {formatZoneNow(quiet.timezone)}
            </span>
          </span>
          {overnight && quiet.enabled && (
            <span className="rounded-full border border-arena-violet/40 bg-arena-violet/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-arena-violet">
              Overnight
            </span>
          )}
          {activeNow && (
            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
              Active now
            </span>
          )}
          {emptyWindow && (
            <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300">
              Empty window (start = end)
            </span>
          )}
        </div>
        <span>
          Wallet &amp; tips still ring through — urgent alerts bypass quiet
          hours.
        </span>
      </div>
    </div>
  );
}

function toMinutesLocal(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return 0;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function normalizeInputTime(v: string, fallback: string): string {
  // <input type="time"> gives "HH:MM" but empty on clear; keep previous
  // value in that case so we never persist an invalid string.
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : fallback;
}


function SendTestSection({
  prefs,
  disabled,
}: {
  prefs: NotifPrefs;
  disabled: boolean;
}) {
  const runTest = useServerFn(sendTestNotification);
  const [pending, setPending] = useState<NotifPrefKey | null>(null);

  const activeCategories = CATEGORIES.filter((c) => prefs.categories[c.key]);
  const defaultCategory: NotifPrefKey =
    activeCategories[0]?.key ?? "walletChanges";

  async function trigger(category: NotifPrefKey) {
    if (pending) return;
    setPending(category);
    try {
      await runTest({ data: { category } });
      const cat = CATEGORIES.find((c) => c.key === category);
      const inApp = prefs.channels.inApp;
      const catOn = prefs.categories[category];
      if (!catOn) {
        toast.warning(`Test sent — ${cat?.title ?? category} is muted`, {
          description:
            "The notification was created but your settings will hide it. Enable this category to see it in-app.",
        });
      } else if (!inApp) {
        toast.warning("Test sent — in-app channel is off", {
          description:
            "The notification is in your inbox, but no toast will appear because In-app is disabled.",
        });
      } else {
        // The realtime listener will surface the in-app toast itself.
      }
      if (prefs.channels.email || prefs.channels.push) {
        toast.info("Email & push delivery is not wired yet", {
          description:
            "Only in-app notifications are delivered right now. Email/push channels are stored but not sent.",
          duration: 4500,
        });
      }
    } catch (err) {
      toast.error("Test failed", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-arena-border bg-arena-bg/50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-white/90">
            Send test notification
          </div>
          <div className="text-[11px] text-muted-foreground">
            Fires a test event through the same pipeline as real notifications.
            Your channel &amp; category toggles decide what surfaces.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            disabled={disabled || !!pending}
            onClick={() => void trigger(defaultCategory)}
            className="gap-2"
          >
            {pending === defaultCategory ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Send test
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                disabled={disabled || !!pending}
                aria-label="Choose test category"
              >
                Category…
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="text-[11px] uppercase tracking-widest text-muted-foreground">
                Test a category
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {CATEGORIES.map((c) => {
                const on = prefs.categories[c.key];
                return (
                  <DropdownMenuItem
                    key={c.key}
                    onSelect={() => void trigger(c.key)}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="truncate">{c.title}</span>
                    <span
                      className={cn(
                        "text-[10px] font-semibold uppercase tracking-wider",
                        on ? "text-emerald-400" : "text-muted-foreground",
                      )}
                    >
                      {on ? "On" : "Muted"}
                    </span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <p className="mt-3 text-[10px] text-muted-foreground">
        Preferences sync to your account and follow you across devices. Only
        the in-app channel is actively delivered; email &amp; push are stored
        for future use.
      </p>
    </div>
  );
}
