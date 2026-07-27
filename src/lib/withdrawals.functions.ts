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

    // Atomic balance-reservation + insert (per-user advisory lock inside the RPC).
    const { data: newId, error: rpcError } = await supabase.rpc("create_withdrawal_request", {
      _amount_cents: data.amountCents,
      _method: data.method,
      _destination: data.destination,
      _user_note: data.userNote ?? undefined,
    });
    if (rpcError) throw new Error(rpcError.message);

    const { data: inserted, error } = await supabase
      .from("withdrawal_requests")
      .select(SELECT_COLS)
      .eq("id", newId as string)
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
