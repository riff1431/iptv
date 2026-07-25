import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const inputSchema = z.object({
  action: z.enum(["admin_access", "admin_denied"]),
  path: z.string().trim().min(1).max(2048),
  reason: z.string().trim().max(500).optional(),
});

/**
 * Records admin route visits and permission denials into `admin_audit_log`.
 * Requires an authenticated caller — anonymous hits to admin routes are
 * redirected to /auth before this can run.
 *
 * Uses the service-role client to write regardless of RLS (the audit table
 * has no INSERT policy for authenticated users), but performs its own
 * role check so signed-in-but-not-admin users are recorded as denials
 * rather than silently permitted to write arbitrary audit rows.
 */
export const logAdminAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;
    const email = (claims?.email as string | undefined) ?? null;

    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });

    // For allow events, only admins may write.
    // For deny events, we always log — that's the whole point.
    if (data.action === "admin_access" && !isAdmin) {
      return { logged: false as const };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("admin_audit_log").insert({
      actor_id: userId,
      actor_email: email,
      action: data.action,
      target_table: "admin_route",
      target_id: data.path,
      after: data.reason ? { reason: data.reason } : null,
    });
    if (error) {
      console.error("logAdminAccess insert failed", error);
      return { logged: false as const };
    }
    return { logged: true as const };
  });
