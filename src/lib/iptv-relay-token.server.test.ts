import { beforeAll, describe, expect, it } from "vitest";

import {
  openRelayUrl,
  sealRelayUrl,
  signRelayAccess,
  verifyRelayAccess,
} from "./iptv-relay-token.server";

beforeAll(() => {
  process.env.IPTV_PROXY_SIGNING_KEY = "relay-test-signing-key-with-enough-entropy";
});

describe("IPTV relay tokens", () => {
  it("encrypts upstream URLs and binds them to one channel scope", () => {
    const upstream = "http://provider.test/live/private-user/private-password/123.m3u8";
    const token = sealRelayUrl("global-xtream:123", upstream);

    expect(token).not.toContain("private-user");
    expect(token).not.toContain("private-password");
    expect(openRelayUrl("global-xtream:123", token)).toBe(upstream);
    expect(openRelayUrl("global-xtream:456", token)).toBeNull();
  });

  it("rejects expired encrypted resource tokens", () => {
    const token = sealRelayUrl("global-xtream:123", "https://provider.test/a.ts", -1);
    expect(openRelayUrl("global-xtream:123", token)).toBeNull();
  });

  it("signs short-lived playlist access without exposing provider credentials", () => {
    const access = signRelayAccess("global-xtream:123");
    expect(verifyRelayAccess("global-xtream:123", access)).toBe(true);
    expect(verifyRelayAccess("global-xtream:456", access)).toBe(false);
  });
});
