import { describe, expect, it } from "vitest";

import { getIptvPlaybackErrorMessage } from "./iptv-playback-error";

describe("IPTV playback error messages", () => {
  it("shows actionable guidance for a provider connection-limit response", () => {
    expect(
      getIptvPlaybackErrorMessage({
        details: "manifestLoadError",
        type: "networkError",
        response: { code: 429 },
      }),
    ).toContain("connection limit reached");
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
