import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

// Admin-gated wrappers around the withdrawal approve/reject/mark-paid RPCs.
// Mirrors admin-topups.functions.ts. The RPCs (defined in
// 20260728000002_withdrawal_ledger_and_rpcs.sql) are the authority: they check
// has_role('admin'), lock the row, re-validate balance, and debit the ledger.

type AuthContext = { supabase: SupabaseClient<Database>; userId: string };

async function assertAdmin(context: AuthContext) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin role required");
}

const decideInput = z.object({
  id: z.string().uuid(),
  adminNote: z.string().trim().max(500).optional(),
});

/** Admin approves a pending withdrawal: debits the wallet and sets status=approved. */
export const adminApproveWithdrawal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => decideInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase.rpc("approve_withdrawal_request", {
      _id: data.id,
      _admin_note: data.adminNote ?? undefined,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/** Admin rejects a pending withdrawal: sets status=rejected, no balance impact. */
export const adminRejectWithdrawal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => decideInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase.rpc("reject_withdrawal_request", {
      _id: data.id,
      _admin_note: data.adminNote ?? undefined,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/** Admin marks an approved withdrawal as paid out: status=paid, no balance impact. */
export const adminMarkWithdrawalPaid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => decideInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase.rpc("mark_withdrawal_paid", {
      _id: data.id,
      _admin_note: data.adminNote ?? undefined,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
