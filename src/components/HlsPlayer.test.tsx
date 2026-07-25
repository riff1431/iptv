import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

type Handler = (e: string, data: unknown) => void;
interface MockHlsShape {
  handlers: Record<string, Handler[]>;
  loadSource: ReturnType<typeof vi.fn>;
  attachMedia: ReturnType<typeof vi.fn>;
  startLoad: ReturnType<typeof vi.fn>;
  recoverMediaError: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  currentLevel: number;
  emit: (event: string, data: unknown) => void;
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
    currentLevel = -1;
    loadSource = vitest.fn();
    attachMedia = vitest.fn();
    startLoad = vitest.fn();
    recoverMediaError = vitest.fn();
    destroy = vitest.fn();
    constructor() {
      instances.push(this);
    }
    on(event: string, cb: Handler) {
      (this.handlers[event] ||= []).push(cb);
    }
    emit(event: string, data: unknown) {
      (this.handlers[event] || []).forEach((h) => h(event, data));
    }
  }

  const Ctor = MockHls as unknown as {
    new (...args: unknown[]): MockHls;
    isSupported: () => boolean;
    Events: typeof Events;
    ErrorTypes: typeof ErrorTypes;
  };
  Ctor.isSupported = () => true;
  Ctor.Events = Events;
  Ctor.ErrorTypes = ErrorTypes;
  return { default: Ctor };
});

import { HlsPlayer } from "./HlsPlayer";

const SRC = "https://example.com/stream.m3u8";

beforeEach(() => {
  instances.length = 0;
});
afterEach(() => cleanup());

describe("HlsPlayer", () => {
  it("shows the loading skeleton when a source is attached", () => {
    render(<HlsPlayer src={SRC} />);
    expect(screen.getByText(/Loading stream/i)).toBeTruthy();
    expect(instances.length).toBe(1);
    expect(instances[0].loadSource).toHaveBeenCalledWith(SRC);
  });

  it("renders the CORS/error panel with a Retry action on manifest failure", () => {
    render(<HlsPlayer src={SRC} />);
    const hls = instances[0];

    act(() => {
      hls.emit("hlsError", {
        fatal: true,
        type: "networkError",
        details: "manifestLoadError",
      });
    });

    expect(screen.getByText(/CORS/i)).toBeTruthy();
    const retry = screen.getByRole("button", { name: /retry/i });
    expect(retry).toBeTruthy();
    // Loading skeleton should be gone.
    expect(screen.queryByText(/Loading stream/i)).toBeNull();
  });

  it("re-initialises the stream when Retry is clicked", () => {
    render(<HlsPlayer src={SRC} />);
    act(() => {
      instances[0].emit("hlsError", {
        fatal: true,
        type: "networkError",
        details: "manifestLoadError",
      });
    });

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));

    // A new Hls instance was created and previous was destroyed.
    expect(instances.length).toBe(2);
    expect(instances[0].destroy).toHaveBeenCalled();
    expect(instances[1].loadSource).toHaveBeenCalledWith(SRC);
    // Back to loading state.
    expect(screen.getByText(/Loading stream/i)).toBeTruthy();
  });
});
