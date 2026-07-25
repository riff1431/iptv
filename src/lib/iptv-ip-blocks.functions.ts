import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdminServer } from "@/lib/admin-guard";


export interface IptvIpBlockRow {
  ip: string;
  blocked_until: string;
  reason: string;
  hits: number;
  created_at: string;
  updated_at: string;
  active: boolean;
}

export interface IptvIpBlockPage {
  rows: IptvIpBlockRow[];
  total: number;
  activeCount: number;
}

const listInput = z.object({
  q: z.string().trim().max(200).optional(),
  activeOnly: z.boolean().optional().default(false),
});

function escapeIlike(v: string) {
  return v.replace(/\\/g, "\\\\").replace(/[%_]/g, (m) => `\\${m}`);
}

export const listIptvIpBlocks = createServerFn({ method: "POST" })
  .middleware([requireAdminServer])
  .inputValidator((data: unknown) => listInput.parse(data ?? {}))
  .handler(async ({ data }): Promise<IptvIpBlockPage> => {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );

    let q = supabaseAdmin
      .from("iptv_proxy_ip_blocks")
      .select("ip, blocked_until, reason, hits, created_at, updated_at", {
        count: "exact",
      })
      .order("blocked_until", { ascending: false })
      .limit(500);

    if (data.q) {
      const like = `%${escapeIlike(data.q)}%`;
      q = q.or([`ip.ilike.${like}`, `reason.ilike.${like}`].join(","));
    }
    if (data.activeOnly) {
      q = q.gt("blocked_until", new Date().toISOString());
    }

    const { data: rows, error, count } = await q;
    if (error) throw new Error(error.message);
    const now = Date.now();
    const mapped: IptvIpBlockRow[] = (rows ?? []).map((r) => ({
      ...r,
      active: new Date(r.blocked_until).getTime() > now,
    }));
    return {
      rows: mapped,
      total: count ?? mapped.length,
      activeCount: mapped.filter((r) => r.active).length,
    };
  });

const unblockInput = z.object({
  ip: z.string().trim().min(1).max(64),
});

export const unblockIptvIp = createServerFn({ method: "POST" })
  .middleware([requireAdminServer])
  .inputValidator((data: unknown) => unblockInput.parse(data))
  .handler(async ({ data, context }): Promise<{ ok: true; ip: string }> => {
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { error } = await supabaseAdmin
      .from("iptv_proxy_ip_blocks")
      .delete()
      .eq("ip", data.ip);
    if (error) throw new Error(error.message);

    const email = (context.claims?.email as string | undefined) ?? null;
    await supabaseAdmin.from("admin_audit_log").insert({
      actor_id: context.userId,
      actor_email: email,
      action: "iptv_ip_unblock",
      target_table: "iptv_proxy_ip_blocks",
      target_id: data.ip,
    });

    return { ok: true, ip: data.ip };
  });
