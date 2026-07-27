import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdminServer } from "@/lib/admin-guard";

export interface IptvRejectionRow {
  id: string;
  request_id: string;
  status: number;
  reason: string;
  host: string | null;
  raw_url_length: number;
  method: string;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface IptvRejectionPage {
  rows: IptvRejectionRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface IptvRejectionFacets {
  reasons: string[];
  hosts: string[];
}

const queryInput = z.object({
  request_id: z.string().trim().max(200).optional(),
  reason: z.string().trim().max(300).optional(),
  host: z.string().trim().max(255).optional(),
  q: z.string().trim().max(200).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.number().int().min(1).max(10_000).default(1),
  pageSize: z.number().int().min(5).max(100).default(25),
});

function escapeIlike(v: string) {
  return v.replace(/\\/g, "\\\\").replace(/[%_]/g, (m) => `\\${m}`);
}

export const queryIptvRejections = createServerFn({ method: "POST" })
  .middleware([requireAdminServer])
  .validator((data: unknown) => queryInput.parse(data ?? {}))
  .handler(async ({ data }): Promise<IptvRejectionPage> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let q = supabaseAdmin
      .from("iptv_proxy_rejections")
      .select(
        "id, request_id, status, reason, host, raw_url_length, method, ip, user_agent, created_at",
        { count: "exact" },
      )
      .order("created_at", { ascending: false });

    if (data.request_id) q = q.ilike("request_id", `%${escapeIlike(data.request_id)}%`);
    if (data.reason) q = q.eq("reason", data.reason);
    if (data.host) q = q.ilike("host", `%${escapeIlike(data.host)}%`);
    if (data.from) q = q.gte("created_at", data.from);
    if (data.to) q = q.lte("created_at", data.to);

    if (data.q) {
      const like = `%${escapeIlike(data.q)}%`;
      q = q.or(
        [
          `request_id.ilike.${like}`,
          `reason.ilike.${like}`,
          `host.ilike.${like}`,
          `ip.ilike.${like}`,
        ].join(","),
      );
    }

    const from = (data.page - 1) * data.pageSize;
    const to = from + data.pageSize - 1;
    q = q.range(from, to);

    const { data: rows, error, count } = await q;
    if (error) throw new Error(error.message);
    return {
      rows: (rows ?? []) as IptvRejectionRow[],
      total: count ?? 0,
      page: data.page,
      pageSize: data.pageSize,
    };
  });

export const getIptvRejectionFacets = createServerFn({ method: "GET" })
  .middleware([requireAdminServer])
  .handler(async (): Promise<IptvRejectionFacets> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("iptv_proxy_rejections")
      .select("reason, host")
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) throw new Error(error.message);
    const reasons = new Set<string>();
    const hosts = new Set<string>();
    for (const r of data ?? []) {
      if (r.reason) reasons.add(r.reason);
      if (r.host) hosts.add(r.host);
    }
    return {
      reasons: [...reasons].sort(),
      hosts: [...hosts].sort(),
    };
  });
