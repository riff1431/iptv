import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

type Handler = (event: string, data: unknown) => void;
type MockConfig = { xhrSetup?: (xhr: XMLHttpRequest) => void };

const { instances } = vi.hoisted(() => ({
  instances: [] as Array<{
    config: MockConfig;
    handlers: Record<string, Handler[]>;
    loadSource: ReturnType<typeof vi.fn>;
    attachMedia: ReturnType<typeof vi.fn>;
    startLoad: ReturnType<typeof vi.fn>;
    recoverMediaError: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    emit: (event: string, data?: unknown) => void;
  }>,
}));

vi.mock("hls.js", async () => {
  const { vi: vitest } = await import("vitest");
  const Events = { MANIFEST_PARSED: "manifest", FRAG_BUFFERED: "fragBuffered", ERROR: "error" };
  const ErrorTypes = { NETWORK_ERROR: "network", MEDIA_ERROR: "media" };

  class MockHls {
    handlers: Record<string, Handler[]> = {};
    loadSource = vitest.fn();
    attachMedia = vitest.fn();
    startLoad = vitest.fn();
    recoverMediaError = vitest.fn();
    destroy = vitest.fn();

    constructor(public config: MockConfig) {
      instances.push(this);
    }

    on(event: string, handler: Handler) {
      (this.handlers[event] ||= []).push(handler);
    }

    emit(event: string, data: unknown = {}) {
      for (const handler of this.handlers[event] ?? []) handler(event, data);
    }
  }

  const StaticMock = MockHls as unknown as {
    isSupported: () => boolean;
    Events: typeof Events;
    ErrorTypes: typeof ErrorTypes;
  };
  StaticMock.isSupported = () => true;
  StaticMock.Events = Events;
  StaticMock.ErrorTypes = ErrorTypes;
  return { default: MockHls };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: { access_token: "viewer-token" } } }),
    },
  },
}));

vi.mock("@/components/SportImage", () => ({
  SportImage: () => null,
}));

import { HlsTile } from "./HlsTile";

beforeAll(() => {
  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true,
    value: () => Promise.resolve(),
  });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", {
    configurable: true,
    value: () => {},
  });
  Object.defineProperty(HTMLMediaElement.prototype, "load", {
    configurable: true,
    value: () => {},
  });
});

afterEach(() => {
  cleanup();
  instances.length = 0;
  vi.useRealTimers();
});

const props = {
  tvId: "tv-1",
  slot: 1,
  displayName: "Primetime TV 1",
  channelName: "PRIME: NBA",
  status: "unconfigured",
  active: true,
  onActivate: () => {},
};

describe("HlsTile lounge playback lifecycle", () => {
  it("attaches the secure playlist and becomes LIVE only after video is playing", async () => {
    render(<HlsTile {...props} />);

    await waitFor(() => expect(instances).toHaveLength(1));
    const hls = instances[0];
    expect(hls.loadSource).toHaveBeenCalledWith("/api/sports-arena/tv/tv-1/playlist");
    expect(hls.attachMedia).toHaveBeenCalledWith(expect.any(HTMLVideoElement));

    const setRequestHeader = vi.fn();
    hls.config.xhrSetup?.({ setRequestHeader } as unknown as XMLHttpRequest);
    expect(setRequestHeader).toHaveBeenCalledWith("Authorization", "Bearer viewer-token");
    expect(screen.getByText("CONNECT")).toBeTruthy();

    act(() => hls.emit("manifest"));
    expect(screen.getByText(/Playlist attached/i)).toBeTruthy();
    expect(screen.queryByText("LIVE")).toBeNull();

    fireEvent.playing(screen.getByLabelText(/PRIME: NBA live stream/i));
    expect(screen.getByText("LIVE")).toBeTruthy();
    expect(screen.queryByText(/Connecting stream/i)).toBeNull();
  });

  it("surfaces a retryable error instead of leaving a permanent black screen", async () => {
    vi.useFakeTimers();
    render(<HlsTile {...props} />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(instances).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(screen.getByText("Stream is taking too long")).toBeTruthy();
    expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
    expect(screen.getByText("OFF")).toBeTruthy();
  });
  it("surfaces the Xtream provider connection limit instead of buffering forever", async () => {
    render(<HlsTile {...props} />);
    await waitFor(() => expect(instances).toHaveLength(1));

    act(() => {
      instances[0].emit("error", {
        fatal: true,
        type: "network",
        response: { code: 429 },
      });
    });

    expect(screen.getByText("Provider connection limit reached")).toBeTruthy();
    expect(screen.getByText(/too many active streams/i)).toBeTruthy();
    expect(screen.getByText("OFF")).toBeTruthy();
  });
});
