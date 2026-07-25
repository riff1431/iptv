/**
 * Integration test: concurrent tips for the same match.
 *
 * Fires N `send_tip` RPC calls in parallel from multiple Postgres
 * connections (each with its own JWT claims + transaction), then asserts:
 *
 *  1. Every tip returned a matched debit_id / credit_id pair.
 *  2. `wallet_transactions` contains exactly N debit rows and N credit rows
 *     for the match, with amounts equal to what we sent.
 *  3. The host's `wallet_balance_cents(...)` increased by the exact total of
 *     all tips (no double-counting, no dropped rows under concurrency).
 *  4. Each sender's balance decreased by exactly the sum of their tips.
 *
 * Concurrency is real (separate connections + Promise.all), not simulated —
 * this is what catches races if `send_tip` ever regresses on locking or
 * balance calculation.
 *
 * Cleanup runs in a `finally` block so the DB stays clean even on failure.
 * Skipped automatically when PGHOST is unset.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

// This test mutates the real database and cannot BEGIN/ROLLBACK (writes are
// spread across multiple connections). It needs a privileged connection with
// DELETE (so hard cleanup works) and should only run against a dedicated
// test DB — opt-in via RUN_MUTATING_INTEGRATION_TESTS=1.
const hasDb = Boolean(process.env.PGHOST);
const optedIn = process.env.RUN_MUTATING_INTEGRATION_TESTS === "1";
const d = hasDb && optedIn ? describe : describe.skip;

// Seeded demo users (same as send-tip.integration.test.ts).
const USER_A = "27791e4f-1e65-4e83-9be8-4e4b9e021d8b"; // host
const USER_B = "6e310a16-8532-4a89-bc16-bcc4b78d2934"; // sender 1
const USER_C = "418553a4-3723-4721-a868-7918c01552fb"; // sender 2

const pgConfig = () => ({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  ssl: { rejectUnauthorized: false },
});

let admin: Client;

async function balanceOn(c: Client, userId: string): Promise<number> {
  const { rows } = await c.query(`SELECT public.wallet_balance_cents($1)::int AS b`, [userId]);
  return rows[0].b;
}

async function asUserOn(c: Client, userId: string) {
  await c.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
}

async function seedCreditOn(c: Client, userId: string, amountCents: number, tag: string) {
  await c.query(
    `INSERT INTO public.wallet_transactions (user_id, type, amount_cents, memo)
     VALUES ($1, 'credit', $2, $3)`,
    [userId, amountCents, tag],
  );
}

beforeAll(async () => {
  if (!hasDb) return;
  admin = new Client(pgConfig());
  await admin.connect();
}, 30_000);

afterAll(async () => {
  if (!hasDb) return;
  await admin?.end();
});

d("send_tip concurrent integration", () => {
  it("keeps wallet_transactions and host balance correct when tips run in parallel", async () => {
    // Distinct tip amounts per worker so a misattributed row is easy to spot.
    const tips: Array<{ sender: string; amount: number }> = [
      { sender: USER_B, amount: 100 },
      { sender: USER_C, amount: 250 },
      { sender: USER_B, amount: 175 },
      { sender: USER_C, amount: 300 },
      { sender: USER_B, amount: 425 },
      { sender: USER_C, amount: 150 },
      { sender: USER_B, amount: 200 },
      { sender: USER_C, amount: 100 },
    ];
    const N = tips.length;
    const totalCents = tips.reduce((s, t) => s + t.amount, 0);
    const senderTotals = new Map<string, number>();
    for (const t of tips) {
      senderTotals.set(t.sender, (senderTotals.get(t.sender) ?? 0) + t.amount);
    }

    const seedTag = `concurrent-tip-seed-${Date.now()}`;

    // Create the match on the admin connection (persistent — we clean up
    // manually in `finally`). Include a unique marker so any leftover rows
    // are easy to identify if cleanup were to fail.
    const { rows: matchRows } = await admin.query(
      `INSERT INTO public.matches (owner_id, title, status)
       VALUES ($1, $2, 'scheduled')
       RETURNING id`,
      [USER_A, `Concurrent Tip Test ${seedTag}`],
    );
    const matchId: string = matchRows[0].id;

    // Seed each sender with enough headroom to cover ALL their tips (via the
    // admin connection so senders start out solvent before parallel work).
    for (const [sender, total] of senderTotals) {
      await seedCreditOn(admin, sender, total + 10_000, seedTag);
    }

    const hostBefore = await balanceOn(admin, USER_A);
    const senderBefore = new Map<string, number>();
    for (const sender of senderTotals.keys()) {
      senderBefore.set(sender, await balanceOn(admin, sender));
    }

    // One dedicated pg Client per worker → real parallelism at the DB layer.
    const workers = tips.map(() => new Client(pgConfig()));

    try {
      await Promise.all(workers.map((w) => w.connect()));

      // Fire all send_tip calls in parallel, each in its own transaction.
      const results = await Promise.all(
        tips.map(async (t, i) => {
          const w = workers[i];
          await w.query("BEGIN");
          try {
            await asUserOn(w, t.sender);
            const { rows } = await w.query(
              `SELECT * FROM public.send_tip($1, $2, $3, NULL, NULL, NULL, $4)`,
              [USER_A, t.amount, `parallel #${i}`, matchId],
            );
            await w.query("COMMIT");
            return rows[0] as { debit_id: string; credit_id: string };
          } catch (err) {
            await w.query("ROLLBACK");
            throw err;
          }
        }),
      );

      // 1. Every call returned a valid debit + credit id.
      expect(results).toHaveLength(N);
      for (const r of results) {
        expect(r.debit_id).toBeTruthy();
        expect(r.credit_id).toBeTruthy();
      }
      const allIds = new Set(results.flatMap((r) => [r.debit_id, r.credit_id]));
      expect(allIds.size).toBe(N * 2); // No duplicated ids across concurrent calls

      // 2. wallet_transactions has exactly N debit + N credit rows for this
      //    match, and the amounts match what we sent.
      const { rows: matchRowsAll } = await admin.query(
        `SELECT type, amount_cents, user_id, recipient_user_id, external_ref
           FROM public.wallet_transactions
          WHERE match_id = $1
          ORDER BY created_at`,
        [matchId],
      );
      const debits = matchRowsAll.filter((r) => r.type === "debit_tip");
      const credits = matchRowsAll.filter((r) => r.type === "credit");
      expect(debits).toHaveLength(N);
      expect(credits).toHaveLength(N);

      const sumDebit = debits.reduce((s, r) => s + Number(r.amount_cents), 0);
      const sumCredit = credits.reduce((s, r) => s + Number(r.amount_cents), 0);
      expect(sumDebit).toBe(totalCents);
      expect(sumCredit).toBe(totalCents);

      // Every credit is paid to the host and pairs with a debit via external_ref.
      for (const c of credits) {
        expect(c.user_id).toBe(USER_A);
        expect(c.recipient_user_id).toBe(USER_A);
        expect(String(c.external_ref)).toMatch(/^tip:/);
      }
      const debitIds = new Set(debits.map((d) => d.recipient_user_id ? null : null)); // placate types
      void debitIds;
      const pairedDebitIds = new Set(
        credits.map((c) => String(c.external_ref).replace(/^tip:/, "")),
      );
      const actualDebitIds = new Set(results.map((r) => r.debit_id));
      expect(pairedDebitIds).toEqual(actualDebitIds);

      // 3. Host balance increased by exactly the total of all tips.
      expect(await balanceOn(admin, USER_A)).toBe(hostBefore + totalCents);

      // 4. Each sender's balance dropped by exactly the sum of their tips.
      for (const [sender, total] of senderTotals) {
        expect(await balanceOn(admin, sender)).toBe(senderBefore.get(sender)! - total);
      }
    } finally {
      // Best-effort cleanup — the shared DB role often lacks DELETE, so we
      // ALWAYS post compensating rows first to leave balances net-zero, then
      // attempt a hard cleanup (works when the connection is privileged).
      // `senderBefore` / `hostBefore` were captured AFTER seeding, so we only
      // need to undo the tip effects (not the seed credits) to restore them.
      for (const t of tips) {
        // Sender: had a debit_tip → add a credit to restore.
        await admin
          .query(
            `INSERT INTO public.wallet_transactions (user_id, type, amount_cents, memo)
             VALUES ($1, 'credit', $2, $3)`,
            [t.sender, t.amount, seedTag],
          )
          .catch(() => {});
        // Host: had a credit → add a debit to restore.
        await admin
          .query(
            `INSERT INTO public.wallet_transactions (user_id, type, amount_cents, memo)
             VALUES ($1, 'debit_tip', $2, $3)`,
            [USER_A, t.amount, seedTag],
          )
          .catch(() => {});
      }
      for (const t of tips) {
        // Sender: had a debit_tip → add a credit to restore.
        await admin
          .query(
            `INSERT INTO public.wallet_transactions (user_id, type, amount_cents, memo)
             VALUES ($1, 'credit', $2, $3)`,
            [t.sender, t.amount, seedTag],
          )
          .catch(() => {});
        // Host: had a credit → add a debit to restore.
        await admin
          .query(
            `INSERT INTO public.wallet_transactions (user_id, type, amount_cents, memo)
             VALUES ($1, 'debit_tip', $2, $3)`,
            [USER_A, t.amount, seedTag],
          )
          .catch(() => {});
      }
      // Balances should now match pre-test values.
      const hostAfterCleanup = await balanceOn(admin, USER_A);
      expect(hostAfterCleanup).toBe(hostBefore);
      for (const [sender, before] of senderBefore) {
        expect(await balanceOn(admin, sender)).toBe(before);
      }
      // Try hard cleanup last — silently ignored when the role lacks DELETE.
      await admin
        .query(`DELETE FROM public.wallet_transactions WHERE match_id = $1`, [matchId])
        .catch(() => {});
      await admin
        .query(`DELETE FROM public.wallet_transactions WHERE memo = $1`, [seedTag])
        .catch(() => {});
      await admin.query(`DELETE FROM public.matches WHERE id = $1`, [matchId]).catch(() => {});
      await Promise.all(
        workers.map(async (w) => {
          try {
            await w.end();
          } catch {
            /* ignore */
          }
        }),
      );
    }
  }, 60_000);
});
