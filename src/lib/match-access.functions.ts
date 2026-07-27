import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

/**
 * Match-room access snapshot — parallel to LoungeAccess. Users must clear
 * this gate (preview or paid) before they can watch the match room.
 */
export interface MatchAccess {
  matchId: string;
  entryFeeCents: number;
  freePreviewSeconds: number;
  walletBalanceCents: number;
  sessionId: string | null;
  status: "preview" | "paid" | "expired" | "none";
  expiresAt: string | null;
  paidAt: string | null;
}

type Supa = SupabaseClient<Database>;

const matchIdInput = z.object({ matchId: z.string().uuid() });

// Row types are loose because the DB types are regenerated separately from
// this migration; casting keeps the code compiling until types.ts is refreshed.
type LooseMatch = { entry_fee_cents: number; free_preview_seconds: number };
type LooseSession = {
  id: string;
  status: "preview" | "paid" | "expired";
  expires_at: string;
  paid_at: string | null;
};

async function loadAccess(supabase: Supa, userId: string, matchId: string): Promise<MatchAccess> {
  const [match, session, balance] = await Promise.all([
    supabase
      .from("matches")
      .select("id, entry_fee_cents, free_preview_seconds")
      .eq("id", matchId)
      .maybeSingle(),
    (supabase as unknown as SupabaseClient)
      .from("match_sessions")
      .select("id, status, expires_at, paid_at")
      .eq("match_id", matchId)
      .eq("user_id", userId)
      .order("entered_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.rpc("wallet_balance_cents", { _user_id: userId }),
  ]);

  if (match.error || !match.data) throw new Error("Match not found");

  const m = match.data as unknown as LooseMatch;
  const now = Date.now();
  const s = session.data as unknown as LooseSession | null;
  const active = !!s && new Date(s.expires_at).getTime() > now && s.status !== "expired";

  return {
    matchId,
    entryFeeCents: m.entry_fee_cents,
    freePreviewSeconds: m.free_preview_seconds,
    walletBalanceCents: (balance.data as number | null) ?? 0,
    sessionId: active ? s!.id : null,
    status: active ? (s!.status as "preview" | "paid") : "none",
    expiresAt: active ? s!.expires_at : null,
    paidAt: active ? s!.paid_at : null,
  };
}

/** Current access snapshot for the signed-in user. */
export const getMatchAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => matchIdInput.parse(d))
  .handler(async ({ data, context }) =>
    loadAccess(context.supabase as unknown as Supa, context.userId, data.matchId),
  );

/**
 * Start a preview session (or return the still-active one). Free matches
 * (entry_fee_cents = 0) get a long-lived paid session so users are never nagged.
 */
export const enterMatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => matchIdInput.parse(d))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as unknown as Supa;
    const existing = await loadAccess(supabase, context.userId, data.matchId);
    if (existing.sessionId) return existing;

    const isFree = existing.entryFeeCents === 0;
    const previewSecs = existing.freePreviewSeconds || 120;
    const expiresAt = new Date(
      Date.now() + (isFree ? 60 * 60 * 4 : previewSecs) * 1000,
    ).toISOString();

    const { error } = await (supabase as unknown as SupabaseClient).from("match_sessions").insert({
      user_id: context.userId,
      match_id: data.matchId,
      status: isFree ? "paid" : "preview",
      expires_at: expiresAt,
      paid_at: isFree ? new Date().toISOString() : null,
      amount_cents: 0,
    });
    if (error) throw new Error(error.message);

    return loadAccess(supabase, context.userId, data.matchId);
  });

/**
 * Debit the wallet by the match fee and flip the current session to paid
 * (extends expiry by 1 hour). Fails cleanly on insufficient funds.
 */
export const payMatchToStay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => matchIdInput.parse(d))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as unknown as Supa;
    const access = await loadAccess(supabase, context.userId, data.matchId);
    if (!access.sessionId) throw new Error("No active session — enter the match first");
    if (access.status === "paid") return access;
    if (access.walletBalanceCents < access.entryFeeCents) {
      throw new Error(
        `Insufficient wallet balance. Need $${(access.entryFeeCents / 100).toFixed(
          2,
        )}, have $${(access.walletBalanceCents / 100).toFixed(2)}.`,
      );
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const debit = await (supabaseAdmin as unknown as SupabaseClient)
      .from("wallet_transactions")
      .insert({
        user_id: context.userId,
        type: "debit_match_entry",
        amount_cents: access.entryFeeCents,
        match_session_id: access.sessionId,
        memo: `Match entry ${access.matchId}`,
      });
    if (debit.error) throw new Error(debit.error.message);

    const newExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const update = await (supabaseAdmin as unknown as SupabaseClient)
      .from("match_sessions")
      .update({
        status: "paid",
        expires_at: newExpiry,
        paid_at: new Date().toISOString(),
        amount_cents: access.entryFeeCents,
      })
      .eq("id", access.sessionId);
    if (update.error) throw new Error(update.error.message);

    return loadAccess(supabase, context.userId, data.matchId);
  });
