import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdminServer } from "@/lib/admin-guard";

type JsonValue = string | number | boolean | null | { [k: string]: JsonValue } | JsonValue[];

export interface AuditLogRow {
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

export interface AuditLogPage {
  rows: AuditLogRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AuditLogFacets {
  actions: string[];
  targetTables: string[];
}

const queryInput = z.object({
  action: z.string().trim().max(120).optional(),
  target_table: z.string().trim().max(120).optional(),
  user: z.string().trim().max(255).optional(), // email or actor_id (uuid) fragment
  path: z.string().trim().max(500).optional(), // matches target_id (e.g. /admin/users)
  q: z.string().trim().max(200).optional(), // free-text across email/action/path
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.number().int().min(1).max(10_000).default(1),
  pageSize: z.number().int().min(5).max(100).default(25),
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function escapeIlike(v: string) {
  // Escape %, _, and \ for use inside PostgREST ilike patterns.
  return v.replace(/\\/g, "\\\\").replace(/[%_]/g, (m) => `\\${m}`);
}

export const queryAdminAuditLog = createServerFn({ method: "POST" })
  .middleware([requireAdminServer])
  .validator((data: unknown) => queryInput.parse(data ?? {}))
  .handler(async ({ data }): Promise<AuditLogPage> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let q = supabaseAdmin
      .from("admin_audit_log")
      .select(
        "id, actor_id, actor_email, action, target_table, target_id, before, after, created_at",
        { count: "exact" },
      )
      .order("created_at", { ascending: false });

    if (data.action) q = q.eq("action", data.action);
    if (data.target_table) q = q.eq("target_table", data.target_table);
    if (data.path) q = q.ilike("target_id", `%${escapeIlike(data.path)}%`);
    if (data.from) q = q.gte("created_at", data.from);
    if (data.to) q = q.lte("created_at", data.to);

    if (data.user) {
      const v = data.user;
      if (UUID_RE.test(v)) {
        q = q.eq("actor_id", v);
      } else {
        q = q.ilike("actor_email", `%${escapeIlike(v)}%`);
      }
    }

    if (data.q) {
      const like = `%${escapeIlike(data.q)}%`;
      q = q.or(
        [
          `actor_email.ilike.${like}`,
          `action.ilike.${like}`,
          `target_table.ilike.${like}`,
          `target_id.ilike.${like}`,
        ].join(","),
      );
    }

    const from = (data.page - 1) * data.pageSize;
    const to = from + data.pageSize - 1;
    q = q.range(from, to);

    const { data: rows, error, count } = await q;
    if (error) throw new Error(error.message);
    return {
      rows: (rows ?? []) as AuditLogRow[],
      total: count ?? 0,
      page: data.page,
      pageSize: data.pageSize,
    };
  });

export const getAdminAuditFacets = createServerFn({ method: "GET" })
  .middleware([requireAdminServer])
  .handler(async (): Promise<AuditLogFacets> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Pull recent 1000 entries to build facet options — good enough for a UI dropdown.
    const { data, error } = await supabaseAdmin
      .from("admin_audit_log")
      .select("action, target_table")
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) throw new Error(error.message);
    const actions = new Set<string>();
    const targetTables = new Set<string>();
    for (const r of data ?? []) {
      if (r.action) actions.add(r.action);
      if (r.target_table) targetTables.add(r.target_table);
    }
    return {
      actions: [...actions].sort(),
      targetTables: [...targetTables].sort(),
    };
  });
