import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

export type TopupStatus = Database["public"]["Enums"]["topup_status"];
export type TopupMethod = Database["public"]["Enums"]["topup_method"];

export interface TopupRequest {
  id: string;
  amount_cents: number;
  method: TopupMethod;
  payment_method_id: string | null;
  reference: string | null;
  user_note: string | null;
  proof_path: string | null;
  status: TopupStatus;
  admin_note: string | null;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
}

export const TOPUP_MIN_CENTS = 100; // $1.00
export const TOPUP_MAX_CENTS = 1_000_000; // $10,000.00
export const TOPUP_MAX_PENDING = 3;
export const TOPUP_PROOF_BUCKET = "topup-proofs";
export const TOPUP_PROOF_MAX_BYTES = 8 * 1024 * 1024; // 8 MB

const SELECT_COLS =
  "id, amount_cents, method, payment_method_id, reference, user_note, proof_path, status, admin_note, processed_at, created_at, updated_at";

const createInput = z.object({
  amountCents: z
    .number()
    .int()
    .min(TOPUP_MIN_CENTS, `Minimum top-up is $${(TOPUP_MIN_CENTS / 100).toFixed(2)}`)
    .max(TOPUP_MAX_CENTS, `Maximum top-up is $${(TOPUP_MAX_CENTS / 100).toFixed(2)}`),
  paymentMethodId: z.string().uuid(),
  reference: z.string().trim().max(200).optional(),
  userNote: z.string().trim().max(500).optional(),
  proofPath: z.string().trim().max(500).optional(),
});

export const listOwnTopups = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TopupRequest[]> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("topup_requests")
      .select(SELECT_COLS)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(25);
    if (error) throw new Error(error.message);
    return (data ?? []) as TopupRequest[];
  });

export const createTopup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => createInput.parse(d))
  .handler(async ({ data, context }): Promise<TopupRequest> => {
    const { supabase, userId } = context;

    // Look up the selected payment method — must exist and be enabled.
    const { data: pm, error: pmErr } = await supabase
      .from("payment_methods")
      .select("id, kind, enabled")
      .eq("id", data.paymentMethodId)
      .maybeSingle();
    if (pmErr) throw new Error(pmErr.message);
    if (!pm || !pm.enabled) throw new Error("Selected payment method is not available");

    const { data: pending, error: pErr } = await supabase
      .from("topup_requests")
      .select("id")
      .eq("user_id", userId)
      .eq("status", "pending");
    if (pErr) throw new Error(pErr.message);
    if ((pending ?? []).length >= TOPUP_MAX_PENDING) {
      throw new Error(
        `You already have ${TOPUP_MAX_PENDING} pending top-up requests. Please wait for review.`,
      );
    }

    // Validate proof_path if provided: must live under this user's folder in the bucket.
    let proofPath: string | null = null;
    if (data.proofPath) {
      const p = data.proofPath.replace(/^\/+/, "");
      if (!p.startsWith(`${userId}/`)) {
        throw new Error("Invalid proof file path");
      }
      proofPath = p;
    }

    const { data: inserted, error } = await (supabase.from("topup_requests") as any)
      .insert({
        user_id: userId,
        amount_cents: data.amountCents,
        method: pm.kind,
        payment_method_id: pm.id,
        reference: data.reference ?? null,
        user_note: data.userNote ?? null,
        proof_path: proofPath,
      })
      .select(SELECT_COLS)
      .single();
    if (error) throw new Error(error.message);
    return inserted as TopupRequest;
  });

export const getTopupProofUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ url: string | null }> => {
    const { supabase, userId } = context;
    // RLS on topup_requests already scopes to owner or admin.
    const { data: row, error } = await supabase
      .from("topup_requests")
      .select("proof_path, user_id")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row?.proof_path) return { url: null };
    void userId;
    const { data: signed, error: sErr } = await supabase.storage
      .from(TOPUP_PROOF_BUCKET)
      .createSignedUrl(row.proof_path, 300);
    if (sErr) throw new Error(sErr.message);
    return { url: signed?.signedUrl ?? null };
  });

export const cancelTopup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<TopupRequest> => {
    const { supabase, userId } = context;
    const { data: updated, error } = await supabase
      .from("topup_requests")
      .update({ status: "cancelled" })
      .eq("id", data.id)
      .eq("user_id", userId)
      .eq("status", "pending")
      .select(SELECT_COLS)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!updated) throw new Error("Request can no longer be cancelled");
    return updated as TopupRequest;
  });
