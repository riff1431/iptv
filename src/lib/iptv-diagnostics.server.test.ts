// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { logIptvTiming, redactIptvText } from "./iptv-diagnostics.server";

describe("IPTV diagnostics redaction", () => {
  it("does not expose credentials, URLs, bearer values, or signing tokens", () => {
    const secret = "do-not-print-secret";
    const text = redactIptvText(
      `https://provider.test/live/user/${secret}/1.ts?token=${secret} Authorization=Bearer ${secret} cookie=${secret}`,
    );
    expect(text).not.toContain(secret);
    expect(text).not.toContain("/live/user/");
  });

  it("keeps structured failure logs credential-safe", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logIptvTiming({
      requestId: "safe-id",
      tvId: "tv-1",
      kind: "segment",
      upstreamHost: "provider.test",
      cache: "miss",
      startedAt: Date.now(),
      failureCategory: "network_error",
      message:
        "https://provider.test/live/alice/password/chunk.ts?s=signing-token Bearer auth-token",
    });
    const output = String(spy.mock.calls[0]?.[0]);
    expect(output).not.toContain("alice");
    expect(output).not.toContain("password/chunk");
    expect(output).not.toContain("signing-token");
    expect(output).not.toContain("auth-token");
    spy.mockRestore();
  });
});
