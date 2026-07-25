import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Banknote,
  Loader2,
  Landmark,
  Mail,
  Wallet as WalletIcon,
  Clock,
  Check,
  XCircle,
  BadgeCheck,
  Ban,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThumbHeader } from "@/components/ThumbFallback";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createWithdrawal,
  cancelWithdrawal,
  listOwnWithdrawals,
  WITHDRAWAL_MIN_CENTS,
  WITHDRAWAL_MAX_CENTS,
  type WithdrawalMethod,
  type WithdrawalRequest,
  type WithdrawalStatus,
} from "@/lib/withdrawals.functions";

function fmt(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

const METHOD_META: Record<
  WithdrawalMethod,
  { label: string; icon: React.ComponentType<{ className?: string }>; placeholder: string; hint: string }
> = {
  paypal: {
    label: "PayPal",
    icon: Mail,
    placeholder: "you@example.com",
    hint: "The email registered with your PayPal account.",
  },
  bank_transfer: {
    label: "Bank transfer",
    icon: Landmark,
    placeholder: "Account holder, account #, routing/IBAN, bank name",
    hint: "Include holder name, account number, and routing/IBAN.",
  },
  crypto: {
    label: "Crypto (USDC)",
    icon: Banknote,
    placeholder: "0x… wallet address",
    hint: "USDC on Ethereum or Polygon. Double-check the address.",
  },
};

const STATUS_META: Record<
  WithdrawalStatus,
  { label: string; tone: string; icon: React.ComponentType<{ className?: string }> }
> = {
  pending: { label: "Pending review", tone: "bg-amber-500/15 text-amber-300 border-amber-500/30", icon: Clock },
  approved: { label: "Approved", tone: "bg-sky-500/15 text-sky-300 border-sky-500/30", icon: BadgeCheck },
  paid: { label: "Paid", tone: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", icon: Check },
  rejected: { label: "Rejected", tone: "bg-rose-500/15 text-rose-300 border-rose-500/30", icon: XCircle },
  cancelled: { label: "Cancelled", tone: "bg-muted text-muted-foreground border-arena-border", icon: Ban },
};

export function WithdrawSection({
  availableCents,
  balanceLoading,
}: {
  availableCents: number;
  balanceLoading: boolean;
}) {
  const qc = useQueryClient();
  const listFn = useServerFn(listOwnWithdrawals);
  const createFn = useServerFn(createWithdrawal);
  const cancelFn = useServerFn(cancelWithdrawal);

  const listQuery = useQuery({
    queryKey: ["wallet", "withdrawals"],
    queryFn: () => listFn(),
    staleTime: 5_000,
  });

  const pendingReserved = useMemo(
    () =>
      (listQuery.data ?? [])
        .filter((r) => r.status === "pending" || r.status === "approved")
        .reduce((s, r) => s + r.amount_cents, 0),
    [listQuery.data],
  );
  const available = Math.max(0, availableCents - pendingReserved);

  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("25.00");
  const [method, setMethod] = useState<WithdrawalMethod>("paypal");
  const [destination, setDestination] = useState("");
  const [note, setNote] = useState("");

  const createMutation = useMutation({
    mutationFn: async () => {
      const dollars = Number.parseFloat(amount);
      if (!Number.isFinite(dollars) || dollars <= 0) throw new Error("Enter a valid amount");
      const cents = Math.round(dollars * 100);
      if (cents < WITHDRAWAL_MIN_CENTS)
        throw new Error(`Minimum withdrawal is ${fmt(WITHDRAWAL_MIN_CENTS)}`);
      if (cents > WITHDRAWAL_MAX_CENTS)
        throw new Error(`Maximum withdrawal is ${fmt(WITHDRAWAL_MAX_CENTS)}`);
      if (cents > available)
        throw new Error(`You only have ${fmt(available)} available to withdraw`);
      if (!destination.trim()) throw new Error("Destination is required");
      return createFn({
        data: {
          amountCents: cents,
          method,
          destination: destination.trim(),
          userNote: note.trim() || undefined,
        },
      });
    },
    onSuccess: () => {
      toast.success("Withdrawal request submitted", {
        description: "You'll get an update once a reviewer processes it.",
      });
      setOpen(false);
      setDestination("");
      setNote("");
      void qc.invalidateQueries({ queryKey: ["wallet"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Withdrawal failed"),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Withdrawal cancelled");
      void qc.invalidateQueries({ queryKey: ["wallet", "withdrawals"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not cancel"),
  });

  const MethodIcon = METHOD_META[method].icon;
  const dollars = Number.parseFloat(amount);
  const centsPreview = Number.isFinite(dollars) ? Math.round(dollars * 100) : 0;
  const overLimit = centsPreview > available;

  return (
    <section className="arena-card space-y-4 rounded-xl p-4 sm:p-5">
      <ThumbHeader icon={Banknote} label="Withdraw" />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Withdraw funds
          </div>
          <p className="text-xs text-muted-foreground">
            Request a payout to PayPal, bank, or crypto. Reviewed within 1–3 business days.
          </p>
          <div className="mt-1 text-xs">
            <span className="text-muted-foreground">Available to withdraw: </span>
            <span className="font-display font-bold tabular-nums text-white">
              {balanceLoading ? "…" : fmt(available)}
            </span>
            {pendingReserved > 0 && (
              <span className="ml-2 text-muted-foreground">
                ({fmt(pendingReserved)} reserved by pending requests)
              </span>
            )}
          </div>
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button
              className="gap-2"
              disabled={balanceLoading || available < WITHDRAWAL_MIN_CENTS}
            >
              <WalletIcon className="h-4 w-4" /> Request withdrawal
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Request a withdrawal</DialogTitle>
              <DialogDescription>
                Minimum {fmt(WITHDRAWAL_MIN_CENTS)}, maximum {fmt(WITHDRAWAL_MAX_CENTS)} per request.
                Funds are reserved until the request is processed or cancelled.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="wd-amount">Amount (USD)</Label>
                <Input
                  id="wd-amount"
                  type="number"
                  step="0.01"
                  min={(WITHDRAWAL_MIN_CENTS / 100).toString()}
                  max={(WITHDRAWAL_MAX_CENTS / 100).toString()}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
                <div className="flex items-center justify-between text-[11px]">
                  <span className={overLimit ? "text-rose-400" : "text-muted-foreground"}>
                    {overLimit
                      ? `Exceeds available (${fmt(available)})`
                      : `Available: ${fmt(available)}`}
                  </span>
                  <div className="flex gap-1">
                    {[25, 50, 100].map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setAmount(v.toFixed(2))}
                        className="rounded border border-arena-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground hover:text-white"
                      >
                        ${v}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setAmount((available / 100).toFixed(2))}
                      className="rounded border border-arena-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground hover:text-white"
                      disabled={available <= 0}
                    >
                      Max
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="wd-method">Method</Label>
                <Select value={method} onValueChange={(v) => setMethod(v as WithdrawalMethod)}>
                  <SelectTrigger id="wd-method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(METHOD_META) as WithdrawalMethod[]).map((k) => {
                      const M = METHOD_META[k];
                      return (
                        <SelectItem key={k} value={k}>
                          <span className="flex items-center gap-2">
                            <M.icon className="h-3.5 w-3.5" /> {M.label}
                          </span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="wd-dest" className="flex items-center gap-1.5">
                  <MethodIcon className="h-3.5 w-3.5" /> Destination
                </Label>
                {method === "bank_transfer" ? (
                  <Textarea
                    id="wd-dest"
                    rows={3}
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                    placeholder={METHOD_META[method].placeholder}
                    maxLength={500}
                  />
                ) : (
                  <Input
                    id="wd-dest"
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                    placeholder={METHOD_META[method].placeholder}
                    maxLength={500}
                  />
                )}
                <p className="text-[11px] text-muted-foreground">{METHOD_META[method].hint}</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="wd-note">Note (optional)</Label>
                <Textarea
                  id="wd-note"
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Anything the reviewer should know"
                  maxLength={500}
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="arenaOutline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending || overLimit || centsPreview < WITHDRAWAL_MIN_CENTS}
                className="gap-2"
              >
                {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Submit request
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-2">
        <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          Recent requests
        </div>
        {listQuery.isLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading requests…
          </div>
        ) : (listQuery.data ?? []).length === 0 ? (
          <div className="rounded-md border border-dashed border-arena-border px-3 py-4 text-center text-xs text-muted-foreground">
            No withdrawal requests yet.
          </div>
        ) : (
          <ul className="divide-y divide-arena-border/60 rounded-md border border-arena-border">
            {listQuery.data!.map((r) => (
              <WithdrawalRow
                key={r.id}
                r={r}
                onCancel={() => cancelMutation.mutate(r.id)}
                cancelling={cancelMutation.isPending && cancelMutation.variables === r.id}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function WithdrawalRow({
  r,
  onCancel,
  cancelling,
}: {
  r: WithdrawalRequest;
  onCancel: () => void;
  cancelling: boolean;
}) {
  const status = STATUS_META[r.status];
  const StatusIcon = status.icon;
  const method = METHOD_META[r.method];
  const MethodIcon = method.icon;
  const created = new Date(r.created_at);
  const processed = r.processed_at ? new Date(r.processed_at) : null;

  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-display text-base font-bold tabular-nums text-white">
            {fmt(r.amount_cents)}
          </span>
          <Badge variant="outline" className={`gap-1 border ${status.tone}`}>
            <StatusIcon className="h-3 w-3" /> {status.label}
          </Badge>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <MethodIcon className="h-3 w-3" /> {method.label}
          </span>
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground" title={r.destination}>
          {r.destination}
        </div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          Requested {created.toLocaleString()}
          {processed && ` · Processed ${processed.toLocaleString()}`}
        </div>
        {r.admin_note && (
          <div className="mt-1 rounded border border-arena-border/60 bg-arena-surface/40 px-2 py-1 text-[11px] text-muted-foreground">
            <span className="font-semibold text-white">Reviewer note:</span> {r.admin_note}
          </div>
        )}
      </div>
      {r.status === "pending" && (
        <Button
          variant="arenaOutline"
          size="sm"
          onClick={onCancel}
          disabled={cancelling}
          className="gap-1"
        >
          {cancelling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
          Cancel
        </Button>
      )}
    </li>
  );
}
