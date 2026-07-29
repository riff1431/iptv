import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const route = readFileSync(resolve(__dirname, "admin.arena.tsx"), "utf8");

describe("Admin Arena new-match channel slot navigation", () => {
  it("keeps the Channel slots tab clickable before the match has an ID", () => {
    expect(route).not.toMatch(/disabled=\{s === ["']slots["'] && !savedId\}/);
    expect(route).toMatch(/<TabsContent value=["']slots["']/);
  });

  it("offers to create the parent match from the unsaved slot state", () => {
    expect(route).toMatch(/Create match and continue/);
    expect(route).toMatch(/onClick=\{\(\) => save\.mutate\(undefined\)\}/);
    expect(route).toMatch(/Channel slots need a saved match ID/);
  });
});
