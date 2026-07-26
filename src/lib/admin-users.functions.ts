import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AppRole = "admin" | "moderator" | "user";

export interface AdminUserRow {
  id: string;
  email: string | null;
  email_confirmed_at: string | null;
  last_sign_in_at: string | null;
  created_at: string;
  display_name: string | null;
  roles: AppRole[];
  is_creator?: boolean;
  is_vip?: boolean;
}

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin role required");
}

export const listAdminUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminUserRow[]> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: usersData, error: usersErr } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    if (usersErr) throw new Error(usersErr.message);

    const users = usersData.users;
    const ids = users.map((u) => u.id);

    const [{ data: roles, error: rolesErr }, { data: profiles, error: profErr }] =
      await Promise.all([
        supabaseAdmin.from("user_roles").select("user_id, role").in("user_id", ids),
        supabaseAdmin.from("profiles").select("id, display_name").in("id", ids),
      ]);
    if (rolesErr) throw new Error(rolesErr.message);
    if (profErr) throw new Error(profErr.message);

    const roleMap = new Map<string, AppRole[]>();
    (roles ?? []).forEach((r: { user_id: string; role: AppRole }) => {
      const arr = roleMap.get(r.user_id) ?? [];
      arr.push(r.role);
      roleMap.set(r.user_id, arr);
    });
    const nameMap = new Map<string, string | null>();
    (profiles ?? []).forEach((p: { id: string; display_name: string | null }) =>
      nameMap.set(p.id, p.display_name),
    );

    return users
      .map((u) => ({
        id: u.id,
        email: u.email ?? null,
        email_confirmed_at: u.email_confirmed_at ?? null,
        last_sign_in_at: u.last_sign_in_at ?? null,
        created_at: u.created_at,
        display_name: nameMap.get(u.id) ?? null,
        roles: roleMap.get(u.id) ?? [],
        is_creator: u.user_metadata?.is_creator === true,
        is_vip: u.user_metadata?.is_vip === true,
      }))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  });

const updateRoleInput = z.object({
  userId: z.string().uuid(),
  role: z.enum(["admin", "moderator", "user"]),
  action: z.enum(["grant", "revoke"]),
});

export const updateUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => updateRoleInput.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.action === "grant") {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .upsert(
          { user_id: data.userId, role: data.role },
          { onConflict: "user_id,role", ignoreDuplicates: true },
        );
      if (error) throw new Error(error.message);
    } else {
      // Guard against removing self-admin last-standing is handled by DB trigger
      const { error } = await supabaseAdmin
        .from("user_roles")
        .delete()
        .eq("user_id", data.userId)
        .eq("role", data.role);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

const resetInput = z.object({
  email: z.string().email(),
  redirectTo: z.string().url().optional(),
});

export const adminSendPasswordReset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => resetInput.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Uses the configured auth email template + SMTP; goes to the user's inbox,
    // never returned to the admin.
    const { error } = await supabaseAdmin.auth.resetPasswordForEmail(data.email, {
      redirectTo: data.redirectTo,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const creditWalletInput = z.object({
  userId: z.string().uuid(),
  // Cents. Min $1.00, max $10,000.00 per admin credit.
  amountCents: z.number().int().min(100).max(1_000_000),
  memo: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
});

export interface AdminCreditWalletResult {
  transactionId: string;
  userId: string;
  amountCents: number;
  newBalanceCents: number;
}

/**
 * Admin-only: credit an arbitrary user's wallet with a manual adjustment.
 *
 * Writes a `credit`-type wallet_transaction on behalf of the target user,
 * records an admin_audit_log entry, and posts an in-app notification so
 * the recipient can see who credited them and why.
 */
export const adminCreditUserWallet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => creditWalletInput.parse(data))
  .handler(async ({ data, context }): Promise<AdminCreditWalletResult> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const actorId = context.userId;
    const actorEmail = (context.claims?.email as string | undefined) ?? null;

    // Verify the target user actually exists to avoid orphan wallet rows.
    const { data: targetUser, error: targetErr } = await supabaseAdmin.auth.admin.getUserById(
      data.userId,
    );
    if (targetErr || !targetUser?.user) {
      throw new Error("Target user not found");
    }

    const memo = data.memo
      ? `Admin credit — ${data.memo}`
      : `Admin credit by ${actorEmail ?? actorId}`;

    const { data: tx, error: insertErr } = await supabaseAdmin
      .from("wallet_transactions")
      .insert({
        user_id: data.userId,
        type: "credit",
        amount_cents: data.amountCents,
        memo,
        external_ref: `admin-credit:${actorId}`,
      })
      .select("id")
      .single();
    if (insertErr || !tx) {
      throw new Error(insertErr?.message ?? "Failed to credit wallet");
    }

    // Audit trail — non-fatal if this fails, but log server-side.
    const { error: auditErr } = await supabaseAdmin.from("admin_audit_log").insert({
      actor_id: actorId,
      actor_email: actorEmail,
      action: "admin_credit_wallet",
      target_table: "wallet_transactions",
      target_id: tx.id,
      after: {
        target_user_id: data.userId,
        target_email: targetUser.user.email ?? null,
        amount_cents: data.amountCents,
        memo,
      },
    });
    if (auditErr) console.error("adminCreditUserWallet audit failed", auditErr);

    // Notify the recipient in-app.
    const dollars = (data.amountCents / 100).toFixed(2);
    await supabaseAdmin.from("notifications").insert({
      user_id: data.userId,
      kind: "wallet",
      title: "Wallet credited",
      body: `An admin credited $${dollars} to your wallet.${data.memo ? ` Note: ${data.memo}` : ""}`,
      link: "/wallet",
    });

    // Recompute balance via the existing SECURITY DEFINER RPC so the UI can
    // display the resulting balance without re-fetching.
    const { data: balance, error: balErr } = await supabaseAdmin.rpc("wallet_balance_cents", {
      _user_id: data.userId,
    });
    if (balErr) throw new Error(balErr.message);

    return {
      transactionId: tx.id,
      userId: data.userId,
      amountCents: data.amountCents,
      newBalanceCents: (balance as number | null) ?? 0,
    };
  });

const updateMetadataInput = z.object({
  userId: z.string().uuid(),
  field: z.enum(["is_creator", "is_vip"]),
  value: z.boolean(),
});

export const updateUserMetadata = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => updateMetadataInput.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Fetch current user details to keep other user metadata intact
    const { data: userObj, error: fetchErr } = await supabaseAdmin.auth.admin.getUserById(
      data.userId,
    );
    if (fetchErr || !userObj?.user) {
      throw new Error(fetchErr?.message || "User not found");
    }

    const currentMeta = userObj.user.user_metadata || {};
    const updatedMeta = {
      ...currentMeta,
      [data.field]: data.value,
    };

    const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      user_metadata: updatedMeta,
    });

    if (updateErr) {
      throw new Error(updateErr.message);
    }

    return { ok: true };
  });
