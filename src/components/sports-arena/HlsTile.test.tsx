import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// jsdom doesn't implement <video>.play/.pause — stub them so the tile's
// effects (which call video.play().catch(...)) don't crash.
beforeAll(() => {
  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true,
    value: () => Promise.resolve(),
  });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", {
    configurable: true,
    value: () => {},
  });
});

// ---- Mocks ----------------------------------------------------------------

// Capture the props the tile passes to SportImage on each render.
const sportImageSpy = vi.fn();
vi.mock("@/components/SportImage", () => ({
  SportImage: (props: Record<string, unknown>) => {
    sportImageSpy(props);
    return (
      <div
        data-testid="sport-image"
        data-sport={String(props.sport ?? "")}
        data-alt={String(props.alt ?? "")}
      />
    );
  },
}));

// hls.js: pretend the environment doesn't support MSE so boot() takes the
// short "HLS not supported" branch and finishes synchronously enough for the
// tests we care about. The backdrop logic doesn't depend on this.
vi.mock("hls.js", () => ({
  default: {
    isSupported: () => false,
    Events: { MANIFEST_PARSED: "manifest", ERROR: "error" },
    ErrorTypes: { NETWORK_ERROR: "net", MEDIA_ERROR: "media" },
  },
}));

// supabase: no session — the tile ends in an error state, which is still a
// state where the backdrop is visible.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
    },
  },
}));

// Scoreboard is orthogonal and pulls in styles we don't need.
vi.mock("./TvScoreOverlay", () => ({
  TvScoreOverlay: () => null,
}));

import { HlsTile } from "./HlsTile";

// ---- Tests ----------------------------------------------------------------

const baseProps = {
  tvId: "tv-1",
  slot: 1,
  displayName: null,
  channelName: null,
  status: "offline" as const,
  active: false,
  onActivate: () => {},
};

describe("HlsTile — SportImage selection", () => {
  afterEach(() => {
    cleanup();
    sportImageSpy.mockClear();
  });

  it.each([
    ["NBA", "NBA"],
    ["Soccer", "Soccer"],
    ["UFC", "UFC"],
    ["NHL", "NHL"],
  ])("passes sport=%s to SportImage when sport prop is set", (sport) => {
    render(<HlsTile {...baseProps} sport={sport} />);
    const img = screen.getByTestId("sport-image");
    expect(img.getAttribute("data-sport")).toBe(sport);
  });

  it("falls back to channelName when sport is not provided", () => {
    render(<HlsTile {...baseProps} channelName="Soccer Channel" />);
    expect(screen.getByTestId("sport-image").getAttribute("data-sport")).toBe("Soccer Channel");
  });

  it("prefers explicit sport over channelName", () => {
    render(<HlsTile {...baseProps} sport="UFC" channelName="ESPN" />);
    expect(screen.getByTestId("sport-image").getAttribute("data-sport")).toBe("UFC");
  });

  it("does not render a backdrop when neither sport nor channelName is set", () => {
    render(<HlsTile {...baseProps} />);
    expect(screen.queryByTestId("sport-image")).toBeNull();
  });

  it("uses a descriptive alt including matchup when both are set", () => {
    render(<HlsTile {...baseProps} sport="NBA" matchup="Lakers vs Celtics" />);
    expect(screen.getByTestId("sport-image").getAttribute("data-alt")).toBe(
      "NBA: Lakers vs Celtics backdrop image",
    );
  });

  it("uses a sport-only alt when there is no matchup", () => {
    render(<HlsTile {...baseProps} sport="NHL" />);
    expect(screen.getByTestId("sport-image").getAttribute("data-alt")).toBe("NHL backdrop image");
  });
});

describe("HlsTile — backdrop visibility across states", () => {
  afterEach(() => {
    cleanup();
    sportImageSpy.mockClear();
  });

  it("backdrop is visible (opacity-60) when the stream is offline", () => {
    render(<HlsTile {...baseProps} sport="NBA" status="offline" />);
    const lastCall = sportImageSpy.mock.calls.at(-1)?.[0] as {
      imgClassName: string;
    };
    expect(lastCall.imgClassName).toContain("opacity-60");
  });

  it("backdrop stays mounted even when status is online (hidden behind video)", () => {
    // When status is "online" and no error/loading, the SportImage should
    // still render (mounted once, faded out) so state transitions don't
    // remount the image and flicker.
    render(<HlsTile {...baseProps} sport="Soccer" status="online" />);
    // The image is present in the DOM regardless of visibility.
    expect(screen.getByTestId("sport-image")).toBeTruthy();
  });

  it("tile exposes an accessible name including sport, matchup, and status", () => {
    render(
      <HlsTile
        {...baseProps}
        slot={3}
        sport="UFC"
        matchup="Main Card — UFC 312"
        status="offline"
      />,
    );
    const tile = screen.getByRole("button", { name: /tv 3/i });
    const label = tile.getAttribute("aria-label") ?? "";
    expect(label).toContain("TV 3");
    expect(label).toContain("UFC");
    expect(label).toContain("Main Card — UFC 312");
    expect(label).toContain("offline");
  });
});
describe("HlsTile — lounge TV identity", () => {
  afterEach(cleanup);

  it("shows the actual selected channel instead of stale sport and matchup metadata", () => {
    render(
      <HlsTile
        {...baseProps}
        slot={1}
        channelName="PRIME: NBA"
        sport="Soccer"
        matchup="Man City vs Arsenal"
      />,
    );

    expect(screen.getByText("TV 1 · PRIME: NBA")).toBeTruthy();
    expect(screen.queryByText("Man City vs Arsenal")).toBeNull();
  });
});
