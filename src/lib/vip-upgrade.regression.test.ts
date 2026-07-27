import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readProjectFile = (relativePath: string) =>
  readFileSync(resolve(__dirname, "..", "..", relativePath), "utf8");

describe("VIP membership upgrade safety", () => {
  const walletFunctions = readProjectFile("src/lib/wallet.functions.ts");
  const migration = readProjectFile("supabase/migrations/20260726183100_atomic_vip_membership.sql");

  it("delegates the upgrade to one database transaction", () => {
    const upgradeBlock = walletFunctions.slice(walletFunctions.indexOf("upgradeUserVip"));
    expect(upgradeBlock).toContain('.rpc("upgrade_user_vip"');
    expect(upgradeBlock).not.toContain('.from("wallet_transactions").insert');
  });

  it("serializes concurrent upgrades and returns an active membership without recharging", () => {
    expect(migration).toMatch(/FROM public\.profiles[\s\S]*FOR UPDATE/);
    const activeGuard = migration.indexOf("IF profile_row.is_vip");
    const debit = migration.indexOf("INSERT INTO public.wallet_transactions");
    expect(activeGuard).toBeGreaterThan(-1);
    expect(debit).toBeGreaterThan(activeGuard);
    expect(migration.slice(activeGuard, debit)).toMatch(
      /RETURN QUERY\s+SELECT true,\s*profile_row\.vip_expires_at,\s*false/s,
    );
  });

  it("stores a one-year expiry and uses a dedicated wallet transaction type", () => {
    expect(migration).toContain("interval '1 year'");
    expect(migration).toContain("'debit_vip_upgrade'");
    expect(migration).toContain("vip_expires_at = next_expiry");
  });

  it("keeps the RPC server-only", () => {
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.upgrade_user_vip(uuid) FROM authenticated",
    );
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.upgrade_user_vip(uuid) TO service_role",
    );
  });
});
