import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

export type WalletTxType = Database["public"]["Enums"]["wallet_tx_type"];

export interface WalletTransaction {
  id: string;
  type: WalletTxType;
  amount_cents: number;
  memo: string | null;
  external_ref: string | null;
  lounge_session_id: string | null;
  created_at: string;
}

export interface WalletOverview {
  balanceCents: number;
  totals: {
    creditCents: number;
    refundCents: number;
    debitCents: number;
    txCount: number;
  };
  recent: WalletTransaction[];
}

export interface WalletTransactionsPage {
  rows: WalletTransaction[];
  total: number;
  page: number;
  pageSize: number;
}

export interface WalletTransactionDetail {
  tx: WalletTransaction;
  loungeSession: {
    id: string;
    lounge_id: string;
    entered_at: string;
    paid_at: string | null;
    expires_at: string | null;
    amount_cents: number;
    status: string;
    created_at: string;
    lounge: {
      id: string;
      slug: string;
      name: string;
      tagline: string | null;
      vibe: string | null;
      entry_fee_cents: number;
    } | null;
  } | null;
}

const listInput = z.object({
  type: z
    .enum(["debit_lounge_entry", "debit_match_entry", "debit_vip_upgrade", "refund", "credit"])
    .optional(),
  q: z.string().trim().max(200).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.number().int().min(1).max(10_000).default(1),
  pageSize: z.number().int().min(5).max(100).default(20),
});

function escIlike(v: string) {
  return v.replace(/\\/g, "\\\\").replace(/[%_]/g, (m) => `\\${m}`);
}

export const getWalletOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WalletOverview> => {
    const { supabase, userId } = context;

    const [balance, allRows, recent] = await Promise.all([
      supabase.rpc("wallet_balance_cents", { _user_id: userId }),
      supabase.from("wallet_transactions").select("type, amount_cents").eq("user_id", userId),
      supabase
        .from("wallet_transactions")
        .select("id, type, amount_cents, memo, external_ref, lounge_session_id, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

    if (allRows.error) throw new Error(allRows.error.message);
    if (recent.error) throw new Error(recent.error.message);

    let creditCents = 0;
    let refundCents = 0;
    let debitCents = 0;
    for (const r of allRows.data ?? []) {
      if (r.type === "credit") creditCents += r.amount_cents;
      else if (r.type === "refund") refundCents += r.amount_cents;
      else if (
        r.type === "debit_lounge_entry" ||
        r.type === "debit_match_entry" ||
        r.type === "debit_vip_upgrade" ||
        r.type === "debit_tip"
      )
        debitCents += r.amount_cents;
    }

    return {
      balanceCents: (balance.data as number | null) ?? 0,
      totals: {
        creditCents,
        refundCents,
        debitCents,
        txCount: (allRows.data ?? []).length,
      },
      recent: (recent.data ?? []) as WalletTransaction[],
    };
  });

export const listWalletTransactions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => listInput.parse(d ?? {}))
  .handler(async ({ data, context }): Promise<WalletTransactionsPage> => {
    const { supabase, userId } = context;
    let q = supabase
      .from("wallet_transactions")
      .select("id, type, amount_cents, memo, external_ref, lounge_session_id, created_at", {
        count: "exact",
      })
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (data.type) q = q.eq("type", data.type);
    if (data.from) q = q.gte("created_at", data.from);
    if (data.to) q = q.lte("created_at", data.to);
    if (data.q) {
      const like = `%${escIlike(data.q)}%`;
      q = q.or(
        [
          `memo.ilike.${like}`,
          `external_ref.ilike.${like}`,
          `lounge_session_id.ilike.${like}`,
        ].join(","),
      );
    }

    const from = (data.page - 1) * data.pageSize;
    const to = from + data.pageSize - 1;
    q = q.range(from, to);

    const { data: rows, error, count } = await q;
    if (error) throw new Error(error.message);
    return {
      rows: (rows ?? []) as WalletTransaction[],
      total: count ?? 0,
      page: data.page,
      pageSize: data.pageSize,
    };
  });

export const getWalletTransactionDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<WalletTransactionDetail> => {
    const { supabase, userId } = context;
    const { data: tx, error } = await supabase
      .from("wallet_transactions")
      .select("id, type, amount_cents, memo, external_ref, lounge_session_id, created_at")
      .eq("id", data.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!tx) throw new Error("Transaction not found");

    let loungeSession: WalletTransactionDetail["loungeSession"] = null;
    if (tx.lounge_session_id) {
      const { data: ls, error: lsErr } = await supabase
        .from("lounge_sessions")
        .select(
          "id, lounge_id, entered_at, paid_at, expires_at, amount_cents, status, created_at, lounge:lounges(id, slug, name, tagline, vibe, entry_fee_cents)",
        )
        .eq("id", tx.lounge_session_id)
        .eq("user_id", userId)
        .maybeSingle();
      if (lsErr) throw new Error(lsErr.message);
      if (ls) {
        loungeSession = {
          ...ls,
          lounge: (Array.isArray(ls.lounge) ? ls.lounge[0] : ls.lounge) ?? null,
        } as WalletTransactionDetail["loungeSession"];
      }
    }

    return { tx: tx as WalletTransaction, loungeSession };
  });

export type WalletAnalyticsRange = "7d" | "30d" | "90d" | "all";
export type WalletBucketUnit = "day" | "week" | "month";

export interface WalletAnalytics {
  range: WalletAnalyticsRange;
  bucketUnit: WalletBucketUnit;
  balanceSeries: {
    date: string;
    balanceCents: number;
    startISO: string;
    endISO: string;
  }[];
  spendBuckets: {
    key: string;
    label: string;
    startISO: string;
    endISO: string;
    byType: Record<WalletTxType, number>;
  }[];
}

const RangeSchema = z.object({
  range: z.enum(["7d", "30d", "90d", "all"]).default("30d"),
});

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}
function ym(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function isoWeekKey(d: Date) {
  // ISO week: shift to Thursday of the same week.
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export const getWalletAnalytics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => RangeSchema.parse(data ?? {}))
  .handler(async ({ context, data }): Promise<WalletAnalytics> => {
    const { supabase, userId } = context;
    const { range } = data;

    const { data: rowsRaw, error } = await supabase
      .from("wallet_transactions")
      .select("type, amount_cents, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const rows = (rowsRaw ?? []) as {
      type: WalletTxType;
      amount_cents: number;
      created_at: string;
    }[];

    const signed = (t: WalletTxType, cents: number) =>
      t === "credit" || t === "refund" ? cents : -cents;

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    let startDate: Date;
    let bucketUnit: WalletBucketUnit;
    if (range === "7d") {
      startDate = new Date(today);
      startDate.setUTCDate(today.getUTCDate() - 6);
      bucketUnit = "day";
    } else if (range === "30d") {
      startDate = new Date(today);
      startDate.setUTCDate(today.getUTCDate() - 29);
      bucketUnit = "day";
    } else if (range === "90d") {
      startDate = new Date(today);
      startDate.setUTCDate(today.getUTCDate() - 89);
      bucketUnit = "week";
    } else {
      const first = rows.length ? new Date(rows[0].created_at) : today;
      startDate = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1));
      bucketUnit = "month";
    }

    // Balance series: always daily for windowed ranges, monthly for "all".
    const balanceSeries: {
      date: string;
      balanceCents: number;
      startISO: string;
      endISO: string;
    }[] = [];
    let priorBalance = 0;
    const inWindowDeltas = new Map<string, number>();
    const dailyKey = (d: Date) =>
      ymd(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())));
    const monthlyKey = (d: Date) => ym(d);

    for (const r of rows) {
      const d = new Date(r.created_at);
      if (d < startDate) {
        priorBalance += signed(r.type, r.amount_cents);
        continue;
      }
      const k = bucketUnit === "month" ? monthlyKey(d) : dailyKey(d);
      inWindowDeltas.set(k, (inWindowDeltas.get(k) ?? 0) + signed(r.type, r.amount_cents));
    }

    const dayStartISO = (d: Date) =>
      new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
    const dayEndISO = (d: Date) =>
      new Date(
        Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999),
      ).toISOString();
    const monthStartISO = (d: Date) =>
      new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
    const monthEndISO = (d: Date) =>
      new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59, 999)).toISOString();
    const weekEndISO = (weekStart: Date) => {
      const end = new Date(weekStart);
      end.setUTCDate(weekStart.getUTCDate() + 6);
      return dayEndISO(end);
    };

    let running = priorBalance;
    if (bucketUnit === "month") {
      const cursor = new Date(startDate);
      while (cursor <= today) {
        const k = ym(cursor);
        running += inWindowDeltas.get(k) ?? 0;
        balanceSeries.push({
          date: `${k}-01`,
          balanceCents: running,
          startISO: monthStartISO(cursor),
          endISO: monthEndISO(cursor),
        });
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      }
    } else {
      const days = Math.round((today.getTime() - startDate.getTime()) / 86400000) + 1;
      for (let i = 0; i < days; i++) {
        const d = new Date(startDate);
        d.setUTCDate(startDate.getUTCDate() + i);
        const k = ymd(d);
        running += inWindowDeltas.get(k) ?? 0;
        balanceSeries.push({
          date: k,
          balanceCents: running,
          startISO: dayStartISO(d),
          endISO: dayEndISO(d),
        });
      }
    }

    // Spend buckets: keyed by day/week/month depending on range, tracking each type.
    const emptyByType = (): Record<WalletTxType, number> => ({
      credit: 0,
      refund: 0,
      debit_lounge_entry: 0,
      debit_match_entry: 0,
      debit_tip: 0,
      debit_vip_upgrade: 0,
    });
    const bucketOrder: string[] = [];
    const bucketLabel = new Map<string, string>();
    const bucketByType = new Map<string, Record<WalletTxType, number>>();
    const bucketStart = new Map<string, string>();
    const bucketEnd = new Map<string, string>();

    const pushBucket = (key: string, label: string, startISO: string, endISO: string) => {
      if (bucketByType.has(key)) return;
      bucketOrder.push(key);
      bucketLabel.set(key, label);
      bucketByType.set(key, emptyByType());
      bucketStart.set(key, startISO);
      bucketEnd.set(key, endISO);
    };

    if (bucketUnit === "day") {
      const days = Math.round((today.getTime() - startDate.getTime()) / 86400000) + 1;
      for (let i = 0; i < days; i++) {
        const d = new Date(startDate);
        d.setUTCDate(startDate.getUTCDate() + i);
        pushBucket(ymd(d), ymd(d), dayStartISO(d), dayEndISO(d));
      }
    } else if (bucketUnit === "week") {
      const cursor = new Date(startDate);
      while (cursor <= today) {
        pushBucket(isoWeekKey(cursor), ymd(cursor), dayStartISO(cursor), weekEndISO(cursor));
        cursor.setUTCDate(cursor.getUTCDate() + 7);
      }
    } else {
      const cursor = new Date(startDate);
      while (cursor <= today) {
        pushBucket(ym(cursor), ym(cursor), monthStartISO(cursor), monthEndISO(cursor));
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      }
    }

    for (const r of rows) {
      const d = new Date(r.created_at);
      if (d < startDate) continue;
      const key =
        bucketUnit === "day" ? dailyKey(d) : bucketUnit === "week" ? isoWeekKey(d) : ym(d);
      const bucket = bucketByType.get(key);
      if (!bucket) continue;
      bucket[r.type] += r.amount_cents;
    }

    const spendBuckets = bucketOrder.map((k) => ({
      key: k,
      label: bucketLabel.get(k)!,
      startISO: bucketStart.get(k)!,
      endISO: bucketEnd.get(k)!,
      byType: bucketByType.get(k)!,
    }));

    return { range, bucketUnit, balanceSeries, spendBuckets };
  });

export interface VipStatus {
  isVip: boolean;
  expiresAt: string | null;
}

export interface VipUpgradeResult extends VipStatus {
  charged: boolean;
}

export const getVipStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<VipStatus> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("is_vip, vip_expires_at")
      .eq("id", context.userId)
      .maybeSingle();

    if (error) throw new Error(error.message);

    const expiresAt = data?.vip_expires_at ?? null;
    const isVip =
      data?.is_vip === true && expiresAt !== null && new Date(expiresAt).getTime() > Date.now();

    return { isVip, expiresAt: isVip ? expiresAt : null };
  });

export const upgradeUserVip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<VipUpgradeResult> => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Locks the profile row and performs the balance check, debit, and
    // entitlement update atomically. Repeated calls do not charge again.
    const { data, error } = await supabaseAdmin.rpc("upgrade_user_vip", {
      _user_id: userId,
    });
    if (error) throw new Error(error.message);

    const row = data?.[0];
    if (!row?.is_vip || !row.vip_expires_at) {
      throw new Error("VIP upgrade did not return an active membership.");
    }

    // Keep legacy consumers compatible. The profiles row is canonical, so a
    // metadata-sync failure does not turn a committed payment into an error.
    try {
      const { data: userObj } = await supabaseAdmin.auth.admin.getUserById(userId);
      if (userObj?.user) {
        await supabaseAdmin.auth.admin.updateUserById(userId, {
          user_metadata: {
            ...(userObj.user.user_metadata ?? {}),
            is_vip: true,
            vip_expires_at: row.vip_expires_at,
          },
        });
      }
    } catch (metadataError) {
      console.error("[vip] auth metadata compatibility sync failed", metadataError);
    }

    return {
      isVip: true,
      expiresAt: row.vip_expires_at,
      charged: row.charged,
    };
  });
