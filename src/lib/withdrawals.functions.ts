import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

export type WithdrawalStatus = Database["public"]["Enums"]["withdrawal_status"];
export type WithdrawalMethod = Database["public"]["Enums"]["withdrawal_method"];

export interface WithdrawalRequest {
  id: string;
  amount_cents: number;
  method: WithdrawalMethod;
  destination: string;
  user_note: string | null;
  status: WithdrawalStatus;
  admin_note: string | null;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
}

export const WITHDRAWAL_MIN_CENTS = 500; // $5.00
export const WITHDRAWAL_MAX_CENTS = 100_000; // $1,000.00

const createInput = z.object({
  amountCents: z
    .number()
    .int()
    .min(WITHDRAWAL_MIN_CENTS, `Minimum withdrawal is $${(WITHDRAWAL_MIN_CENTS / 100).toFixed(2)}`)
    .max(WITHDRAWAL_MAX_CENTS, `Maximum withdrawal is $${(WITHDRAWAL_MAX_CENTS / 100).toFixed(2)}`),
  method: z.enum(["paypal", "bank_transfer", "crypto"]),
  destination: z.string().trim().min(3).max(500),
  userNote: z.string().trim().max(500).optional(),
});

const SELECT_COLS =
  "id, amount_cents, method, destination, user_note, status, admin_note, processed_at, created_at, updated_at";

export const listOwnWithdrawals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WithdrawalRequest[]> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("withdrawal_requests")
      .select(SELECT_COLS)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(25);
    if (error) throw new Error(error.message);
    return (data ?? []) as WithdrawalRequest[];
  });

export const createWithdrawal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => createInput.parse(d))
  .handler(async ({ data, context }): Promise<WithdrawalRequest> => {
    const { supabase, userId } = context;

    // Method-specific destination format checks
    if (data.method === "paypal") {
      const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.destination);
      if (!ok) throw new Error("PayPal destination must be a valid email address");
    } else if (data.method === "crypto") {
      if (data.destination.length < 20) throw new Error("Enter a valid crypto wallet address");
    } else if (data.method === "bank_transfer") {
      if (data.destination.length < 10)
        throw new Error("Include bank account details (account, routing, name)");
    }

    // Balance check: available = balance - sum(pending withdrawals)
    const [balanceRes, pendingRes] = await Promise.all([
      supabase.rpc("wallet_balance_cents", { _user_id: userId }),
      supabase
        .from("withdrawal_requests")
        .select("amount_cents")
        .eq("user_id", userId)
        .in("status", ["pending", "approved"]),
    ]);
    if (pendingRes.error) throw new Error(pendingRes.error.message);

    const balance = (balanceRes.data as number | null) ?? 0;
    const pendingSum = (pendingRes.data ?? []).reduce((s, r) => s + r.amount_cents, 0);
    const available = balance - pendingSum;
    if (data.amountCents > available) {
      throw new Error(
        `Insufficient available balance. You have $${(available / 100).toFixed(2)} available (pending requests reserved).`,
      );
    }

    // Only one pending request at a time
    const pendingCount = (pendingRes.data ?? []).filter((r) => true).length;
    if (pendingCount >= 3) {
      throw new Error("You already have 3 unresolved withdrawal requests. Please wait for review.");
    }

    const { data: inserted, error } = await supabase
      .from("withdrawal_requests")
      .insert({
        user_id: userId,
        amount_cents: data.amountCents,
        method: data.method,
        destination: data.destination,
        user_note: data.userNote ?? null,
      })
      .select(SELECT_COLS)
      .single();
    if (error) throw new Error(error.message);
    return inserted as WithdrawalRequest;
  });

export const cancelWithdrawal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<WithdrawalRequest> => {
    const { supabase, userId } = context;
    const { data: updated, error } = await supabase
      .from("withdrawal_requests")
      .update({ status: "cancelled" })
      .eq("id", data.id)
      .eq("user_id", userId)
      .eq("status", "pending")
      .select(SELECT_COLS)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!updated) throw new Error("Request can no longer be cancelled");
    return updated as WithdrawalRequest;
  });
