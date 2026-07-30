import { describe, expect, it } from "vitest";
import {
  getSelectedChannelSourceLabel,
  getTvConfigurationStatus,
} from "./tv-configuration-status";

describe("getTvConfigurationStatus", () => {
  it("uses the saved channel id instead of the stale legacy tv status", () => {
    expect(
      getTvConfigurationStatus({
        selected_channel_id: "1536582",
        enabled: true,
      }),
    ).toBe("configured");
  });

  it("distinguishes missing and disabled channel configurations", () => {
    expect(getTvConfigurationStatus({ selected_channel_id: null, enabled: true })).toBe(
      "unconfigured",
    );
    expect(getTvConfigurationStatus({ selected_channel_id: "324993", enabled: false })).toBe(
      "disabled",
    );
  });
});

describe("getSelectedChannelSourceLabel", () => {
  it("explains that Xtream URLs are derived server-side", () => {
    expect(
      getSelectedChannelSourceLabel({
        channelId: "324993",
        connectionType: "xtream",
        streamUrl: null,
      }),
    ).toBe("324993 · Xtream stream derived from provider");
  });

  it("identifies an explicit stream override", () => {
    expect(
      getSelectedChannelSourceLabel({
        channelId: "channel-1",
        connectionType: "hls",
        streamUrl: "https://example.com/live.m3u8",
      }),
    ).toBe("channel-1 · stream override ready");
  });
});