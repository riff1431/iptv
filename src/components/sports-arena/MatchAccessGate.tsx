import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Wallet, Timer, Lock, Plus, LogIn } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  getMatchAccess,
  enterMatch,
  payMatchToStay,
  type MatchAccess,
} from "@/lib/match-access.functions";
import { creditOwnWallet } from "@/lib/lounge-access.functions";

function fmtDollars(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function useCountdown(expiresAt: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [expiresAt]);
  if (!expiresAt) return null;
  const remaining = Math.max(
    0,
    Math.floor((new Date(expiresAt).getTime() - now) / 1000),
  );
  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");
  return { seconds: remaining, label: `${mm}:${ss}` };
}

export type MatchAccessGateProps = {
  matchId: string;
  children: (access: MatchAccess) => React.ReactNode;
  /**
   * When true, automatically start the free preview on mount (for signed-in
   * users who haven't entered yet). Lets the 4 admin-configured tiles render
   * immediately instead of requiring a manual "Enter" click.
   */
  autoEnter?: boolean;
};

/**
 * Wallet-gated entry for a match room — same preview/pay flow as LoungeAccessGate:
 *   - Not entered → "Start free preview" (or free entry if fee=0)
 *   - Preview → renders children with a countdown pill; on expiry shows pay CTA
 *   - Paid → renders children with a paid countdown pill
 */
export function MatchAccessGate({ matchId, children, autoEnter = false }: MatchAccessGateProps) {

  const fetchAccess = useServerFn(getMatchAccess);
  const enter = useServerFn(enterMatch);
  const pay = useServerFn(payMatchToStay);
  const credit = useServerFn(creditOwnWallet);

  const [access, setAccess] = useState<MatchAccess | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"enter" | "pay" | "credit" | null>(null);
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setAuthed(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setAuthed(!!session);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const refresh = useCallback(async () => {
    if (!authed) return;
    try {
      setError(null);
      const a = await fetchAccess({ data: { matchId } });
      setAccess(a);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load access");
    }
  }, [fetchAccess, matchId, authed]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const countdown = useCountdown(access?.expiresAt ?? null);

  useEffect(() => {
    if (!countdown || countdown.seconds > 0) return;
    if (access?.status !== "preview") return;
    void refresh();
  }, [countdown, access?.status, refresh]);

  // Auto-enter free preview so the 4 admin-configured tiles render immediately
  // without requiring a manual "Enter" click. Only fires once per match, only
  // for signed-in users who don't already have a session.
  const autoEnterAttempted = useRef(false);
  useEffect(() => {
    if (!autoEnter || !authed || !access || autoEnterAttempted.current) return;
    if (access.sessionId) return; // already entered (preview or paid)
    autoEnterAttempted.current = true;
    (async () => {
      try {
        setBusy("enter");
        const a = await enter({ data: { matchId } });
        setAccess(a);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not enter");
      } finally {
        setBusy(null);
      }
    })();
  }, [autoEnter, authed, access, enter, matchId]);

  // Reset the auto-enter latch when the matchId changes so navigating to a
  // different match re-runs the auto-enter for that new match.
  useEffect(() => {
    autoEnterAttempted.current = false;
  }, [matchId]);



  if (authed === false) {
    return (
      <GatePanel>
        <div className="flex items-center justify-center gap-2 text-primary">
          <Lock className="h-5 w-5" />
          <h2 className="font-display text-lg font-bold uppercase tracking-wider">
            Sign in to watch
          </h2>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Create an account or sign in to start your free preview.
        </p>
        <Button asChild className="mt-4">
          <Link
            to="/auth"
            search={{
              redirect:
                typeof window !== "undefined"
                  ? window.location.pathname + window.location.search
                  : undefined,
            }}
          >
            <LogIn className="h-4 w-4" /> Sign in
          </Link>
        </Button>
      </GatePanel>
    );
  }

  if (error) {
    return (
      <GatePanel>
        <p className="text-sm text-live">{error}</p>
        <Button onClick={() => void refresh()} className="mt-3">
          Retry
        </Button>
      </GatePanel>
    );
  }

  if (!access) {
    return (
      <GatePanel>
        <p className="text-sm text-muted-foreground">Checking access…</p>
      </GatePanel>
    );
  }

  const feeLabel = fmtDollars(access.entryFeeCents);
  const balLabel = fmtDollars(access.walletBalanceCents);
  const canAfford = access.walletBalanceCents >= access.entryFeeCents;

  if (!access.sessionId) {
    return (
      <GatePanel>
        <div className="flex items-center justify-center gap-2 text-primary">
          <Lock className="h-5 w-5" />
          <h2 className="font-display text-lg font-bold uppercase tracking-wider">
            Join the match
          </h2>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {access.entryFeeCents === 0
            ? "This match is free. Step inside and grab a seat."
            : `Free ${Math.round(access.freePreviewSeconds / 60)}-minute preview, then ${feeLabel} from your PGX Wallet to keep watching.`}
        </p>
        <WalletChip balanceCents={access.walletBalanceCents} />
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button
            disabled={busy !== null}
            onClick={async () => {
              setBusy("enter");
              try {
                const a = await enter({ data: { matchId } });
                setAccess(a);
              } catch (e) {
                setError(e instanceof Error ? e.message : "Could not enter");
              } finally {
                setBusy(null);
              }
            }}
          >
            {access.entryFeeCents === 0
              ? "Enter free"
              : `Start ${Math.round(access.freePreviewSeconds / 60)}-min preview`}
          </Button>
          {access.entryFeeCents > 0 && (
            <DevCreditButton
              busy={busy === "credit"}
              onCredit={async () => {
                setBusy("credit");
                try {
                  await credit({ data: { amountCents: 2000 } });
                  await refresh();
                } finally {
                  setBusy(null);
                }
              }}
            />
          )}
        </div>
      </GatePanel>
    );
  }

  const previewExpired =
    access.status === "preview" && (countdown?.seconds ?? 0) <= 0;

  return (
    <div className="space-y-4">
      {access.status === "preview" && !previewExpired && countdown && (
        <StatusStrip tone="preview">
          <Timer className="h-4 w-4" />
          <span>Free preview</span>
          <span className="font-mono text-sm">{countdown.label}</span>
          <span className="ml-auto flex items-center gap-2">
            <span className="text-muted-foreground">Balance: {balLabel}</span>
            <Button
              size="sm"
              disabled={busy !== null || !canAfford}
              onClick={async () => {
                setBusy("pay");
                try {
                  const a = await pay({ data: { matchId } });
                  setAccess(a);
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Payment failed");
                } finally {
                  setBusy(null);
                }
              }}
            >
              {canAfford ? `Pay ${feeLabel} to stay` : "Add funds"}
            </Button>
          </span>
        </StatusStrip>
      )}

      {access.status === "paid" && countdown && (
        <StatusStrip tone="paid">
          <Wallet className="h-4 w-4" />
          <span>Paid seat</span>
          <span className="font-mono text-sm">{countdown.label} remaining</span>
          <span className="ml-auto text-muted-foreground">Balance: {balLabel}</span>
        </StatusStrip>
      )}

      {previewExpired ? (
        <GatePanel>
          <div className="flex items-center justify-center gap-2 text-primary">
            <Lock className="h-5 w-5" />
            <h2 className="font-display text-lg font-bold uppercase tracking-wider">
              Preview ended
            </h2>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Pay {feeLabel} from your PGX Wallet to keep watching.
          </p>
          <WalletChip balanceCents={access.walletBalanceCents} />
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button
              disabled={busy !== null || !canAfford}
              onClick={async () => {
                setBusy("pay");
                try {
                  const a = await pay({ data: { matchId } });
                  setAccess(a);
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Payment failed");
                } finally {
                  setBusy(null);
                }
              }}
            >
              Pay {feeLabel}
            </Button>
            {!canAfford && (
              <DevCreditButton
                busy={busy === "credit"}
                onCredit={async () => {
                  setBusy("credit");
                  try {
                    await credit({ data: { amountCents: 2000 } });
                    await refresh();
                  } finally {
                    setBusy(null);
                  }
                }}
              />
            )}
          </div>
        </GatePanel>
      ) : (
        children(access)
      )}
    </div>
  );
}

function GatePanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="tv-frame mx-auto max-w-lg rounded-xl p-8 text-center">
      {children}
    </div>
  );
}

function StatusStrip({
  tone,
  children,
}: {
  tone: "preview" | "paid";
  children: React.ReactNode;
}) {
  const cls =
    tone === "preview"
      ? "border-primary/40 bg-primary/10 text-primary"
      : "border-emerald-500/40 bg-emerald-500/10 text-emerald-400";
  return (
    <div
      className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-2.5 text-xs font-semibold uppercase tracking-wider ${cls}`}
    >
      {children}
    </div>
  );
}

function WalletChip({ balanceCents }: { balanceCents: number }) {
  return (
    <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-border bg-surface-elevated px-3 py-1 text-xs">
      <Wallet className="h-3.5 w-3.5" />
      <span className="text-muted-foreground">PGX Wallet:</span>
      <span className="font-semibold">{fmtDollars(balanceCents)}</span>
    </div>
  );
}

function DevCreditButton({
  busy,
  onCredit,
}: {
  busy: boolean;
  onCredit: () => void | Promise<void>;
}) {
  return (
    <Button variant="outline" disabled={busy} onClick={() => void onCredit()}>
      <Plus className="h-4 w-4" /> +$20 test credit
    </Button>
  );
}
