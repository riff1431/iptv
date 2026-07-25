import { createServerFn } from "@tanstack/react-start";
import { requireAdminServer } from "@/lib/admin-guard";

export type LedgerDirection = "debit_tip" | "credit";

export interface AdminLedgerEntry {
  id: string;
  createdAt: string;
  direction: LedgerDirection;
  amountCents: number;
  memo: string | null;
  externalRef: string | null;
  // On a debit_tip row this is the sender's wallet; on the paired credit row
  // this is the recipient's wallet (same person as `recipientUserId`).
  walletUserId: string;
  walletUserName: string | null;
  senderUserId: string; // always the original sender (debit.user_id)
  senderName: string | null;
  senderAvatarUrl: string | null;
  recipientUserId: string | null;
  recipientName: string | null;
}

export interface AdminLedgerGroup {
  matchId: string | null;
  matchTitle: string;
  hostUserId: string | null;
  hostName: string | null;
  tipCount: number;
  totalCents: number;
  entries: AdminLedgerEntry[];
}

export interface AdminLedgerResult {
  groups: AdminLedgerGroup[];
  grandTotalCents: number;
  grandTipCount: number;
  grandRowCount: number;
}

type TxRow = {
  id: string;
  user_id: string;
  recipient_user_id: string | null;
  type: string;
  amount_cents: number;
  memo: string | null;
  external_ref: string | null;
  match_id: string | null;
  created_at: string;
};

/**
 * Admin wallet ledger — every wallet_transactions row related to a tip
 * (both the sender's debit_tip and the host's matching credit), grouped by
 * matchId. Debit and credit rows are paired via `external_ref = 'tip:{debitId}'`.
 */
export const listWalletLedgerForAdmin = createServerFn({ method: "GET" })
  .middleware([requireAdminServer])
  .handler(async ({ context }): Promise<AdminLedgerResult> => {
    const { supabase } = context;

    // Debit legs (one per tip; senderId = user_id, memo lives here).
    const { data: debitsRaw, error: debitErr } = await supabase
      .from("wallet_transactions")
      .select(
        "id, user_id, recipient_user_id, type, amount_cents, memo, external_ref, match_id, created_at",
      )
      .eq("type", "debit_tip")
      .order("created_at", { ascending: false })
      .limit(1000);
    if (debitErr) throw new Error(debitErr.message);
    const debits = (debitsRaw ?? []) as TxRow[];

    // Matching credit legs, linked back via external_ref = "tip:{debitId}".
    const debitIds = debits.map((d) => d.id);
    let credits: TxRow[] = [];
    if (debitIds.length) {
      const refs = debitIds.map((id) => `tip:${id}`);
      const { data: creditsRaw, error: creditErr } = await supabase
        .from("wallet_transactions")
        .select(
          "id, user_id, recipient_user_id, type, amount_cents, memo, external_ref, match_id, created_at",
        )
        .eq("type", "credit")
        .in("external_ref", refs);
      if (creditErr) throw new Error(creditErr.message);
      credits = (creditsRaw ?? []) as TxRow[];
    }

    // Collect profiles and matches to hydrate names.
    const userIds = new Set<string>();
    const matchIds = new Set<string>();
    for (const r of [...debits, ...credits]) {
      userIds.add(r.user_id);
      if (r.recipient_user_id) userIds.add(r.recipient_user_id);
      if (r.match_id) matchIds.add(r.match_id);
    }

    const [profRes, matchRes] = await Promise.all([
      userIds.size
        ? supabase
            .from("profiles")
            .select("id, display_name, avatar_url")
            .in("id", Array.from(userIds))
        : Promise.resolve({ data: [], error: null }),
      matchIds.size
        ? supabase
            .from("matches")
            .select("id, title, owner_id")
            .in("id", Array.from(matchIds))
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
    for (const m of (matchRes.data ?? []) as Array<{
      id: string;
      title: string | null;
      owner_id: string | null;
    }>) {
      matchMap.set(m.id, { title: m.title, owner_id: m.owner_id });
    }

    // Map credit rows by their debit id so we can carry sender/memo across.
    const creditsByDebit = new Map<string, TxRow>();
    for (const c of credits) {
      const ref = c.external_ref ?? "";
      if (ref.startsWith("tip:")) creditsByDebit.set(ref.slice(4), c);
    }

    const nameOf = (id: string | null) =>
      id ? profileMap.get(id)?.display_name ?? null : null;

    const toEntry = (
      row: TxRow,
      direction: LedgerDirection,
      senderId: string,
      memo: string | null,
    ): AdminLedgerEntry => {
      const senderProf = profileMap.get(senderId);
      return {
        id: row.id,
        createdAt: row.created_at,
        direction,
        amountCents: row.amount_cents,
        memo,
        externalRef: row.external_ref,
        walletUserId: row.user_id,
        walletUserName: nameOf(row.user_id),
        senderUserId: senderId,
        senderName: senderProf?.display_name ?? null,
        senderAvatarUrl: senderProf?.avatar_url ?? null,
        recipientUserId: row.recipient_user_id,
        recipientName: nameOf(row.recipient_user_id),
      };
    };

    const groups = new Map<string, AdminLedgerGroup>();
    const ensureGroup = (matchId: string | null, host?: string | null) => {
      const key = matchId ?? "__no_match__";
      let g = groups.get(key);
      if (!g) {
        const m = matchId ? matchMap.get(matchId) : undefined;
        const hostId = m?.owner_id ?? host ?? null;
        g = {
          matchId,
          matchTitle:
            m?.title?.trim() ||
            (matchId ? "Untitled match" : "Rows not linked to a match"),
          hostUserId: hostId,
          hostName: nameOf(hostId),
          tipCount: 0,
          totalCents: 0,
          entries: [],
        };
        groups.set(key, g);
      }
      return g;
    };

    for (const d of debits) {
      const g = ensureGroup(d.match_id, d.recipient_user_id);
      g.tipCount += 1;
      g.totalCents += d.amount_cents;
      g.entries.push(toEntry(d, "debit_tip", d.user_id, d.memo));
      const credit = creditsByDebit.get(d.id);
      if (credit) {
        // Sender + memo come from the debit; credit row inherits them for display.
        g.entries.push(toEntry(credit, "credit", d.user_id, d.memo));
      }
    }

    // Order entries in each group newest-first, then group by size.
    for (const g of groups.values()) {
      g.entries.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    }
    const groupList = Array.from(groups.values()).sort(
      (a, b) => b.totalCents - a.totalCents,
    );

    return {
      groups: groupList,
      grandTotalCents: groupList.reduce((s, g) => s + g.totalCents, 0),
      grandTipCount: groupList.reduce((s, g) => s + g.tipCount, 0),
      grandRowCount: groupList.reduce((s, g) => s + g.entries.length, 0),
    };
  });
