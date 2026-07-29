import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// --- Mutable mock data (referenced lazily inside the mocked query hook, so no
// TDZ — the factory only *defines* useSuspenseQuery, it doesn't call it). ---
let loungesData: unknown = undefined;
let matchesData: unknown = undefined;

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useSuspenseQuery: (opts: { queryKey: string[] }) => {
      const key = opts?.queryKey?.[0];
      if (key === "publicLounges") return { data: loungesData };
      if (key === "publicMatches") return { data: matchesData };
      return { data: undefined };
    },
  };
});

vi.mock("@/hooks/usePublicLoungesRealtime", () => ({
  usePublicLoungesRealtime: () => {},
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a>,
}));

import LiveSportsGrid from "./LiveSportsGrid";

afterEach(() => {
  cleanup();
  loungesData = undefined;
  matchesData = undefined;
});

describe("LiveSportsGrid", () => {
  it("renders real lounge matchups with no creator persona when lounges have live TVs", () => {
    loungesData = [
      {
        id: "l1",
        name: "Sports Central",
        viewerCount: 1500,
        tvs: [{ matchup: "Custom Live Match", channel_logo: null, sport: "NBA" }],
      },
    ];
    matchesData = [{ id: "m1" }];

    render(<LiveSportsGrid />);

    expect(screen.getByText("Custom Live Match")).toBeTruthy();
    // Real lounge cards have no marketing creator → the "with {name}" line is absent.
    expect(screen.queryByText(/LunaLove/)).toBeNull();
  });

  it("falls back to DEFAULT_ITEMS marketing mock-ups when no lounge has a live TV", () => {
    loungesData = [];
    matchesData = [];

    render(<LiveSportsGrid />);

    // DEFAULT_ITEMS[0] = "Lakers vs Celtics" with creator LunaLove.
    expect(screen.getByText("Lakers vs Celtics")).toBeTruthy();
    expect(screen.getByText(/LunaLove/)).toBeTruthy();
  });
});
