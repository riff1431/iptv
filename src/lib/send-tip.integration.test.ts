/**
 * Integration tests for the `send_tip` database function.
 *
 * These hit the real Postgres database via the managed PG* env vars and
 * exercise the full RPC: wallet_transactions rows, host balance updates,
 * per-match tagging, and the server-side validation added on top.
 *
 * Every test runs inside a transaction that is ROLLED BACK, so no state
 * leaks into the database. Skipped automatically if PGHOST is not set.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

const hasDb = Boolean(process.env.PGHOST);
const d = hasDb ? describe : describe.skip;

// Three seeded demo users always present in this project.
const USER_A = "27791e4f-1e65-4e83-9be8-4e4b9e021d8b"; // Admin Demo (host)
const USER_B = "6e310a16-8532-4a89-bc16-bcc4b78d2934"; // User Demo (sender 1)
const USER_C = "418553a4-3723-4721-a868-7918c01552fb"; // Moderator (sender 2)

let client: Client;

async function asUser(userId: string) {
  // Emulate a Supabase-authenticated session so auth.uid() inside the
  // SECURITY DEFINER function returns this user.
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

async function balance(userId: string): Promise<number> {
  const { rows } = await client.query(
    `SELECT public.wallet_balance_cents($1)::int AS b`,
    [userId],
  );
  return rows[0].b;
}

async function createMatch(ownerId: string | null): Promise<string> {
  const { rows } = await client.query(
    `INSERT INTO public.matches (owner_id, title, status)
     VALUES ($1, 'Integration Test Match', 'scheduled')
     RETURNING id`,
    [ownerId],
  );
  return rows[0].id;
}

async function sendTip(params: {
  recipient: string;
  amount: number;
  matchId?: string | null;
  memo?: string | null;
}): Promise<{ debit_id: string; credit_id: string }> {
  const { rows } = await client.query(
    `SELECT * FROM public.send_tip($1, $2, $3, NULL, NULL, NULL, $4)`,
    [params.recipient, params.amount, params.memo ?? null, params.matchId ?? null],
  );
  return rows[0];
}

// Runs `fn` inside a SAVEPOINT so an expected error (e.g. RAISE EXCEPTION
// from the RPC) doesn't poison the outer BEGIN/ROLLBACK transaction.
async function expectRpcError(fn: () => Promise<unknown>, pattern: RegExp) {
  await client.query("SAVEPOINT sp");
  let caught: unknown;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  await client.query("ROLLBACK TO SAVEPOINT sp");
  await client.query("RELEASE SAVEPOINT sp");
  expect(caught, "expected RPC to throw").toBeDefined();
  expect(String((caught as Error).message)).toMatch(pattern);
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

d("send_tip integration", () => {
  // Every test wraps its work in BEGIN / ROLLBACK so the database is left clean.
  const withRollback = async (fn: () => Promise<void>) => {
    await client.query("BEGIN");
    try {
      await fn();
    } finally {
      await client.query("ROLLBACK");
    }
  };

  it("credits the host wallet and writes matched debit/credit rows for a match tip", async () => {
    await withRollback(async () => {
      const matchId = await createMatch(USER_A);
      await creditWallet(USER_B, 5000);

      const hostBefore = await balance(USER_A);
      const senderBefore = await balance(USER_B);

      await asUser(USER_B);
      const { debit_id, credit_id } = await sendTip({
        recipient: USER_A,
        amount: 1500,
        matchId,
        memo: "great host",
      });

      expect(debit_id).toBeTruthy();
      expect(credit_id).toBeTruthy();

      const { rows: pair } = await client.query(
        `SELECT id, user_id, type, amount_cents, match_id, recipient_user_id, external_ref, memo
           FROM public.wallet_transactions
          WHERE id IN ($1, $2)
          ORDER BY type`,
        [debit_id, credit_id],
      );
      expect(pair).toHaveLength(2);

      const credit = pair.find((r) => r.type === "credit")!;
      const debit = pair.find((r) => r.type === "debit_tip")!;

      // Debit: charged to sender, tagged with match + recipient
      expect(debit.user_id).toBe(USER_B);
      expect(debit.amount_cents).toBe(1500);
      expect(debit.match_id).toBe(matchId);
      expect(debit.recipient_user_id).toBe(USER_A);
      expect(debit.memo).toBe("great host");

      // Credit: paid to host, same match, external_ref links back to the debit
      expect(credit.user_id).toBe(USER_A);
      expect(credit.amount_cents).toBe(1500);
      expect(credit.match_id).toBe(matchId);
      expect(credit.external_ref).toBe(`tip:${debit.id}`);

      // Balances move by exactly the tip amount
      expect(await balance(USER_A)).toBe(hostBefore + 1500);
      expect(await balance(USER_B)).toBe(senderBefore - 1500);
    });
  });

  it("aggregates multiple tips from different senders into the host balance for one match", async () => {
    await withRollback(async () => {
      const matchId = await createMatch(USER_A);
      await creditWallet(USER_B, 10_000);
      await creditWallet(USER_C, 10_000);

      const hostBefore = await balance(USER_A);

      await asUser(USER_B);
      await sendTip({ recipient: USER_A, amount: 500, matchId });
      await sendTip({ recipient: USER_A, amount: 2500, matchId });

      await asUser(USER_C);
      await sendTip({ recipient: USER_A, amount: 1000, matchId });

      // Host wallet reflects the sum of all three tips
      expect(await balance(USER_A)).toBe(hostBefore + 4000);

      // Per-match aggregation matches the balance delta
      const { rows } = await client.query(
        `SELECT COALESCE(SUM(amount_cents), 0)::int AS total, COUNT(*)::int AS n
           FROM public.wallet_transactions
          WHERE match_id = $1 AND type = 'credit' AND recipient_user_id = $2
            AND external_ref LIKE 'tip:%'`,
        [matchId, USER_A],
      );
      expect(rows[0].total).toBe(4000);
      expect(rows[0].n).toBe(3);
    });
  });

  it("rejects a tip whose recipient is not the match host", async () => {
    await withRollback(async () => {
      const matchId = await createMatch(USER_A);
      await creditWallet(USER_B, 5000);

      await asUser(USER_B);
      await expectRpcError(
        () => sendTip({ recipient: USER_C, amount: 1000, matchId }),
        /Recipient does not match the host/i,
      );

      // No wallet_transactions rows were written for this match
      const { rows } = await client.query(
        `SELECT COUNT(*)::int AS n FROM public.wallet_transactions WHERE match_id = $1`,
        [matchId],
      );
      expect(rows[0].n).toBe(0);
    });
  });

  it("rejects a match-linked tip when the match has no host", async () => {
    await withRollback(async () => {
      const matchId = await createMatch(null);
      await creditWallet(USER_B, 5000);

      await asUser(USER_B);
      await expectRpcError(
        () => sendTip({ recipient: USER_A, amount: 1000, matchId }),
        /no host/i,
      );
    });
  });

  it("rejects tips below the minimum and self-tips", async () => {
    await withRollback(async () => {
      const matchId = await createMatch(USER_A);
      await creditWallet(USER_B, 5000);

      await asUser(USER_B);
      await expectRpcError(
        () => sendTip({ recipient: USER_A, amount: 50, matchId }),
        /Minimum tip/i,
      );

      await asUser(USER_A);
      await expectRpcError(
        () => sendTip({ recipient: USER_A, amount: 500, matchId }),
        /Invalid recipient/i,
      );

    });
  });

  it("rejects a tip when the sender has insufficient balance", async () => {
    await withRollback(async () => {
      const matchId = await createMatch(USER_A);
      // Zero out sender via a debit so their balance is definitely below the tip.
      const senderBal = await balance(USER_B);
      if (senderBal > 0) {
        // ensure < 100 cents remain
        await client.query(
          `INSERT INTO public.wallet_transactions (user_id, type, amount_cents, memo)
           VALUES ($1, 'debit_tip', $2, 'test drain')`,
          [USER_B, senderBal],
        );
      }

      await asUser(USER_B);
      await expectRpcError(
        () => sendTip({ recipient: USER_A, amount: 500, matchId }),
        /Insufficient balance/i,
      );
    });
  });
});
