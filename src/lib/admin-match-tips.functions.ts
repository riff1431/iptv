import { createServerFn } from "@tanstack/react-start";
import { requireAdminServer } from "@/lib/admin-guard";

export interface AdminMatchTipEntry {
  id: string;
  createdAt: string;
  amountCents: number;
  memo: string | null;
  senderId: string;
  senderName: string | null;
  senderAvatarUrl: string | null;
}

export interface AdminMatchTipsGroup {
  matchId: string | null;
  matchTitle: string;
  hostUserId: string | null;
  hostName: string | null;
  totalCents: number;
  tipCount: number;
  tips: AdminMatchTipEntry[];
}

export interface AdminMatchTipsResult {
  groups: AdminMatchTipsGroup[];
  grandTotalCents: number;
  grandTipCount: number;
}

type TxRow = {
  id: string;
  user_id: string;
  recipient_user_id: string | null;
  amount_cents: number;
  memo: string | null;
  match_id: string | null;
  created_at: string;
};

/**
 * Admin overview of every tip that has flowed through a match. Groups by match,
 * shows per-match totals and individual senders. Only accessible to admins.
 */
export const listMatchTipsForAdmin = createServerFn({ method: "GET" })
  .middleware([requireAdminServer])
  .handler(async ({ context }): Promise<AdminMatchTipsResult> => {
    const { supabase } = context;

    const { data: txsRaw, error } = await supabase
      .from("wallet_transactions")
      .select("id, user_id, recipient_user_id, amount_cents, memo, match_id, created_at")
      .eq("type", "debit_tip")
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) throw new Error(error.message);
    const txs = (txsRaw ?? []) as TxRow[];

    const senderIds = Array.from(new Set(txs.map((t) => t.user_id)));
    const matchIds = Array.from(
      new Set(txs.map((t) => t.match_id).filter((v): v is string => Boolean(v))),
    );

    const [profRes, matchRes] = await Promise.all([
      senderIds.length
        ? supabase
            .from("profiles")
            .select("id, display_name, avatar_url")
            .in("id", senderIds)
        : Promise.resolve({ data: [], error: null }),
      matchIds.length
        ? supabase
            .from("matches")
            .select("id, title, owner_id")
            .in("id", matchIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if ("error" in profRes && profRes.error) throw new Error(profRes.error.message);
    if ("error" in matchRes && matchRes.error) throw new Error(matchRes.error.message);

    const profileMap = new Map<
      string,
      { display_name: string | null; avatar_url: string | null }
    >();
    for (const p of (profRes.data ?? []) as Array<{
      id: string;
      display_name: string | null;
      avatar_url: string | null;
    }>) {
      profileMap.set(p.id, { display_name: p.display_name, avatar_url: p.avatar_url });
    }

    const matchMap = new Map<
      string,
      { title: string | null; owner_id: string | null }
    >();
    const ownerIds = new Set<string>();
    for (const m of (matchRes.data ?? []) as Array<{
      id: string;
      title: string | null;
      owner_id: string | null;
    }>) {
      matchMap.set(m.id, { title: m.title, owner_id: m.owner_id });
      if (m.owner_id) ownerIds.add(m.owner_id);
    }

    // Fetch host display names in one round-trip (may overlap with senders).
    const hostIdsToFetch = Array.from(ownerIds).filter((id) => !profileMap.has(id));
    if (hostIdsToFetch.length) {
      const { data: hosts } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .in("id", hostIdsToFetch);
      for (const p of (hosts ?? []) as Array<{
        id: string;
        display_name: string | null;
        avatar_url: string | null;
      }>) {
        profileMap.set(p.id, { display_name: p.display_name, avatar_url: p.avatar_url });
      }
    }

    const groups = new Map<string, AdminMatchTipsGroup>();
    for (const t of txs) {
      const key = t.match_id ?? "__no_match__";
      let g = groups.get(key);
      if (!g) {
        const m = t.match_id ? matchMap.get(t.match_id) : undefined;
        const hostId = m?.owner_id ?? t.recipient_user_id ?? null;
        const hostProf = hostId ? profileMap.get(hostId) : undefined;
        g = {
          matchId: t.match_id,
          matchTitle: m?.title?.trim() || (t.match_id ? "Untitled match" : "Tips not linked to a match"),
          hostUserId: hostId,
          hostName: hostProf?.display_name ?? null,
          totalCents: 0,
          tipCount: 0,
          tips: [],
        };
        groups.set(key, g);
      }
      const senderProf = profileMap.get(t.user_id);
      g.totalCents += t.amount_cents;
      g.tipCount += 1;
      g.tips.push({
        id: t.id,
        createdAt: t.created_at,
        amountCents: t.amount_cents,
        memo: t.memo,
        senderId: t.user_id,
        senderName: senderProf?.display_name ?? null,
        senderAvatarUrl: senderProf?.avatar_url ?? null,
      });
    }

    const groupList = Array.from(groups.values()).sort(
      (a, b) => b.totalCents - a.totalCents,
    );
    const grandTotalCents = groupList.reduce((s, g) => s + g.totalCents, 0);
    const grandTipCount = groupList.reduce((s, g) => s + g.tipCount, 0);

    return { groups: groupList, grandTotalCents, grandTipCount };
  });
