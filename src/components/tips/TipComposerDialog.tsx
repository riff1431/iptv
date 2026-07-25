import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { Loader2, Coins, MessageSquareQuote, CheckCircle2, Radio, Minus, Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { sendTip, TIP_MIN_CENTS, TIP_MAX_CENTS } from "@/lib/tips.functions";
import { getWalletOverview } from "@/lib/wallet.functions";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

const PRESETS_CENTS = [100, 300, 500, 1000, 2500];

function fmt(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export type TipComposerDialogProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  recipientUserId: string;
  recipientName: string;
  loungeId?: string;
  matchId?: string;
  chatMessageId?: string;
  directMessageId?: string;
  /** Short preview of the linked message shown in the composer. */
  messagePreview?: string;
};

export function TipComposerDialog({
  open,
  onOpenChange,
  recipientUserId,
  recipientName,
  loungeId,
  matchId,
  chatMessageId,
  directMessageId,
  messagePreview,
}: TipComposerDialogProps) {

  const { user } = useAuth();
  const qc = useQueryClient();
  const router = useRouter();
  const sendFn = useServerFn(sendTip);
  const overviewFn = useServerFn(getWalletOverview);

  const [amountCents, setAmountCents] = useState<number>(300);
  const [customDollars, setCustomDollars] = useState<string>("");
  const [memo, setMemo] = useState<string>("");
  const [status, setStatus] = useState<"idle" | "sending" | "confirming" | "confirmed" | "error">(
    "idle",
  );
  const [confirmedBalance, setConfirmedBalance] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const pendingDebitId = useRef<string | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) {
      setAmountCents(300);
      setCustomDollars("");
      setMemo("");
      setStatus("idle");
      setConfirmedBalance(null);
      pendingDebitId.current = null;
    } else if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, [open]);

  const balanceQ = useQuery({
    queryKey: ["wallet", "overview", user?.id ?? "anon"],
    queryFn: () => overviewFn(),
    enabled: Boolean(user) && open,
    staleTime: 5_000,
  });
  const balanceCents = balanceQ.data?.balanceCents ?? 0;

  const isSelf = user?.id === recipientUserId;
  const recipientError = useMemo(() => {
    if (!user) return "You must be signed in to tip.";
    if (!recipientUserId) return "Missing recipient. Pick a friend to tip.";
    if (isSelf) return "You cannot tip yourself. Pick another friend.";
    return null;
  }, [user, recipientUserId, isSelf]);

  const amountError = useMemo(() => {
    if (!Number.isFinite(amountCents) || amountCents <= 0) return "Enter an amount greater than zero.";
    if (amountCents < TIP_MIN_CENTS) return `Minimum tip is ${fmt(TIP_MIN_CENTS)}.`;
    if (amountCents > TIP_MAX_CENTS) return `Maximum tip is ${fmt(TIP_MAX_CENTS)}.`;
    if (balanceQ.data && amountCents > balanceCents)
      return `Insufficient balance. You have ${fmt(balanceCents)}.`;
    return null;
  }, [amountCents, balanceCents, balanceQ.data]);

  const validationError = recipientError ?? amountError;

  // Realtime: listen for the sender-side debit row to confirm the tip landed.
  useEffect(() => {
    if (!open || !user) return;
    const suffix = Math.random().toString(36).slice(2);
    const channel = supabase
      .channel(`tip-confirm-${user.id}-${suffix}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "wallet_transactions",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload.new as { id: string; type: string };
          if (!pendingDebitId.current) return;
          if (row.id !== pendingDebitId.current) return;
          // Debit confirmed — refetch balance then mark confirmed.
          void balanceQ
            .refetch()
            .then((r) => setConfirmedBalance(r.data?.balanceCents ?? null))
            .finally(() => {
              setStatus("confirmed");
              toast.success("Tip confirmed", {
                description: `New balance: ${fmt(
                  balanceQ.data?.balanceCents ?? balanceCents,
                )}. Composer will reset.`,
              });
              void qc.invalidateQueries({ queryKey: ["wallet"] });
              void qc.invalidateQueries({ queryKey: ["tips"] });
              closeTimer.current = setTimeout(() => {
                onOpenChange(false);
                // Explicit reset in case the parent keeps the dialog mounted.
                setAmountCents(300);
                setCustomDollars("");
                setMemo("");
                setStatus("idle");
                setConfirmedBalance(null);
                pendingDebitId.current = null;
              }, 1600);
            });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [open, user, balanceQ, qc, onOpenChange]);

  const mutation = useMutation({
    mutationFn: async () =>
      sendFn({
        data: {
          recipientUserId,
          amountCents,
          memo: memo.trim() || undefined,
          loungeId,
          matchId,
          chatMessageId,
          directMessageId,
        },
      }),

    onMutate: () => {
      setStatus("sending");
    },
    onSuccess: (res) => {
      pendingDebitId.current = res.debitId;
      setStatus("confirming");
      toast.success(`Tip sent: ${fmt(amountCents)} to ${recipientName}`, {
        description: memo.trim() ? `“${memo.trim()}”` : "View it anytime in your tipping history.",
        action: {
          label: "View history",
          onClick: () =>
            router.navigate({
              to: "/wallet",
              search: { tab: "tips", tipDir: "sent", tipPage: 1 },
            }),
        },
      });
      // Safety net: if realtime doesn't deliver within 4s, refetch and confirm.
      closeTimer.current = setTimeout(() => {
        if (status !== "confirmed") {
          void balanceQ.refetch().then((r) => {
            setConfirmedBalance(r.data?.balanceCents ?? null);
            setStatus("confirmed");
            closeTimer.current = setTimeout(() => onOpenChange(false), 1600);
          });
        }
      }, 4000);
    },
    onError: (err) => {
      setStatus("error");
      toast.error(`Tip of ${fmt(amountCents)} failed`, {
        description: err instanceof Error ? err.message : "Please try again.",
        action: {
          label: "View history",
          onClick: () =>
            router.navigate({
              to: "/wallet",
              search: { tab: "tips", tipDir: "sent", tipPage: 1 },
            }),
        },
      });
    },
  });

  function pickPreset(cents: number) {
    setAmountCents(cents);
    setCustomDollars("");
  }

  function onCustomChange(v: string) {
    setCustomDollars(v);
    const n = Number.parseFloat(v);
    if (Number.isFinite(n) && n > 0) setAmountCents(Math.round(n * 100));
  }

  const STEP_CENTS = 100; // $1 increments
  function stepBy(deltaCents: number) {
    const next = Math.min(
      TIP_MAX_CENTS,
      Math.max(TIP_MIN_CENTS, amountCents + deltaCents),
    );
    setAmountCents(next);
    setCustomDollars((next / 100).toFixed(2));
  }
  const canDecrement = amountCents > TIP_MIN_CENTS;
  const canIncrement = amountCents < TIP_MAX_CENTS;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Coins className="h-4 w-4 text-amber-400" /> Send tip
          </DialogTitle>
          <DialogDescription>
            Tipping <span className="font-semibold text-foreground">{recipientName}</span>
            {matchId ? " for this match" : loungeId ? " in this lounge" : ""}.

          </DialogDescription>
          {recipientError && (
            <p
              id="tip-recipient-error"
              role="alert"
              className="mt-1 text-xs font-medium text-rose-400"
            >
              {recipientError}
            </p>
          )}
        </DialogHeader>

        {messagePreview && (
          <div className="rounded-md border border-arena-border bg-arena-panel-2/40 p-2.5 text-xs">
            <div className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
              <MessageSquareQuote className="h-3 w-3" /> Linked message
            </div>
            <p className="line-clamp-3 whitespace-pre-wrap text-white/90">{messagePreview}</p>
          </div>
        )}

        <div className="space-y-3">
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                Amount
              </label>
              <span className="text-[11px] text-muted-foreground">
                Balance: {balanceQ.isLoading ? "…" : fmt(balanceCents)}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS_CENTS.map((c) => {
                const active = amountCents === c && !customDollars;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => pickPreset(c)}
                    className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition ${
                      active
                        ? "border-arena-violet bg-arena-violet/15 text-white"
                        : "border-arena-border text-muted-foreground hover:text-white"
                    }`}
                  >
                    {fmt(c)}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label
              htmlFor="tip-custom"
              className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
            >
              Custom amount (USD)
            </label>
            <div className="flex items-stretch gap-1.5">
              <Button
                type="button"
                variant="arenaOutline"
                size="icon"
                onClick={() => stepBy(-STEP_CENTS)}
                disabled={!canDecrement}
                aria-label={`Decrease tip by ${fmt(STEP_CENTS)}`}
                title={`-${fmt(STEP_CENTS)}`}
              >
                <Minus className="h-4 w-4" />
              </Button>
              <Input
                id="tip-custom"
                type="number"
                step="0.01"
                min={(TIP_MIN_CENTS / 100).toFixed(2)}
                max={(TIP_MAX_CENTS / 100).toFixed(2)}
                inputMode="decimal"
                placeholder="e.g. 4.50"
                value={customDollars}
                onChange={(e) => onCustomChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    stepBy(STEP_CENTS);
                  } else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    stepBy(-STEP_CENTS);
                  }
                }}
                className={`flex-1 text-center tabular-nums ${
                  amountError ? "border-rose-500/60 focus-visible:ring-rose-500/40" : ""
                }`}
                aria-invalid={amountError ? true : undefined}
                aria-describedby={amountError ? "tip-amount-error" : "tip-amount-range"}
              />
              <Button
                type="button"
                variant="arenaOutline"
                size="icon"
                onClick={() => stepBy(STEP_CENTS)}
                disabled={!canIncrement}
                aria-label={`Increase tip by ${fmt(STEP_CENTS)}`}
                title={`+${fmt(STEP_CENTS)}`}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div
              id="tip-amount-range"
              className="mt-1 text-[10px] text-muted-foreground"
            >
              Allowed: {fmt(TIP_MIN_CENTS)} – {fmt(TIP_MAX_CENTS)} · Step {fmt(STEP_CENTS)}
            </div>
            {amountError && (
              <p
                id="tip-amount-error"
                role="alert"
                className="mt-1 text-xs font-medium text-rose-400"
              >
                {amountError}
              </p>
            )}
          </div>


          <div>
            <label
              htmlFor="tip-memo"
              className="mb-1 block text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
            >
              Memo (optional)
            </label>
            <Textarea
              id="tip-memo"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              maxLength={200}
              rows={2}
              placeholder="Say something nice…"
            />
          </div>


          {status !== "idle" && (
            <div
              role="status"
              aria-live="polite"
              className={`flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs ${
                status === "confirmed"
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                  : status === "error"
                    ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
                    : "border-arena-violet/40 bg-arena-violet/10 text-arena-violet"
              }`}
            >
              {status === "sending" && (
                <>
                  <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
                  <span>Submitting tip…</span>
                </>
              )}
              {status === "confirming" && (
                <>
                  <Radio className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-pulse" />
                  <span>Waiting for realtime balance confirmation…</span>
                </>
              )}
              {status === "confirmed" && (
                <>
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    Confirmed. New balance:{" "}
                    <span className="font-semibold">
                      {confirmedBalance != null ? fmt(confirmedBalance) : fmt(balanceCents)}
                    </span>
                    .
                  </span>
                </>
              )}
              {status === "error" && <span>Tip failed. Please try again.</span>}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <div className="text-xs text-muted-foreground">
            {status === "confirmed" ? "Sent" : "Sending"}{" "}
            <span className="font-semibold text-white">{fmt(amountCents)}</span>
          </div>
          <div className="flex gap-2">
            <Button
              variant="arenaOutline"
              onClick={() => onOpenChange(false)}
              disabled={status === "sending" || status === "confirming"}
            >
              {status === "confirmed" ? "Close" : "Cancel"}
            </Button>
            <Button
              onClick={() => {
                if (validationError) {
                  toast.error("Can't send tip", { description: validationError });
                  return;
                }
                setConfirmOpen(true);
              }}
              disabled={
                status === "sending" || status === "confirming" || status === "confirmed"
              }
              aria-disabled={Boolean(validationError)}
              title={validationError ?? undefined}
              className="gap-2"
            >
              {status === "sending" || status === "confirming" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : status === "confirmed" ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <Coins className="h-4 w-4" />
              )}
              {status === "confirmed" ? "Sent" : "Send tip"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Coins className="h-4 w-4 text-amber-400" /> Confirm tip
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p className="text-muted-foreground">
                  Review the details below. Tips cannot be reversed once sent.
                </p>
                <div className="rounded-md border border-arena-border bg-arena-panel-2/40 p-3 text-white">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                      Recipient
                    </span>
                    <span className="truncate font-semibold">{recipientName}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                      Amount
                    </span>
                    <span className="font-display text-xl font-extrabold tabular-nums text-amber-300">
                      {fmt(amountCents)}
                    </span>
                  </div>
                  {memo.trim() && (
                    <div className="mt-2 border-t border-arena-border/60 pt-2">
                      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                        Memo
                      </div>
                      <p className="mt-1 line-clamp-3 text-xs italic text-white/90">
                        “{memo.trim()}”
                      </p>
                    </div>
                  )}
                  <div className="mt-2 flex items-center justify-between gap-3 border-t border-arena-border/60 pt-2 text-[11px] text-muted-foreground">
                    <span>Balance after</span>
                    <span className="tabular-nums text-white/90">
                      {fmt(Math.max(0, balanceCents - amountCents))}
                    </span>
                  </div>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Back</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                mutation.mutate();
              }}
            >
              Send {fmt(amountCents)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
