/**
 * Regression: when a user navigates between matches, the admin-only UI
 * (the "Configure IPTV provider" CTA) and the admin-only server functions
 * must never be reachable by a non-admin viewer — regardless of which
 * match they land on.
 *
 * The route-level guarantee is that `MatchWatchInner` gates the CTA
 * behind `isAdmin`, and every provider-config server function is guarded
 * by `.middleware([requireAdminServer])`. These source-level assertions
 * make a silent regression (e.g. dropping the isAdmin check while
 * refactoring the empty state, or removing the middleware from a handler)
 * fail loudly in CI.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (rel: string) => readFileSync(resolve(__dirname, "..", rel), "utf8");

describe("match admin-vs-user UI access (route source)", () => {
  const route = read("routes/arena.$matchId.tsx");

  it("gates the 'Configure IPTV provider' CTA behind isAdmin", () => {
    // The admin CTA branch reads noProviderConfigured and isAdmin.
    expect(route).toMatch(/noProviderConfigured/);
    expect(route).toMatch(/isAdmin/);
    // The link that points at the admin route must live inside those branches,
    // not in the shared render path.
    const noProviderIdx = route.indexOf("noProviderConfigured");
    const isAdminIdx = route.indexOf("isAdmin");
    const adminLinkIndex = route.indexOf('to="/admin/iptv-provider"');
    expect(noProviderIdx).toBeGreaterThan(-1);
    expect(isAdminIdx).toBeGreaterThan(-1);
    expect(adminLinkIndex).toBeGreaterThan(noProviderIdx);
    expect(adminLinkIndex).toBeGreaterThan(isAdminIdx);
  });

  it("does not render a second unguarded 'Configure IPTV provider' link", () => {
    const matches = route.match(/to="\/admin\/iptv-provider"/g) ?? [];
    // Exactly one occurrence — inside the isAdmin branch.
    expect(matches.length).toBe(1);
  });

  it("still renders the playlist/player for non-admins via MatchAccessGate", () => {
    // Non-admins fall through to the shared MatchAccessGate + MatchGrid path
    // (demo playlist fallback), not to a blocking admin screen.
    expect(route).toMatch(/<MatchAccessGate\s+matchId=\{match\.id\}/);
    expect(route).toMatch(/<MatchGrid\b/);
  });

  it("reads isAdmin from useAuth so the check is user-scoped, not hard-coded", () => {
    expect(route).toMatch(/useAuth\(\)/);
    expect(route).toMatch(/\bisAdmin\b/);
  });
  it("attaches signed relay URLs to matched Xtream channels before rendering tiles", () => {
    expect(route).toMatch(/getPublicIptvChannelPlaybacks/);
    expect(route).toMatch(/relayUrls\[channel\.id\]/);
    expect(route).toMatch(/channels=\{playbackChannels\}/);
    expect(route).toMatch(/loadingPlaylist=\{playbackLoading\}/);
  });
});

describe("match provider-config server functions require admin", () => {
  const providerFns = read("lib/iptv-provider.functions.ts");

  it("guards getIptvProviderAdmin with requireAdminServer", () => {
    expect(providerFns).toMatch(
      /getIptvProviderAdmin[\s\S]*?\.middleware\(\[requireAdminServer\]\)/,
    );
  });

  it("guards updateIptvProviderAdmin with requireAdminServer", () => {
    expect(providerFns).toMatch(
      /updateIptvProviderAdmin[\s\S]*?\.middleware\(\[requireAdminServer\]\)/,
    );
  });

  it("public provider read exposes no secrets and no admin fields", () => {
    // getPublicIptvProvider must NOT touch xtream_username / password / admin table.
    const start = providerFns.indexOf("getPublicIptvProvider");
    const end = providerFns.indexOf("export const", start + 1);
    const publicFn = providerFns.slice(start, end);
    expect(publicFn).not.toMatch(/xtream_username/);
    expect(publicFn).not.toMatch(/password/i);
    expect(publicFn).not.toMatch(/requireAdminServer/);
  });
});

describe("all admin server-function modules are guarded", () => {
  const adminModules = [
    "lib/iptv-provider.functions.ts",
    "lib/iptv-admin.functions.ts",
    "lib/iptv-ip-blocks.functions.ts",
    "lib/iptv-rejections.functions.ts",
    "lib/stream-admin.functions.ts",
    "lib/matches-admin.functions.ts",
    "lib/admin-settings.functions.ts",
    "lib/admin-audit-log.functions.ts",
  ];

  for (const rel of adminModules) {
    it(`${rel}: every createServerFn chains requireAdminServer`, () => {
      const src = read(rel);
      // Split on each createServerFn declaration; each block must contain a
      // `.middleware([requireAdminServer])` call before its `.handler(`.
      // Public read-only fns are explicitly allow-listed by name.
      const publicAllowlist = new Set(["getPublicIptvProvider"]);
      const authenticatedAllowlist = new Set([
        "getPublicIptvChannels",
        "getPublicIptvChannelPlayback",
        "getPublicIptvChannelPlaybacks",
        "refreshPublicIptvCatalog",
      ]);
      const decls = [...src.matchAll(/export const (\w+)\s*=\s*createServerFn\(/g)];
      expect(decls.length).toBeGreaterThan(0);
      for (let i = 0; i < decls.length; i++) {
        const name = decls[i][1];
        const start = decls[i].index ?? 0;
        const end = decls[i + 1]?.index ?? src.length;
        const block = src.slice(start, end);
        const handlerAt = block.indexOf(".handler(");
        expect(handlerAt).toBeGreaterThan(-1);
        const preHandler = block.slice(0, handlerAt);
        if (publicAllowlist.has(name)) {
          expect(preHandler).not.toMatch(/\.middleware\(/);
        } else if (authenticatedAllowlist.has(name)) {
          expect(preHandler).toMatch(/\.middleware\(\[requireSupabaseAuth\]\)/);
        } else {
          expect(preHandler).toMatch(/\.middleware\(\[requireAdminServer\]\)/);
        }
      }
    });
  }

  it("admin-users.functions.ts asserts admin role inside every handler", () => {
    const src = read("lib/admin-users.functions.ts");
    // Uses requireSupabaseAuth + an internal assertAdmin(context) helper.
    expect(src).toMatch(/requireSupabaseAuth/);
    expect(src).toMatch(/function\s+assertAdmin\s*\(/);
    // Every server-fn handler body must call assertAdmin(context).
    const handlerBodies = src.split(/\.handler\(/).slice(1);
    expect(handlerBodies.length).toBeGreaterThan(0);
    for (const body of handlerBodies) {
      // Only look at the first ~400 chars of each handler — enough to see the
      // guard call at the top of the body.
      expect(body.slice(0, 400)).toMatch(/assertAdmin\(\s*context\s*\)/);
    }
  });
});

describe("admin routes redirect non-admins via the parent /admin guard", () => {
  it("routes/admin.tsx gates the whole /admin subtree with requireAdminRoute in beforeLoad", () => {
    const src = read("routes/admin.tsx");
    expect(src).toMatch(/requireAdminRoute/);
    expect(src).toMatch(/beforeLoad/);
  });
});
