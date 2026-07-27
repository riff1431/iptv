import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (relativePath: string) =>
  readFileSync(resolve(__dirname, "..", "..", "..", relativePath), "utf8");

describe("signed-in homepage data integrity", () => {
  const home = readSource("src/components/home/UserDashboardHome.tsx");

  it("does not ship the old fabricated dashboard metrics and schedules", () => {
    expect(home).not.toContain("1,248 Online");
    expect(home).not.toContain("4,250 pts");
    expect(home).not.toContain("Man United vs Chelsea");
    expect(home).not.toContain("CHAMPIONS LEAGUE FINAL");
    expect(home).not.toContain("Lakers vs Celtics");
  });

  it("persists match reminders instead of keeping them in component-only state", () => {
    expect(home).toContain('.from("match_reminders")');
    expect(home).not.toContain("notifiedEvents");
  });

  it("uses the canonical VIP query instead of auth metadata", () => {
    expect(home).toContain("useVipStatus");
    expect(home).not.toContain("user?.user_metadata?.is_vip");
  });
});

describe("VIP badge consistency", () => {
  it.each([
    "src/components/UserNav.tsx",
    "src/routes/dashboard.tsx",
    "src/components/home/UserDashboardHome.tsx",
  ])("%s reads the shared VIP status", (relativePath) => {
    expect(readSource(relativePath)).toContain("useVipStatus");
  });
});
