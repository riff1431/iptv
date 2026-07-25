import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect } from "react";
import { SendTipDialog } from "@/components/tips/SendTipDialog";
import {
  ArrowDownRight,
  ArrowUpRight,
  Loader2,
  MessageSquare,
  MessagesSquare,
  Coins,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { listTips, type TipDirection, type TipEntry } from "@/lib/tips.functions";

function fmt(cents: number) {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

interface Props {
  userId: string;
  direction: "all" | TipDirection;
  page: number;
  pageSize: number;
  onDirectionChange: (v: "all" | TipDirection) => void;
  onPageChange: (page: number) => void;
}

export function TipsTab({
  userId,
  direction,
  page,
  pageSize,
  onDirectionChange,
  onPageChange,
}: Props) {
  const qc = useQueryClient();
  const listFn = useServerFn(listTips);
  const [sendOpen, setSendOpen] = useState(false);

  const query = useQuery({
    queryKey: ["wallet", "tips", userId, direction, page, pageSize],
    queryFn: () => listFn({ data: { direction, page, pageSize } }),
    staleTime: 5_000,
  });

  // Realtime: tips changes come via wallet_transactions subscription in the
  // parent (any row for this user or with recipient_user_id = user). We also
  // subscribe here for recipient-only inserts (credit rows) since the parent
  // filter is user_id=eq only.
  useEffect(() => {
    const channel = supabase
      .channel(`tips-recv-${userId}-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "wallet_transactions",
          filter: `recipient_user_id=eq.${userId}`,
        },
        () => {
          void qc.invalidateQueries({ queryKey: ["wallet"] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, qc]);

  const totals = query.data;
  const rows = query.data?.rows ?? [];
  const total = query.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pageCount);

  const summary = useMemo(
    () => [
      {
        label: "Tips sent",
        value: totals ? fmt(totals.totalSentCents) : "—",
        count: totals?.countSent ?? 0,
        icon: ArrowDownRight,
        tone: "text-fuchsia-400",
      },
      {
        label: "Tips received",
        value: totals ? fmt(totals.totalReceivedCents) : "—",
        count: totals?.countReceived ?? 0,
        icon: ArrowUpRight,
        tone: "text-emerald-400",
      },
      {
        label: "Net",
        value:
          totals ? fmt((totals.totalReceivedCents ?? 0) - (totals.totalSentCents ?? 0)) : "—",
        icon: Coins,
        tone: "text-arena-violet",
      },
    ],
    [totals],
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {summary.map((s) => (
          <div key={s.label} className="arena-card rounded-lg p-3">
            <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
              <span>{s.label}</span>
              <s.icon className={`h-3.5 w-3.5 ${s.tone}`} />
            </div>
            <div className={`mt-1 font-display text-xl font-extrabold tabular-nums ${s.tone}`}>
              {query.isLoading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : s.value}
            </div>
            {"count" in s && (
              <div className="text-[10px] text-muted-foreground">{s.count} entries</div>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={direction} onValueChange={(v) => onDirectionChange(v as "all" | TipDirection)}>
          <SelectTrigger className="h-9 w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All tips</SelectItem>
            <SelectItem value="sent">Sent by me</SelectItem>
            <SelectItem value="received">Received</SelectItem>
          </SelectContent>
        </Select>
        <Button
          size="sm"
          onClick={() => setSendOpen(true)}
          className="gap-1.5"
          aria-label="Send a tip to a friend"
        >
          <Coins className="h-3.5 w-3.5" /> Send tip
        </Button>
        <div className="ml-auto text-xs text-muted-foreground">
          {total === 0
            ? "No tips"
            : `Showing ${(currentPage - 1) * pageSize + 1}–${Math.min(currentPage * pageSize, total)} of ${total}`}
        </div>
      </div>
      <SendTipDialog open={sendOpen} onOpenChange={setSendOpen} />

      <div className="rounded-md border border-arena-border">
        {query.isLoading ? (
          <div className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading tips…
          </div>
        ) : query.error ? (
          <div className="p-5 text-sm text-rose-400">
            {query.error instanceof Error ? query.error.message : "Failed to load tips"}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            <Coins className="mx-auto mb-2 h-6 w-6 text-arena-violet/70" />
            No tips yet.
            {direction === "sent" && " Send a tip from any lounge chat or DM to appear here."}
            {direction === "received" && " Incoming tips from other members will show up here."}
          </div>
        ) : (
          <ul className="divide-y divide-arena-border/60">
            {rows.map((tip) => (
              <TipRow key={`${tip.direction}-${tip.id}`} tip={tip} />
            ))}
          </ul>
        )}
      </div>

      {total > pageSize && (
        <div className="flex items-center justify-end gap-2">
          <Button
            size="icon"
            variant="arenaGhost"
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage <= 1}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[80px] text-center text-xs text-muted-foreground">
            Page {currentPage} / {pageCount}
          </span>
          <Button
            size="icon"
            variant="arenaGhost"
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage >= pageCount}
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

function TipRow({ tip }: { tip: TipEntry }) {
  const isSent = tip.direction === "sent";
  const created = new Date(tip.created_at);
  const cp = tip.counterparty;
  const initials =
    cp?.display_name?.slice(0, 2).toUpperCase() ??
    cp?.id.slice(0, 2).toUpperCase() ??
    "??";

  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-3">
      <Avatar className="h-9 w-9 border border-arena-border">
        {cp?.avatar_url && <AvatarImage src={cp.avatar_url} alt="" />}
        <AvatarFallback className="bg-gradient-to-br from-arena-violet/40 to-arena-cyan/30 text-[10px] font-bold uppercase tracking-wider text-white/90">
          {initials}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">{isSent ? "You tipped" : "Tip from"}</span>
          <span className="font-medium text-white">
            {cp?.display_name ?? (cp ? `User ${cp.id.slice(0, 6)}` : "Unknown user")}
          </span>
          <Badge variant="outline" className="border-arena-border/60 text-[10px] uppercase tracking-wider">
            {isSent ? "Sent" : "Received"}
          </Badge>
        </div>

        {tip.memo && (
          <div className="mt-0.5 truncate text-xs italic text-muted-foreground" title={tip.memo}>
            “{tip.memo}”
          </div>
        )}

        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span>{created.toLocaleString()}</span>
          {tip.lounge && (
            <Link
              to="/lounge/$loungeId"
              params={{ loungeId: tip.lounge.slug }}
              className="inline-flex items-center gap-1 text-arena-violet hover:underline"
            >
              <MessagesSquare className="h-3 w-3" />
              {tip.lounge.name}
            </Link>
          )}
          {tip.direct_message_id && cp && (
            <Link
              to="/messages"
              search={{ peer: cp.id }}
              className="inline-flex items-center gap-1 text-arena-violet hover:underline"
            >
              <MessageSquare className="h-3 w-3" /> Open DM
            </Link>
          )}
          {!tip.lounge && !tip.direct_message_id && tip.chat_message_id && (
            <span className="font-mono text-[10px] opacity-70">msg {tip.chat_message_id.slice(0, 8)}</span>
          )}
        </div>
      </div>

      <div
        className={`font-display text-lg font-bold tabular-nums ${
          isSent ? "text-fuchsia-400" : "text-emerald-400"
        }`}
      >
        {isSent ? "-" : "+"}
        {fmt(tip.amount_cents)}
      </div>
    </li>
  );
}
