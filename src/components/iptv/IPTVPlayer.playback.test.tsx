import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (event: string, data: unknown) => void;
type MockHls = {
  config: Record<string, unknown>;
  handlers: Record<string, Handler[]>;
  loadSource: ReturnType<typeof vi.fn>;
  attachMedia: ReturnType<typeof vi.fn>;
  startLoad: ReturnType<typeof vi.fn>;
  recoverMediaError: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  emit: (event: string, data?: unknown) => void;
  liveSyncPosition: number | null;
};

const { instances } = vi.hoisted(() => ({ instances: [] as MockHls[] }));

vi.mock("mpegts.js", () => ({
  default: {
    isSupported: () => false,
    Events: { MEDIA_INFO: "media", STATISTICS_INFO: "stats", ERROR: "error" },
  },
}));

vi.mock("hls.js", async () => {
  const { vi: vitest } = await import("vitest");
  const Events = {
    MANIFEST_LOADING: "manifestLoading",
    MANIFEST_LOADED: "manifestLoaded",
    MANIFEST_PARSED: "manifestParsed",
    LEVEL_LOADED: "levelLoaded",
    LEVEL_SWITCHING: "levelSwitching",
    FRAG_LOADING: "fragLoading",
    FRAG_LOADED: "fragLoaded",
    BUFFER_APPENDED: "bufferAppended",
    FRAG_BUFFERED: "fragBuffered",
    ERROR: "error",
  };
  const ErrorTypes = { NETWORK_ERROR: "networkError", MEDIA_ERROR: "mediaError" };
  class HlsMock implements MockHls {
    handlers: Record<string, Handler[]> = {};
    loadSource = vitest.fn();
    attachMedia = vitest.fn();
    startLoad = vitest.fn();
    recoverMediaError = vitest.fn();
    destroy = vitest.fn();
    liveSyncPosition: number | null = null;
    constructor(public config: Record<string, unknown>) {
      instances.push(this);
    }
    on(event: string, handler: Handler) {
      (this.handlers[event] ||= []).push(handler);
    }
    emit(event: string, data: unknown = {}) {
      for (const handler of this.handlers[event] || []) handler(event, data);
    }
  }
  const HlsCtor = HlsMock as typeof HlsMock & {
    isSupported: () => boolean;
    Events: typeof Events;
    ErrorTypes: typeof ErrorTypes;
  };
  HlsCtor.isSupported = () => true;
  HlsCtor.Events = Events;
  HlsCtor.ErrorTypes = ErrorTypes;
  return { default: HlsCtor };
});

import { IPTVPlayer } from "./IPTVPlayer";

const URL = "/api/public/iptv/channel/1536951/playlist?access=opaque";

beforeEach(() => {
  instances.length = 0;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("public IPTV player recovery", () => {
  it("uses production-safe hls.js buffer and load policies", () => {
    render(<IPTVPlayer url={URL} />);
    expect(instances).toHaveLength(1);
    expect(instances[0].config).toMatchObject({
      lowLatencyMode: false,
      liveSyncDurationCount: 6,
      liveMaxLatencyDurationCount: 12,
      backBufferLength: 30,
      maxBufferLength: 60,
      maxMaxBufferLength: 120,
    });
    expect(instances[0].config.manifestLoadPolicy).toBeTruthy();
    expect(instances[0].config.playlistLoadPolicy).toBeTruthy();
    expect(instances[0].config.fragLoadPolicy).toBeTruthy();
  });

  it("shows buffering only for a sustained media stall and clears it on FRAG_BUFFERED", () => {
    vi.useFakeTimers();
    render(<IPTVPlayer url={URL} />);
    const video = document.querySelector("video")!;
    Object.defineProperty(video, "paused", { configurable: true, value: false });
    act(() => instances[0].emit("fragBuffered"));
    fireEvent.waiting(video);
    expect(screen.queryByText(/^Buffering…$/)).toBeNull();
    act(() => vi.advanceTimersByTime(650));
    expect(screen.getByText(/^Buffering…$/)).toBeTruthy();
    act(() => instances[0].emit("fragBuffered"));
    expect(screen.queryByText(/^Buffering…$/)).toBeNull();
  });

  it("does not restart HLS loading merely because the watchdog observes a short stall", () => {
    vi.useFakeTimers();
    render(<IPTVPlayer url={URL} />);
    const video = document.querySelector("video")!;
    Object.defineProperty(video, "paused", { configurable: true, value: false });
    Object.defineProperty(video, "ended", { configurable: true, value: false });
    act(() => vi.advanceTimersByTime(8_000));
    expect(instances[0].startLoad).not.toHaveBeenCalled();
  });

  it("bounds fatal network recovery and destroys the old instance on source change", () => {
    vi.useFakeTimers();
    const { rerender } = render(<IPTVPlayer url={URL} />);
    const first = instances[0];
    act(() => {
      for (let index = 0; index < 3; index += 1) {
        first.emit("error", {
          fatal: true,
          type: "networkError",
          details: "fragLoadError",
          response: { code: 502 },
        });
        vi.advanceTimersByTime(1_000);
      }
      first.emit("error", {
        fatal: true,
        type: "networkError",
        details: "fragLoadError",
        response: { code: 502 },
      });
    });
    expect(first.startLoad).toHaveBeenCalledTimes(3);

    rerender(<IPTVPlayer url="/api/public/iptv/channel/1536952/playlist?access=opaque" />);
    expect(first.destroy).toHaveBeenCalledTimes(1);
    expect(instances).toHaveLength(2);
  });
});
