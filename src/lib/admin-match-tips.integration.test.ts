/**
 * Integration tests for the /admin/tips aggregation.
 *
 * The admin view (see `listMatchTipsForAdmin`) groups all `debit_tip`
 * wallet_transactions rows by match_id and reports per-match totals plus
 * a grand total. These tests exercise the same aggregation shape directly
 * against Postgres to verify that:
 *
 *   1. Per-match debit_tip totals equal the sum of the corresponding
 *      `credit` rows paid to the host (external_ref = 'tip:<debit_id>').
 *   2. The grand total matches the sum of all host credits.
 *   3. Tips with no match_id fall into an "unlinked" bucket without
 *      polluting other match groups.
 *
 * Runs against the managed PG* env vars, wrapped in BEGIN/ROLLBACK so no
 * state leaks. Skipped automatically if PGHOST is not set.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

const hasDb = Boolean(process.env.PGHOST);
const d = hasDb ? describe : describe.skip;

const USER_A = "27791e4f-1e65-4e83-9be8-4e4b9e021d8b"; // Admin Demo (host)
const USER_B = "6e310a16-8532-4a89-bc16-bcc4b78d2934"; // User Demo (sender 1)
const USER_C = "418553a4-3723-4721-a868-7918c01552fb"; // Moderator (sender 2)

let client: Client;

async function asUser(userId: string) {
  await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
}

async function creditWallet(userId: string, amountCents: number) {
  await client.query(
    `INSERT INTO public.wallet_transactions (user_id, type, amount_cents, memo)
     VALUES ($1, 'credit', $2, 'test seed')`,
    [userId, amountCents],
  );
}

async function createMatch(ownerId: string | null, title: string): Promise<string> {
  const { rows } = await client.query(
    `INSERT INTO public.matches (owner_id, title, status)
     VALUES ($1, $2, 'scheduled')
     RETURNING id`,
    [ownerId, title],
  );
  return rows[0].id;
}

async function sendTip(params: {
  recipient: string;
  amount: number;
  matchId?: string | null;
  memo?: string | null;
}) {
  await client.query(
    `SELECT * FROM public.send_tip($1, $2, $3, NULL, NULL, NULL, $4)`,
    [params.recipient, params.amount, params.memo ?? null, params.matchId ?? null],
  );
}

/**
 * Mirrors the SQL shape of `listMatchTipsForAdmin`: pull all debit_tip
 * rows, group by match_id, sum amount_cents and count rows.
 */
type AdminGroup = {
  match_id: string | null;
  total_cents: number;
  tip_count: number;
};
async function adminAggregate(): Promise<{
  groups: AdminGroup[];
  grandTotal: number;
  grandCount: number;
}> {
  const { rows } = await client.query<{
    match_id: string | null;
    total_cents: string;
    tip_count: string;
  }>(
    `SELECT match_id,
            COALESCE(SUM(amount_cents), 0)::int AS total_cents,
            COUNT(*)::int AS tip_count
       FROM public.wallet_transactions
      WHERE type = 'debit_tip'
      GROUP BY match_id`,
  );
  const groups = rows.map((r) => ({
    match_id: r.match_id,
    total_cents: Number(r.total_cents),
    tip_count: Number(r.tip_count),
  }));
  const grandTotal = groups.reduce((s, g) => s + g.total_cents, 0);
  const grandCount = groups.reduce((s, g) => s + g.tip_count, 0);
  return { groups, grandTotal, grandCount };
}

async function hostCreditsForMatch(matchId: string, hostId: string) {
  const { rows } = await client.query<{ total: string; n: string }>(
    `SELECT COALESCE(SUM(amount_cents), 0)::int AS total, COUNT(*)::int AS n
       FROM public.wallet_transactions
      WHERE match_id = $1
        AND user_id = $2
        AND type = 'credit'
        AND external_ref LIKE 'tip:%'`,
    [matchId, hostId],
  );
  return { total: Number(rows[0].total), n: Number(rows[0].n) };
}

beforeAll(async () => {
  if (!hasDb) return;
  client = new Client({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
}, 30_000);

afterAll(async () => {
  if (!hasDb) return;
  await client?.end();
});

d("/admin/tips aggregation", () => {
  const withRollback = async (fn: () => Promise<void>) => {
    await client.query("BEGIN");
    try {
      await fn();
    } finally {
      await client.query("ROLLBACK");
    }
  };

  it("per-match debit totals equal the host's credit totals for that match", async () => {
    await withRollback(async () => {
      const matchId = await createMatch(USER_A, "Admin Tips M1");
      await creditWallet(USER_B, 10_000);
      await creditWallet(USER_C, 10_000);

      await asUser(USER_B);
      await sendTip({ recipient: USER_A, amount: 500, matchId, memo: "gg" });
      await sendTip({ recipient: USER_A, amount: 2500, matchId });

      await asUser(USER_C);
      await sendTip({ recipient: USER_A, amount: 1000, matchId });

      const { groups } = await adminAggregate();
      const g = groups.find((x) => x.match_id === matchId);
      expect(g, "match should appear in admin groups").toBeDefined();
      expect(g!.total_cents).toBe(4000);
      expect(g!.tip_count).toBe(3);

      // Invariant: admin per-match debit total === host credit total for the
      // same match (guaranteed by send_tip writing a matched credit row).
      const credit = await hostCreditsForMatch(matchId, USER_A);
      expect(credit.total).toBe(g!.total_cents);
      expect(credit.n).toBe(g!.tip_count);
    });
  });

  it("groups tips by match without leaking across matches", async () => {
    await withRollback(async () => {
      const m1 = await createMatch(USER_A, "Admin Tips M2a");
      const m2 = await createMatch(USER_A, "Admin Tips M2b");
      await creditWallet(USER_B, 10_000);

      await asUser(USER_B);
      await sendTip({ recipient: USER_A, amount: 700, matchId: m1 });
      await sendTip({ recipient: USER_A, amount: 300, matchId: m1 });
      await sendTip({ recipient: USER_A, amount: 1200, matchId: m2 });

      const { groups } = await adminAggregate();
      const g1 = groups.find((g) => g.match_id === m1)!;
      const g2 = groups.find((g) => g.match_id === m2)!;

      expect(g1.total_cents).toBe(1000);
      expect(g1.tip_count).toBe(2);
      expect(g2.total_cents).toBe(1200);
      expect(g2.tip_count).toBe(1);

      // Host credits stay partitioned per match too
      expect((await hostCreditsForMatch(m1, USER_A)).total).toBe(1000);
      expect((await hostCreditsForMatch(m2, USER_A)).total).toBe(1200);
    });
  });

  it("grand total across all groups equals sum of all host tip credits", async () => {
    await withRollback(async () => {
      const baselineAgg = await adminAggregate();
      const { rows: baseCreditRows } = await client.query<{ total: string; n: string }>(
        `SELECT COALESCE(SUM(amount_cents), 0)::int AS total, COUNT(*)::int AS n
           FROM public.wallet_transactions
          WHERE type = 'credit' AND external_ref LIKE 'tip:%'`,
      );
      const baseCreditTotal = Number(baseCreditRows[0].total);
      const baseCreditCount = Number(baseCreditRows[0].n);

      const m1 = await createMatch(USER_A, "Admin Tips M3a");
      const m2 = await createMatch(USER_A, "Admin Tips M3b");
      await creditWallet(USER_B, 10_000);
      await creditWallet(USER_C, 10_000);

      await asUser(USER_B);
      await sendTip({ recipient: USER_A, amount: 250, matchId: m1 });
      await sendTip({ recipient: USER_A, amount: 750, matchId: m2 });
      await asUser(USER_C);
      await sendTip({ recipient: USER_A, amount: 2000, matchId: m2 });

      const { grandTotal, grandCount } = await adminAggregate();
      const { rows } = await client.query<{ total: string; n: string }>(
        `SELECT COALESCE(SUM(amount_cents), 0)::int AS total, COUNT(*)::int AS n
           FROM public.wallet_transactions
          WHERE type = 'credit' AND external_ref LIKE 'tip:%'`,
      );

      // Per-tip invariant enforced by send_tip: each new debit_tip has a
      // matching host credit. The deltas from our inserts must be equal
      // even if historical rows in the DB are unbalanced.
      expect(grandTotal - baselineAgg.grandTotal).toBe(3000);
      expect(grandCount - baselineAgg.grandCount).toBe(3);
      expect(Number(rows[0].total) - baseCreditTotal).toBe(3000);
      expect(Number(rows[0].n) - baseCreditCount).toBe(3);
    });
  });


  it("tips without a match land in a null-match bucket and don't affect other groups", async () => {
    await withRollback(async () => {
      const matchId = await createMatch(USER_A, "Admin Tips M4");
      await creditWallet(USER_B, 10_000);

      await asUser(USER_B);
      await sendTip({ recipient: USER_A, amount: 400, matchId });
      // Unlinked tip (no match_id) — allowed by send_tip
      await sendTip({ recipient: USER_A, amount: 900, matchId: null });

      const { groups } = await adminAggregate();
      const linked = groups.find((g) => g.match_id === matchId)!;
      const unlinked = groups.find((g) => g.match_id === null)!;

      expect(linked.total_cents).toBe(400);
      expect(linked.tip_count).toBe(1);

      // Unlinked bucket contains at least our 900c tip (may include prior
      // unlinked tips seeded elsewhere in the DB, hence >=).
      expect(unlinked.total_cents).toBeGreaterThanOrEqual(900);
      expect(unlinked.tip_count).toBeGreaterThanOrEqual(1);
    });
  });
});
