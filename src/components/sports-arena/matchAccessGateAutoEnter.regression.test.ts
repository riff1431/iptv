/**
 * Regression: MatchAccessGate must
 *   1. auto-enter the free preview on mount when `autoEnter` is set, so the
 *      admin-configured tiles render immediately without a manual click.
 *   2. still enforce wallet gating — non-authorized viewers (signed-out, or
 *      preview expired without funds) must NOT see the children rendered.
 *
 * These are source-level assertions: they lock in the branching that makes
 * the gate safe. A silent refactor that drops the auto-enter effect or
 * loosens the gating branches will fail CI here, without needing a full
 * component-render harness that stubs Supabase + server functions.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const gate = read("src/components/sports-arena/MatchAccessGate.tsx");
const route = read("src/routes/arena.$matchId.tsx");

describe("MatchAccessGate autoEnter renders tiles immediately", () => {
  it("accepts an autoEnter prop with a boolean default of false", () => {
    expect(gate).toMatch(/autoEnter\?:\s*boolean/);
    expect(gate).toMatch(/autoEnter\s*=\s*false/);
  });

  it("arena.$matchId route opts in with <MatchAccessGate ... autoEnter>", () => {
    expect(route).toMatch(/<MatchAccessGate\s+matchId=\{match\.id\}\s+autoEnter\b/);
  });

  it("auto-enters exactly once per match via a ref latch", () => {
    // ref-based latch so React StrictMode / rerenders don't spam enter()
    expect(gate).toMatch(/autoEnterAttempted\s*=\s*useRef\(false\)/);
    expect(gate).toMatch(/autoEnterAttempted\.current\s*=\s*true/);
  });

  it("resets the auto-enter latch when matchId changes (navigating between matches)", () => {
    const resetEffect = gate.match(
      /useEffect\(\(\)\s*=>\s*\{\s*autoEnterAttempted\.current\s*=\s*false;?\s*\},\s*\[matchId\]\)/,
    );
    expect(resetEffect).not.toBeNull();
  });

  it("auto-enter effect calls enter({ data: { matchId } }) and sets access", () => {
    // The auto-enter effect body must actually invoke the server fn.
    const autoBlock = gate.slice(gate.indexOf("autoEnterAttempted.current = true"));
    expect(autoBlock).toMatch(/enter\(\{\s*data:\s*\{\s*matchId\s*\}\s*\}\)/);
    expect(autoBlock).toMatch(/setAccess\(a\)/);
  });

  it("auto-enter only fires for signed-in users who have no session yet", () => {
    // The guard clause must short-circuit when not authed, no access, or
    // an existing sessionId (already in preview or paid).
    expect(gate).toMatch(
      /if\s*\(\s*!autoEnter\s*\|\|\s*!authed\s*\|\|\s*!access\s*\|\|\s*autoEnterAttempted\.current\s*\)\s*return/,
    );
    expect(gate).toMatch(/if\s*\(access\.sessionId\)\s*return/);
  });
});

describe("MatchAccessGate still enforces wallet gating", () => {
  it("blocks signed-out users with a sign-in panel — children never render", () => {
    // authed === false branch renders GatePanel with Sign in CTA and returns
    // BEFORE the children(access) call site.
    const signedOutBranch = gate.slice(
      gate.indexOf("if (authed === false)"),
      gate.indexOf("if (error)"),
    );
    expect(signedOutBranch).toMatch(/Sign in to watch/);
    expect(signedOutBranch).toMatch(/to="\/auth"/);
    expect(signedOutBranch).not.toMatch(/children\(/);
  });

  it("does not fetch or auto-enter for signed-out users", () => {
    // refresh() bails when !authed, so access stays null and children never render.
    expect(gate).toMatch(/const refresh\s*=\s*useCallback\([\s\S]*?if\s*\(!authed\)\s*return/);
    // Auto-enter effect requires authed (see guard above), so no enter() call fires either.
  });

  it("renders the pay-to-stay panel (not children) when preview expires", () => {
    // previewExpired is derived from status === 'preview' && countdown <= 0.
    expect(gate).toMatch(
      /const previewExpired\s*=\s*[\s\S]*?access\.status\s*===\s*"preview"[\s\S]*?countdown\?\.seconds[\s\S]*?<=\s*0/,
    );
    // The JSX ternary must render the GatePanel branch first, and only fall
    // through to children(access) in the else branch.
    expect(gate).toMatch(/previewExpired\s*\?\s*\(\s*<GatePanel>/);
    expect(gate).toMatch(/:\s*\(?\s*children\(access\)\s*\)?/);
  });

  it("gates the Pay CTA on canAfford so under-funded viewers cannot bypass", () => {
    expect(gate).toMatch(/const canAfford\s*=\s*access\.walletBalanceCents\s*>=\s*access\.entryFeeCents/);
    // Both pay buttons (preview-strip and expired-panel) must be disabled when !canAfford.
    const disabledMatches = gate.match(/disabled=\{\s*busy\s*!==\s*null\s*\|\|\s*!canAfford\s*\}/g) ?? [];
    expect(disabledMatches.length).toBeGreaterThanOrEqual(2);
  });

  it("renders the join-the-match panel (not children) when no session exists yet", () => {
    // The !access.sessionId branch renders GatePanel and returns before children().
    const noSessionBranch = gate.slice(
      gate.indexOf("if (!access.sessionId)"),
      gate.indexOf("const previewExpired"),
    );
    expect(noSessionBranch).toMatch(/Join the match/);
    expect(noSessionBranch).not.toMatch(/children\(/);
  });
});
