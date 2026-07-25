import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

type Handler = (e: string, data: unknown) => void;
interface MockHlsShape {
  handlers: Record<string, Handler[]>;
  loadSource: ReturnType<typeof vi.fn>;
  attachMedia: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

const { instances } = vi.hoisted(() => ({ instances: [] as MockHlsShape[] }));

vi.mock("hls.js", async () => {
  const { vi: vitest } = await import("vitest");
  const Events = {
    MANIFEST_PARSED: "hlsManifestParsed",
    LEVEL_SWITCHED: "hlsLevelSwitched",
    ERROR: "hlsError",
  };
  const ErrorTypes = { NETWORK_ERROR: "networkError", MEDIA_ERROR: "mediaError" };

  class MockHls implements MockHlsShape {
    handlers: Record<string, Handler[]> = {};
    loadSource = vitest.fn();
    attachMedia = vitest.fn();
    startLoad = vitest.fn();
    recoverMediaError = vitest.fn();
    destroy = vitest.fn();
    currentLevel = -1;
    constructor() {
      instances.push(this);
    }
    on(event: string, cb: Handler) {
      (this.handlers[event] ||= []).push(cb);
    }
  }

  const Ctor = MockHls as unknown as {
    new (...a: unknown[]): MockHls;
    isSupported: () => boolean;
    Events: typeof Events;
    ErrorTypes: typeof ErrorTypes;
  };
  Ctor.isSupported = () => true;
  Ctor.Events = Events;
  Ctor.ErrorTypes = ErrorTypes;
  return { default: Ctor };
});

vi.mock("@/lib/iptv-org", () => ({
  useIptvOrgCatalog: () => ({
    data: [
      {
        id: "ch-a",
        name: "Channel Alpha",
        logo: "",
        country: "US",
        categories: ["news"],
        alt_names: [],
        streamUrl: "https://example.com/alpha.m3u8",
        streamQuality: "720p",
      },
      {
        id: "ch-b",
        name: "Channel Beta",
        logo: "",
        country: "US",
        categories: ["sports"],
        alt_names: [],
        streamUrl: "https://example.com/beta.m3u8",
        streamQuality: "1080p",
      },
    ],
    isLoading: false,
    error: null,
  }),
}));

import { IptvChannelPicker } from "./IptvChannelPicker";

beforeEach(() => {
  instances.length = 0;
});
afterEach(cleanup);

describe("IptvChannelPicker preview integration", () => {
  it("clicking a channel updates the preview and tears down the previous stream", () => {
    render(
      <IptvChannelPicker open onOpenChange={() => {}} onPick={() => {}} />,
    );

    // Initial state: nothing selected.
    expect(screen.getByText(/Click a channel to preview it here/i)).toBeTruthy();
    expect(instances.length).toBe(0);

    // Click first channel → HlsPlayer mounts, loads alpha stream.
    fireEvent.click(screen.getByRole("button", { name: /Channel Alpha/i }));
    expect(instances.length).toBe(1);
    expect(instances[0].loadSource).toHaveBeenCalledWith(
      "https://example.com/alpha.m3u8",
    );
    expect(instances[0].destroy).not.toHaveBeenCalled();

    // Click second channel → previous instance destroyed, new one loads beta.
    fireEvent.click(screen.getByRole("button", { name: /Channel Beta/i }));
    expect(instances[0].destroy).toHaveBeenCalled();
    expect(instances.length).toBe(2);
    expect(instances[1].loadSource).toHaveBeenCalledWith(
      "https://example.com/beta.m3u8",
    );
  });
});
