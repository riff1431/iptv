import { describe, expect, it } from "vitest";

import { getIptvPlaybackErrorMessage, isIptvHlsUrl } from "./iptv-playback-error";

describe("IPTV playback URL classification", () => {
  it("recognizes the signed shared-relay playlist as HLS", () => {
    expect(
      isIptvHlsUrl("/api/public/iptv/channel/1537022/playlist?access=short-lived-signature"),
    ).toBe(true);
  });
});

describe("IPTV playback error messages", () => {
  it("shows actionable guidance for a provider connection-limit response", () => {
    expect(
      getIptvPlaybackErrorMessage({
        details: "manifestLoadError",
        type: "networkError",
        response: { code: 429 },
      }),
    ).toMatch(/connection limit reached/i);
  });

  it("keeps the generic manifest guidance for other upstream failures", () => {
    expect(
      getIptvPlaybackErrorMessage({
        details: "manifestLoadError",
        type: "networkError",
        response: { code: 502 },
      }),
    ).toContain("Cannot load stream playlist");
  });
});
