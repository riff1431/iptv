import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdminServer } from "@/lib/admin-guard";

export interface AllowlistState {
  emails: string[];
  updated_at: string | null;
}

type JsonValue =
  | string
  | number
  | boolean
  | null
  | { [k: string]: JsonValue }
  | JsonValue[];

export interface AuditLogEntry {
  id: string;
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  target_table: string;
  target_id: string | null;
  before: JsonValue;
  after: JsonValue;
  created_at: string;
}

export const getAdminAllowlist = createServerFn({ method: "GET" })
  .middleware([requireAdminServer])
  .handler(async (): Promise<AllowlistState> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("app_settings")
      .select("admin_bootstrap_emails, updated_at")
      .eq("id", true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return {
      emails: (data?.admin_bootstrap_emails ?? []) as string[],
      updated_at: data?.updated_at ?? null,
    };
  });

const emailSchema = z.string().trim().toLowerCase().email().max(255);
const updateInput = z.object({
  emails: z.array(emailSchema).max(50),
});

export const updateAdminAllowlist = createServerFn({ method: "POST" })
  .middleware([requireAdminServer])
  .inputValidator((data: unknown) => updateInput.parse(data))
  .handler(async ({ data, context }): Promise<AllowlistState> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Deduplicate while preserving first-seen order.
    const seen = new Set<string>();
    const emails = data.emails.filter((e) => (seen.has(e) ? false : (seen.add(e), true)));

    // Snapshot the previous state for the audit entry.
    const { data: prev } = await supabaseAdmin
      .from("app_settings")
      .select("admin_bootstrap_emails")
      .eq("id", true)
      .maybeSingle();
    const beforeEmails = (prev?.admin_bootstrap_emails ?? []) as string[];

    const { data: row, error } = await supabaseAdmin
      .from("app_settings")
      .update({ admin_bootstrap_emails: emails, updated_at: new Date().toISOString() })
      .eq("id", true)
      .select("admin_bootstrap_emails, updated_at")
      .single();
    if (error) throw new Error(error.message);

    // Best-effort audit write — don't fail the update if logging fails.
    const beforeSorted = [...beforeEmails].sort();
    const afterSorted = [...emails].sort();
    const changed =
      beforeSorted.length !== afterSorted.length ||
      beforeSorted.some((v, i) => v !== afterSorted[i]);

    if (changed) {
      const { data: actor } = await supabaseAdmin.auth.admin.getUserById(context.userId);
      const added = afterSorted.filter((e) => !beforeSorted.includes(e));
      const removed = beforeSorted.filter((e) => !afterSorted.includes(e));

      const { error: auditErr } = await supabaseAdmin.from("admin_audit_log").insert({
        actor_id: context.userId,
        actor_email: actor?.user?.email ?? null,
        action: "update_admin_allowlist",
        target_table: "app_settings",
        target_id: "app_settings",
        before: { admin_bootstrap_emails: beforeEmails },
        after: { admin_bootstrap_emails: emails, added, removed },
      });
      if (auditErr) console.error("[audit] failed to log allowlist update:", auditErr.message);
    }

    return {
      emails: (row.admin_bootstrap_emails ?? []) as string[],
      updated_at: row.updated_at ?? null,
    };
  });

const listInput = z.object({
  target_table: z.string().optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

export const listAdminAuditLog = createServerFn({ method: "GET" })
  .middleware([requireAdminServer])
  .inputValidator((data: unknown) => listInput.parse(data ?? {}))
  .handler(async ({ data }): Promise<AuditLogEntry[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("admin_audit_log")
      .select("id, actor_id, actor_email, action, target_table, target_id, before, after, created_at")
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 50);
    if (data.target_table) q = q.eq("target_table", data.target_table);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []) as AuditLogEntry[];
  });
