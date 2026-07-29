import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (relativePath: string) =>
  readFileSync(resolve(__dirname, "..", relativePath), "utf8");

describe("admin navigation resilience", () => {
  it("retries only transient admin guard failures with a bounded attempt count", () => {
    const guard = read("lib/admin-guard.ts");

    expect(guard).toMatch(/const ADMIN_GUARD_ATTEMPTS = 3/);
    expect(guard).toMatch(/retryTransient/);
    expect(guard).toMatch(/isTransientAdminGuardError/);
    expect(guard).toMatch(/failed to fetch\|network\|timeout/);
    expect(guard).not.toMatch(/forbidden.*isTransientAdminGuardError/i);
  });

  it("keeps authorization redirects while adding an admin-local recovery boundary", () => {
    const guard = read("lib/admin-guard.ts");
    const adminRoute = read("routes/admin.tsx");

    expect(guard).toMatch(/throw redirect\(\{ to: "\/auth"/);
    expect(guard).toMatch(/throw redirect\(\{ to: "\/forbidden"/);
    expect(adminRoute).toMatch(/errorComponent: AdminRouteError/);
    expect(adminRoute).toMatch(/data-testid="admin-route-error"/);
    expect(adminRoute).toMatch(/Retry admin check/);
  });
});

describe("admin TV route resilience", () => {
  it("renders local retry states for lounge and TV query failures", () => {
    const route = read("routes/admin.tvs.tsx");

    expect(route).toMatch(/loungesQuery\.isError/);
    expect(route).toMatch(/tvsQuery\.isError/);
    expect(route).toMatch(/data-testid="admin-tvs-query-error"/);
    expect(route).toMatch(/loungesQuery\.refetch\(\)/);
    expect(route).toMatch(/tvsQuery\.refetch\(\)/);
  });

  it("lazy-loads channel pickers and media previews", () => {
    const route = read("routes/admin.tvs.tsx");
    const streamControl = read("components/admin/StreamControl.tsx");

    expect(route).toMatch(/const LazyIptvChannelPicker = lazy/);
    expect(route).toMatch(/const LazyXtreamChannelPicker = lazy/);
    expect(route).toMatch(/const LazyStreamPreviewDialog = lazy/);
    expect(route).not.toMatch(
      /import \{ StreamPreviewDialog \} from "@\/components\/StreamPreviewDialog"/,
    );
    expect(streamControl).toMatch(/const LazyAdminTvPreviewDialog = lazy/);
  });

  it("does not throw while rendering a malformed optional start time", () => {
    const route = read("routes/admin.tvs.tsx");

    expect(route).toMatch(/Number\.isNaN\(date\.getTime\(\)\)/);
    expect(route).toMatch(/toDateTimeLocal\(form\.match_starts_at\)/);
  });
});
