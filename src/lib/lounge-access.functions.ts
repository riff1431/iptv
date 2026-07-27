import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

/**
 * Snapshot of a user's ability to watch a given lounge:
 * - current wallet balance (cents)
 * - lounge entry fee & free-preview window
 * - active session (preview or paid) with its expiry, if any
 */
export interface LoungeAccess {
  loungeId: string;
  entryFeeCents: number;
  freePreviewSeconds: number;
  walletBalanceCents: number;
  sessionId: string | null;
  status: "preview" | "paid" | "expired" | "none";
  expiresAt: string | null;
  paidAt: string | null;
}

type Supa = SupabaseClient<Database>;

const loungeIdInput = z.object({ loungeId: z.string().uuid() });

async function loadAccess(supabase: Supa, userId: string, loungeId: string): Promise<LoungeAccess> {
  const [lounge, session, balance] = await Promise.all([
    supabase
      .from("lounges")
      .select("id, entry_fee_cents, free_preview_seconds")
      .eq("id", loungeId)
      .maybeSingle(),
    supabase
      .from("lounge_sessions")
      .select("id, status, expires_at, paid_at")
      .eq("lounge_id", loungeId)
      .eq("user_id", userId)
      .order("entered_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.rpc("wallet_balance_cents", { _user_id: userId }),
  ]);

  if (lounge.error || !lounge.data) throw new Error("Lounge not found");

  const now = Date.now();
  const s = session.data;
  const active = !!s && new Date(s.expires_at).getTime() > now && s.status !== "expired";

  return {
    loungeId,
    entryFeeCents: lounge.data.entry_fee_cents,
    freePreviewSeconds: lounge.data.free_preview_seconds,
    walletBalanceCents: (balance.data as number | null) ?? 0,
    sessionId: active ? s!.id : null,
    status: active ? (s!.status as "preview" | "paid") : "none",
    expiresAt: active ? s!.expires_at : null,
    paidAt: active ? s!.paid_at : null,
  };
}

/** Current access snapshot for the signed-in user. */
export const getLoungeAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => loungeIdInput.parse(d))
  .handler(async ({ data, context }) =>
    loadAccess(context.supabase as unknown as Supa, context.userId, data.loungeId),
  );

/**
 * Start a preview session (or return the still-active one).
 * Free lounges (entry_fee_cents = 0) get a paid-status session with a long
 * expiry so users are never nagged.
 */
export const enterLounge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => loungeIdInput.parse(d))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as unknown as Supa;
    const existing = await loadAccess(supabase, context.userId, data.loungeId);
    if (existing.sessionId) return existing;

    const isFree = existing.entryFeeCents === 0;
    const previewSecs = existing.freePreviewSeconds || 120;
    const expiresAt = new Date(
      Date.now() + (isFree ? 60 * 60 * 4 : previewSecs) * 1000,
    ).toISOString();

    const { error } = await supabase.from("lounge_sessions").insert({
      user_id: context.userId,
      lounge_id: data.loungeId,
      status: isFree ? "paid" : "preview",
      expires_at: expiresAt,
      paid_at: isFree ? new Date().toISOString() : null,
      amount_cents: 0,
    });
    if (error) throw new Error(error.message);

    return loadAccess(supabase, context.userId, data.loungeId);
  });

/**
 * Debit the wallet by the lounge fee and flip the current session to paid
 * (extends expiry by 1 hour). Fails cleanly on insufficient funds.
 */
export const payToStay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => loungeIdInput.parse(d))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as unknown as Supa;
    const access = await loadAccess(supabase, context.userId, data.loungeId);
    if (!access.sessionId) throw new Error("No active session — enter the lounge first");
    if (access.status === "paid") return access;
    if (access.walletBalanceCents < access.entryFeeCents) {
      throw new Error(
        `Insufficient wallet balance. Need $${(access.entryFeeCents / 100).toFixed(
          2,
        )}, have $${(access.walletBalanceCents / 100).toFixed(2)}.`,
      );
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const debit = await supabaseAdmin.from("wallet_transactions").insert({
      user_id: context.userId,
      type: "debit_lounge_entry",
      amount_cents: access.entryFeeCents,
      lounge_session_id: access.sessionId,
      memo: `Lounge entry ${access.loungeId}`,
    });
    if (debit.error) throw new Error(debit.error.message);

    const newExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const update = await supabaseAdmin
      .from("lounge_sessions")
      .update({
        status: "paid",
        expires_at: newExpiry,
        paid_at: new Date().toISOString(),
        amount_cents: access.entryFeeCents,
      })
      .eq("id", access.sessionId);
    if (update.error) throw new Error(update.error.message);

    return loadAccess(supabase, context.userId, data.loungeId);
  });

/** Dev helper: credit the signed-in user's wallet with test funds. */
export const creditOwnWallet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ amountCents: z.number().int().positive().max(50000) }).parse(d))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as unknown as Supa;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("wallet_transactions").insert({
      user_id: context.userId,
      type: "credit",
      amount_cents: data.amountCents,
      memo: "Self-credit (dev)",
    });
    if (error) throw new Error(error.message);
    const { data: bal } = await supabase.rpc("wallet_balance_cents", {
      _user_id: context.userId,
    });
    return { balanceCents: (bal as number | null) ?? 0 };
  });
