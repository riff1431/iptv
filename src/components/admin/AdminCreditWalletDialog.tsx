import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, CircleDollarSign } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { adminCreditUserWallet } from "@/lib/admin-users.functions";

interface AdminCreditWalletDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  userLabel: string;
}

const PRESETS = [5, 10, 25, 50, 100] as const;
const MIN_DOLLARS = 1;
const MAX_DOLLARS = 10_000;
const MEMO_MAX = 200;

export function AdminCreditWalletDialog({
  open,
  onOpenChange,
  userId,
  userLabel,
}: AdminCreditWalletDialogProps) {
  const [amount, setAmount] = useState<string>("10.00");
  const [memo, setMemo] = useState<string>("");
  const qc = useQueryClient();
  const creditFn = useServerFn(adminCreditUserWallet);

  const parsedDollars = Number.parseFloat(amount);
  const amountCents = Number.isFinite(parsedDollars) ? Math.round(parsedDollars * 100) : NaN;
  const amountError = useMemo(() => {
    if (!Number.isFinite(parsedDollars)) return "Enter a valid amount.";
    if (amountCents < MIN_DOLLARS * 100) return `Minimum credit is $${MIN_DOLLARS.toFixed(2)}.`;
    if (amountCents > MAX_DOLLARS * 100)
      return `Maximum credit is $${MAX_DOLLARS.toLocaleString()}.`;
    return null;
  }, [parsedDollars, amountCents]);
  const memoError = memo.length > MEMO_MAX ? `Note must be ${MEMO_MAX} characters or fewer.` : null;

  const mutation = useMutation({
    mutationFn: () =>
      creditFn({
        data: {
          userId,
          amountCents,
          memo: memo.trim() ? memo.trim() : undefined,
        },
      }),
    onSuccess: (result) => {
      const dollars = (result.amountCents / 100).toFixed(2);
      const balance = (result.newBalanceCents / 100).toFixed(2);
      toast.success(`Credited $${dollars} to ${userLabel}`, {
        description: `New balance: $${balance}`,
      });
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
      qc.invalidateQueries({ queryKey: ["wallet"] });
      setMemo("");
      setAmount("10.00");
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Failed to credit wallet");
    },
  });

  const disabled = mutation.isPending || amountError !== null || memoError !== null;

  return (
    <Dialog open={open} onOpenChange={(v) => (!mutation.isPending ? onOpenChange(v) : undefined)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CircleDollarSign className="h-5 w-5 text-primary" />
            Credit wallet
          </DialogTitle>
          <DialogDescription>
            Add funds to <span className="font-medium text-foreground">{userLabel}</span>'s wallet.
            This creates a credit transaction and notifies the user.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="admin-credit-amount">Amount (USD)</Label>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <Button
                  key={p}
                  type="button"
                  size="sm"
                  variant={parsedDollars === p ? "default" : "outline"}
                  onClick={() => setAmount(p.toFixed(2))}
                >
                  +${p}
                </Button>
              ))}
            </div>
            <Input
              id="admin-credit-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-invalid={amountError ? true : undefined}
              aria-describedby={amountError ? "admin-credit-amount-error" : undefined}
              className={amountError ? "border-destructive" : undefined}
            />
            {amountError ? (
              <p
                id="admin-credit-amount-error"
                role="alert"
                className="text-xs text-destructive"
              >
                {amountError}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Min ${MIN_DOLLARS.toFixed(2)} · Max ${MAX_DOLLARS.toLocaleString()} per credit.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="admin-credit-memo">Note (optional)</Label>
            <Textarea
              id="admin-credit-memo"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="Reason for the credit (visible to the user)"
              maxLength={MEMO_MAX + 20}
              rows={3}
              aria-invalid={memoError ? true : undefined}
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{memoError ?? "Shown in the user's wallet history and notification."}</span>
              <span>
                {memo.length}/{MEMO_MAX}
              </span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={disabled}>
            {mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Credit wallet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
