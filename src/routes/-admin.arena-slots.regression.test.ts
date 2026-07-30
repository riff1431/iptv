import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const route = readFileSync(resolve(__dirname, "admin.arena.tsx"), "utf8");
const adminShell = readFileSync(resolve(__dirname, "admin.tsx"), "utf8");
const dashboard = readFileSync(
  resolve(__dirname, "../components/admin/AdminDashboard.tsx"),
  "utf8",
);

describe("retired Admin Arena editor", () => {
  it("redirects legacy Arena URLs to Lounge management", () => {
    expect(route).toMatch(/throw redirect\(\{ to: ["']\/admin\/lounges["'] \}\)/);
    expect(route).not.toMatch(/listMatchesAdmin|upsertMatch|deleteMatch|TabsContent/);
  });

  it("does not expose Arena management in the admin navigation or dashboard", () => {
    expect(adminShell).not.toMatch(/to: ["']\/admin\/arena["']/);
    expect(adminShell).not.toMatch(/label: ["']Arena["']/);
    expect(dashboard).not.toMatch(/to=["']\/admin\/arena["']/);
    expect(dashboard).not.toMatch(/Manage Arena/);
  });
});
