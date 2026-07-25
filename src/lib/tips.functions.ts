import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const TIP_MIN_CENTS = 100;
export const TIP_MAX_CENTS = 50_000;

export type TipDirection = "sent" | "received";

export interface TipEntry {
  id: string;
  direction: TipDirection;
  amount_cents: number;
  memo: string | null;
  created_at: string;
  // The "other party" from the current user's perspective
  counterparty: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
  lounge: {
    id: string;
    slug: string;
    name: string;
  } | null;
  chat_message_id: string | null;
  direct_message_id: string | null;
  // Original sender's debit row id — used to pair rows in the UI
  external_ref: string | null;
}

export interface TipsPage {
  rows: TipEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalSentCents: number;
  totalReceivedCents: number;
  countSent: number;
  countReceived: number;
}

const listInput = z.object({
  direction: z.enum(["all", "sent", "received"]).default("all"),
  page: z.number().int().min(1).max(10_000).default(1),
  pageSize: z.number().int().min(5).max(100).default(20),
});

const sendInput = z.object({
  recipientUserId: z.string().uuid(),
  amountCents: z.number().int().min(TIP_MIN_CENTS).max(TIP_MAX_CENTS),
  memo: z.string().trim().max(200).optional(),
  loungeId: z.string().uuid().optional(),
  chatMessageId: z.string().uuid().optional(),
  directMessageId: z.string().uuid().optional(),
  matchId: z.string().uuid().optional(),
});


type RawRow = {
  id: string;
  user_id: string;
  type: string;
  amount_cents: number;
  memo: string | null;
  external_ref: string | null;
  recipient_user_id: string | null;
  lounge_id: string | null;
  chat_message_id: string | null;
  direct_message_id: string | null;
  created_at: string;
};

export const listTips = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => listInput.parse(d ?? {}))
  .handler(async ({ data, context }): Promise<TipsPage> => {
    const { supabase, userId } = context;

    // Base query — sent (own debit_tip rows) OR received (credit rows where
    // recipient_user_id = me AND external_ref LIKE 'tip:%').
    // We use two parallel queries and merge, because a single OR on different
    // tables/conditions is awkward with PostgREST and paginated counts.
    const wantSent = data.direction === "all" || data.direction === "sent";
    const wantReceived = data.direction === "all" || data.direction === "received";

    const cols =
      "id, user_id, type, amount_cents, memo, external_ref, recipient_user_id, lounge_id, chat_message_id, direct_message_id, created_at";

    const [sentRes, recvRes, aggSentRes, aggRecvRes] = await Promise.all([
      wantSent
        ? supabase
            .from("wallet_transactions")
            .select(cols, { count: "exact" })
            .eq("user_id", userId)
            .eq("type", "debit_tip")
            .order("created_at", { ascending: false })
            .limit(500)
        : Promise.resolve({ data: [] as RawRow[], count: 0, error: null }),
      wantReceived
        ? supabase
            .from("wallet_transactions")
            .select(cols, { count: "exact" })
            .eq("recipient_user_id", userId)
            .eq("type", "credit")
            .like("external_ref", "tip:%")
            .order("created_at", { ascending: false })
            .limit(500)
        : Promise.resolve({ data: [] as RawRow[], count: 0, error: null }),
      supabase
        .from("wallet_transactions")
        .select("amount_cents", { count: "exact" })
        .eq("user_id", userId)
        .eq("type", "debit_tip"),
      supabase
        .from("wallet_transactions")
        .select("amount_cents", { count: "exact" })
        .eq("recipient_user_id", userId)
        .eq("type", "credit")
        .like("external_ref", "tip:%"),
    ]);

    for (const r of [sentRes, recvRes, aggSentRes, aggRecvRes]) {
      if ("error" in r && r.error) throw new Error(r.error.message);
    }

    const sentRows = (sentRes.data ?? []) as RawRow[];
    const recvRows = (recvRes.data ?? []) as RawRow[];

    // Collect counterparties (recipient for sent, sender=user_id for received)
    const counterpartyIds = new Set<string>();
    for (const r of sentRows) if (r.recipient_user_id) counterpartyIds.add(r.recipient_user_id);
    for (const r of recvRows) counterpartyIds.add(r.user_id);

    // Lounges
    const loungeIds = new Set<string>();
    for (const r of [...sentRows, ...recvRows]) if (r.lounge_id) loungeIds.add(r.lounge_id);

    const [profilesRes, loungesRes] = await Promise.all([
      counterpartyIds.size
        ? supabase
            .from("profiles")
            .select("id, display_name, avatar_url")
            .in("id", Array.from(counterpartyIds))
        : Promise.resolve({ data: [], error: null }),
      loungeIds.size
        ? supabase.from("lounges").select("id, slug, name").in("id", Array.from(loungeIds))
        : Promise.resolve({ data: [], error: null }),
    ]);
    if ("error" in profilesRes && profilesRes.error) throw new Error(profilesRes.error.message);
    if ("error" in loungesRes && loungesRes.error) throw new Error(loungesRes.error.message);

    const profileMap = new Map<string, { id: string; display_name: string | null; avatar_url: string | null }>();
    for (const p of (profilesRes.data ?? []) as Array<{ id: string; display_name: string | null; avatar_url: string | null }>) {
      profileMap.set(p.id, p);
    }
    const loungeMap = new Map<string, { id: string; slug: string; name: string }>();
    for (const l of (loungesRes.data ?? []) as Array<{ id: string; slug: string; name: string }>) {
      loungeMap.set(l.id, l);
    }

    const toEntry = (r: RawRow, direction: TipDirection): TipEntry => {
      const cpId = direction === "sent" ? r.recipient_user_id : r.user_id;
      return {
        id: r.id,
        direction,
        amount_cents: r.amount_cents,
        memo: r.memo,
        created_at: r.created_at,
        counterparty: cpId ? profileMap.get(cpId) ?? { id: cpId, display_name: null, avatar_url: null } : null,
        lounge: r.lounge_id ? loungeMap.get(r.lounge_id) ?? null : null,
        chat_message_id: r.chat_message_id,
        direct_message_id: r.direct_message_id,
        external_ref: r.external_ref,
      };
    };

    const merged: TipEntry[] = [
      ...sentRows.map((r) => toEntry(r, "sent")),
      ...recvRows.map((r) => toEntry(r, "received")),
    ].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

    const total = merged.length;
    const from = (data.page - 1) * data.pageSize;
    const rows = merged.slice(from, from + data.pageSize);

    const totalSentCents = ((aggSentRes.data ?? []) as Array<{ amount_cents: number }>).reduce(
      (s, r) => s + r.amount_cents,
      0,
    );
    const totalReceivedCents = ((aggRecvRes.data ?? []) as Array<{ amount_cents: number }>).reduce(
      (s, r) => s + r.amount_cents,
      0,
    );

    return {
      rows,
      total,
      page: data.page,
      pageSize: data.pageSize,
      totalSentCents,
      totalReceivedCents,
      countSent: aggSentRes.count ?? 0,
      countReceived: aggRecvRes.count ?? 0,
    };
  });

export const sendTip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => sendInput.parse(d))
  .handler(async ({ data, context }): Promise<{ debitId: string; creditId: string }> => {
    const { supabase, userId } = context;
    if (data.recipientUserId === userId) throw new Error("You cannot tip yourself");

    // Server-side validation: if this tip is tied to a match, the match must
    // exist and its owner (host) must be the declared recipient. This prevents
    // clients from crafting a tip with a mismatched match_id / recipient pair.
    if (data.matchId) {
      const { data: match, error: matchErr } = await supabase
        .from("matches")
        .select("id, owner_id")
        .eq("id", data.matchId)
        .maybeSingle();
      if (matchErr) throw new Error(matchErr.message);
      if (!match) throw new Error("Match not found");
      if (!match.owner_id) throw new Error("This match has no host to tip");
      if (match.owner_id !== data.recipientUserId) {
        throw new Error("Recipient does not match the host of this match");
      }
    }

    // Similarly, if a chat message is referenced, ensure it belongs to the
    // provided match (when both are supplied) so the tip is anchored correctly.
    if (data.matchId && data.chatMessageId) {
      const { data: msg, error: msgErr } = await supabase
        .from("chat_messages")
        .select("id, match_id, user_id")
        .eq("id", data.chatMessageId)
        .maybeSingle();
      if (msgErr) throw new Error(msgErr.message);
      if (!msg) throw new Error("Chat message not found");
      if (msg.match_id && msg.match_id !== data.matchId) {
        throw new Error("Chat message does not belong to this match");
      }
    }

    const { data: rows, error } = await supabase.rpc("send_tip", {
      _recipient_user_id: data.recipientUserId,
      _amount_cents: data.amountCents,
      _memo: data.memo ?? undefined,
      _lounge_id: data.loungeId ?? undefined,
      _chat_message_id: data.chatMessageId ?? undefined,
      _direct_message_id: data.directMessageId ?? undefined,
      _match_id: data.matchId ?? undefined,
    });


    if (error) throw new Error(error.message);
    const row = Array.isArray(rows) ? rows[0] : rows;
    return { debitId: row?.debit_id as string, creditId: row?.credit_id as string };
  });
