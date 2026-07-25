import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { TopupMethod, TopupStatus } from "@/lib/topups.functions";
import { TOPUP_PROOF_BUCKET } from "@/lib/topups.functions";

export interface AdminTopupRow {
  id: string;
  user_id: string;
  amount_cents: number;
  method: TopupMethod;
  payment_method_id: string | null;
  payment_method_label: string | null;
  reference: string | null;
  user_note: string | null;
  proof_path: string | null;
  status: TopupStatus;
  admin_note: string | null;
  processed_at: string | null;
  processed_by: string | null;
  created_at: string;
  updated_at: string;
  user_email: string | null;
  user_display_name: string | null;
}

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin role required");
}

const listInput = z
  .object({
    status: z.enum(["pending", "approved", "rejected", "cancelled", "all"]).optional(),
    limit: z.number().int().min(1).max(500).optional(),
  })
  .optional();

export const adminListTopups = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => listInput.parse(d ?? {}) ?? {})
  .handler(async ({ data, context }): Promise<AdminTopupRow[]> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const status = data?.status ?? "pending";
    const limit = data?.limit ?? 200;

    let query = supabaseAdmin
      .from("topup_requests")
      .select(
        "id, user_id, amount_cents, method, payment_method_id, reference, user_note, proof_path, status, admin_note, processed_at, processed_by, created_at, updated_at",
      )
      .order("created_at", { ascending: false })
      .limit(limit);
    if (status !== "all") query = query.eq("status", status);

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);

    const list = (rows ?? []) as any[];
    const userIds = Array.from(new Set(list.map((r) => r.user_id)));
    const pmIds = Array.from(
      new Set(list.map((r) => r.payment_method_id).filter((v): v is string => !!v)),
    );

    const [{ data: profiles }, pmRes, usersRes] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, display_name").in("id", userIds),
      pmIds.length
        ? supabaseAdmin.from("payment_methods").select("id, label").in("id", pmIds)
        : Promise.resolve({ data: [] as { id: string; label: string }[] }),
      supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 }),
    ]);

    const nameMap = new Map<string, string | null>();
    (profiles ?? []).forEach((p: any) => nameMap.set(p.id, p.display_name));
    const pmMap = new Map<string, string>();
    ((pmRes as any).data ?? []).forEach((p: any) => pmMap.set(p.id, p.label));
    const emailMap = new Map<string, string | null>();
    (usersRes.data?.users ?? []).forEach((u) => emailMap.set(u.id, u.email ?? null));

    return list.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      amount_cents: r.amount_cents,
      method: r.method,
      payment_method_id: r.payment_method_id,
      payment_method_label: r.payment_method_id
        ? pmMap.get(r.payment_method_id) ?? null
        : null,
      reference: r.reference,
      user_note: r.user_note,
      proof_path: r.proof_path,
      status: r.status,
      admin_note: r.admin_note,
      processed_at: r.processed_at,
      processed_by: r.processed_by,
      created_at: r.created_at,
      updated_at: r.updated_at,
      user_email: emailMap.get(r.user_id) ?? null,
      user_display_name: nameMap.get(r.user_id) ?? null,
    }));
  });

const decideInput = z.object({
  id: z.string().uuid(),
  adminNote: z.string().trim().max(500).optional(),
});

export const adminApproveTopup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => decideInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase.rpc("approve_topup_request", {
      _id: data.id,
      _admin_note: data.adminNote ?? undefined,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const adminRejectTopup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => decideInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase.rpc("reject_topup_request", {
      _id: data.id,
      _admin_note: data.adminNote ?? undefined,
    });
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const adminGetTopupProofUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ url: string | null }> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("topup_requests")
      .select("proof_path")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const proof = (row as { proof_path: string | null } | null)?.proof_path ?? null;
    if (!proof) return { url: null };
    const { data: signed, error: sErr } = await supabaseAdmin.storage
      .from(TOPUP_PROOF_BUCKET)
      .createSignedUrl(proof, 300);
    if (sErr) throw new Error(sErr.message);
    return { url: signed?.signedUrl ?? null };
  });

const historyInput = z.object({
  status: z.array(z.enum(["pending", "approved", "rejected", "cancelled"])).optional(),
  userQuery: z.string().trim().max(200).optional(),
  userId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(5).max(100).default(20),
});

export interface AdminTopupHistoryTotals {
  pending: { count: number; amount_cents: number };
  approved: { count: number; amount_cents: number };
  rejected: { count: number; amount_cents: number };
  cancelled: { count: number; amount_cents: number };
  all: { count: number; amount_cents: number };
}

export interface AdminTopupHistoryResult {
  rows: AdminTopupRow[];
  total: number;
  page: number;
  pageSize: number;
  totals: AdminTopupHistoryTotals;
}

function emptyTotals(): AdminTopupHistoryTotals {
  return {
    pending: { count: 0, amount_cents: 0 },
    approved: { count: 0, amount_cents: 0 },
    rejected: { count: 0, amount_cents: 0 },
    cancelled: { count: 0, amount_cents: 0 },
    all: { count: 0, amount_cents: 0 },
  };
}

export const adminListTopupHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => historyInput.parse(d ?? {}))
  .handler(async ({ data, context }): Promise<AdminTopupHistoryResult> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Resolve user filter: explicit userId, or search text over email / display_name.
    let userIdFilter: string[] | null = null;
    const q = (data.userQuery ?? "").trim().toLowerCase();
    if (data.userId) {
      userIdFilter = [data.userId];
    } else if (q.length > 0) {
      const ids = new Set<string>();
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, display_name")
        .ilike("display_name", `%${q}%`)
        .limit(500);
      (profs ?? []).forEach((p: any) => ids.add(p.id));

      const { data: usersData } = await supabaseAdmin.auth.admin.listUsers({
        page: 1,
        perPage: 500,
      });
      (usersData?.users ?? []).forEach((u) => {
        if ((u.email ?? "").toLowerCase().includes(q)) ids.add(u.id);
      });
      userIdFilter = Array.from(ids);
      if (userIdFilter.length === 0) {
        return { rows: [], total: 0, page: data.page, pageSize: data.pageSize, totals: emptyTotals() };
      }
    }

    const statuses = data.status && data.status.length > 0 ? data.status : null;

    const buildQuery = (selectCols: string, count?: "exact") => {
      let q = supabaseAdmin
        .from("topup_requests")
        .select(selectCols, count ? { count } : undefined);
      if (statuses) q = q.in("status", statuses);
      if (userIdFilter) q = q.in("user_id", userIdFilter);
      if (data.from) q = q.gte("created_at", data.from);
      if (data.to) q = q.lte("created_at", data.to);
      return q;
    };

    const from = (data.page - 1) * data.pageSize;
    const to = from + data.pageSize - 1;

    const totalsQuery = supabaseAdmin
      .from("topup_requests")
      .select("status, amount_cents");
    let tq: any = totalsQuery;
    if (userIdFilter) tq = tq.in("user_id", userIdFilter);
    if (data.from) tq = tq.gte("created_at", data.from);
    if (data.to) tq = tq.lte("created_at", data.to);

    const [
      { data: rows, error, count },
      { data: totalsRows, error: totalsErr },
    ] = await Promise.all([
      buildQuery(
        "id, user_id, amount_cents, method, payment_method_id, reference, user_note, proof_path, status, admin_note, processed_at, processed_by, created_at, updated_at",
        "exact",
      )
        .order("created_at", { ascending: false })
        .range(from, to),
      tq.limit(10000),
    ]);

    if (error) throw new Error(error.message);
    if (totalsErr) throw new Error(totalsErr.message);

    const totals = emptyTotals();
    ((totalsRows ?? []) as { status: TopupStatus; amount_cents: number }[]).forEach((r) => {
      const bucket = totals[r.status];
      if (bucket) {
        bucket.count += 1;
        bucket.amount_cents += r.amount_cents;
      }
      totals.all.count += 1;
      totals.all.amount_cents += r.amount_cents;
    });

    const list = (rows ?? []) as any[];
    const userIds = Array.from(new Set(list.map((r) => r.user_id)));
    const pmIds = Array.from(
      new Set(list.map((r) => r.payment_method_id).filter((v): v is string => !!v)),
    );

    const [{ data: profiles }, pmRes, usersRes] = await Promise.all([
      userIds.length
        ? supabaseAdmin.from("profiles").select("id, display_name").in("id", userIds)
        : Promise.resolve({ data: [] as { id: string; display_name: string | null }[] }),
      pmIds.length
        ? supabaseAdmin.from("payment_methods").select("id, label").in("id", pmIds)
        : Promise.resolve({ data: [] as { id: string; label: string }[] }),
      supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 500 }),
    ]);

    const nameMap = new Map<string, string | null>();
    ((profiles as any) ?? []).forEach((p: any) => nameMap.set(p.id, p.display_name));
    const pmMap = new Map<string, string>();
    ((pmRes as any).data ?? []).forEach((p: any) => pmMap.set(p.id, p.label));
    const emailMap = new Map<string, string | null>();
    (usersRes.data?.users ?? []).forEach((u) => emailMap.set(u.id, u.email ?? null));

    return {
      rows: list.map((r) => ({
        id: r.id,
        user_id: r.user_id,
        amount_cents: r.amount_cents,
        method: r.method,
        payment_method_id: r.payment_method_id,
        payment_method_label: r.payment_method_id
          ? pmMap.get(r.payment_method_id) ?? null
          : null,
        reference: r.reference,
        user_note: r.user_note,
        proof_path: r.proof_path,
        status: r.status,
        admin_note: r.admin_note,
        processed_at: r.processed_at,
        processed_by: r.processed_by,
        created_at: r.created_at,
        updated_at: r.updated_at,
        user_email: emailMap.get(r.user_id) ?? null,
        user_display_name: nameMap.get(r.user_id) ?? null,
      })),
      total: count ?? 0,
      page: data.page,
      pageSize: data.pageSize,
      totals,
    };
  });

const exportInput = z.object({
  status: z.array(z.enum(["pending", "approved", "rejected", "cancelled"])).optional(),
  userQuery: z.string().trim().max(200).optional(),
  userId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(10000).default(10000),
});

export interface AdminTopupExportResult {
  rows: AdminTopupRow[];
  truncated: boolean;
  limit: number;
}

export const adminExportTopupHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => exportInput.parse(d ?? {}))
  .handler(async ({ data, context }): Promise<AdminTopupExportResult> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let userIdFilter: string[] | null = null;
    const q = (data.userQuery ?? "").trim().toLowerCase();
    if (data.userId) {
      userIdFilter = [data.userId];
    } else if (q.length > 0) {
      const ids = new Set<string>();
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, display_name")
        .ilike("display_name", `%${q}%`)
        .limit(500);
      (profs ?? []).forEach((p: any) => ids.add(p.id));
      const { data: usersData } = await supabaseAdmin.auth.admin.listUsers({
        page: 1,
        perPage: 500,
      });
      (usersData?.users ?? []).forEach((u) => {
        if ((u.email ?? "").toLowerCase().includes(q)) ids.add(u.id);
      });
      userIdFilter = Array.from(ids);
      if (userIdFilter.length === 0) {
        return { rows: [], truncated: false, limit: data.limit };
      }
    }

    const statuses = data.status && data.status.length > 0 ? data.status : null;
    const limit = data.limit;

    let query: any = supabaseAdmin
      .from("topup_requests")
      .select(
        "id, user_id, amount_cents, method, payment_method_id, reference, user_note, proof_path, status, admin_note, processed_at, processed_by, created_at, updated_at",
      )
      .order("created_at", { ascending: false })
      .limit(limit);
    if (statuses) query = query.in("status", statuses);
    if (userIdFilter) query = query.in("user_id", userIdFilter);
    if (data.from) query = query.gte("created_at", data.from);
    if (data.to) query = query.lte("created_at", data.to);

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);

    const list = (rows ?? []) as any[];
    const userIds = Array.from(new Set(list.map((r) => r.user_id)));
    const pmIds = Array.from(
      new Set(list.map((r) => r.payment_method_id).filter((v): v is string => !!v)),
    );

    const [{ data: profiles }, pmRes, usersRes] = await Promise.all([
      userIds.length
        ? supabaseAdmin.from("profiles").select("id, display_name").in("id", userIds)
        : Promise.resolve({ data: [] as { id: string; display_name: string | null }[] }),
      pmIds.length
        ? supabaseAdmin.from("payment_methods").select("id, label").in("id", pmIds)
        : Promise.resolve({ data: [] as { id: string; label: string }[] }),
      supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ]);

    const nameMap = new Map<string, string | null>();
    ((profiles as any) ?? []).forEach((p: any) => nameMap.set(p.id, p.display_name));
    const pmMap = new Map<string, string>();
    ((pmRes as any).data ?? []).forEach((p: any) => pmMap.set(p.id, p.label));
    const emailMap = new Map<string, string | null>();
    (usersRes.data?.users ?? []).forEach((u) => emailMap.set(u.id, u.email ?? null));

    return {
      rows: list.map((r) => ({
        id: r.id,
        user_id: r.user_id,
        amount_cents: r.amount_cents,
        method: r.method,
        payment_method_id: r.payment_method_id,
        payment_method_label: r.payment_method_id
          ? pmMap.get(r.payment_method_id) ?? null
          : null,
        reference: r.reference,
        user_note: r.user_note,
        proof_path: r.proof_path,
        status: r.status,
        admin_note: r.admin_note,
        processed_at: r.processed_at,
        processed_by: r.processed_by,
        created_at: r.created_at,
        updated_at: r.updated_at,
        user_email: emailMap.get(r.user_id) ?? null,
        user_display_name: nameMap.get(r.user_id) ?? null,
      })),
      truncated: list.length >= limit,
      limit,
    };
  });


