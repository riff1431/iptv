import { describe, it, expect } from "vitest";
import { getLoungeTvTiles } from "./lounge-tv-tiles";
import type { PublicTv } from "@/lib/lounges.public.functions";

function tv(partial: Partial<PublicTv> & { slot: number }): PublicTv {
  return {
    id: partial.id ?? `tv-${partial.slot}`,
    slot: partial.slot,
    position: partial.position ?? partial.slot,
    display_name: partial.display_name ?? null,
    sport: partial.sport ?? "",
    matchup: partial.matchup ?? "",
    home_label: partial.home_label ?? null,
    away_label: partial.away_label ?? null,
    home_score: partial.home_score ?? 0,
    away_score: partial.away_score ?? 0,
    period_label: partial.period_label ?? null,
    clock_label: partial.clock_label ?? null,
    accent_home: partial.accent_home ?? null,
    accent_away: partial.accent_away ?? null,
    channel_logo: partial.channel_logo ?? null,
  };
}

describe("getLoungeTvTiles", () => {
  it("always returns exactly 4 tiles in slot 1→4 order, even for no TVs", () => {
    const tiles = getLoungeTvTiles([]);
    expect(tiles).toHaveLength(4);
    expect(tiles.map((t) => t.slot)).toEqual([1, 2, 3, 4]);
    expect(tiles.every((t) => !t.configured)).toBe(true);
  });

  it("maps a full set of 4 configured TVs and plumbs fields through", () => {
    const tiles = getLoungeTvTiles([
      tv({ slot: 1, matchup: "Lakers vs Celtics", channel_logo: "https://a", sport: "NBA" }),
      tv({ slot: 2, matchup: "India vs Pakistan", sport: "Cricket" }),
      tv({ slot: 3, display_name: "TV 3" }),
      tv({ slot: 4 }),
    ]);
    expect(tiles.map((t) => t.configured)).toEqual([true, true, true, true]);
    expect(tiles[0]).toMatchObject({
      slot: 1,
      matchup: "Lakers vs Celtics",
      channelLogo: "https://a",
      sport: "NBA",
    });
    expect(tiles[2]).toMatchObject({ displayName: "TV 3" });
  });

  it("emits slots in 1→4 order even when input is unsorted", () => {
    const tiles = getLoungeTvTiles([tv({ slot: 3, matchup: "C" }), tv({ slot: 1, matchup: "A" })]);
    expect(tiles.map((t) => t.slot)).toEqual([1, 2, 3, 4]);
    expect(tiles.map((t) => t.configured)).toEqual([true, false, true, false]);
    expect(tiles[0].matchup).toBe("A");
    expect(tiles[2].matchup).toBe("C");
  });

  it("marks missing slots as unconfigured placeholders", () => {
    const tiles = getLoungeTvTiles([tv({ slot: 2 })]);
    expect(tiles.map((t) => t.configured)).toEqual([false, true, false, false]);
    expect(tiles[0]).toMatchObject({ channelLogo: null, sport: "", matchup: "" });
  });

  it("derives hasScore from team labels and carries scores", () => {
    const tiles = getLoungeTvTiles([
      tv({ slot: 1, home_label: "LAL", away_label: "BOS", home_score: 98, away_score: 95 }),
      tv({ slot: 2 }),
    ]);
    expect(tiles[0].hasScore).toBe(true);
    expect(tiles[0].homeScore).toBe(98);
    expect(tiles[0].awayScore).toBe(95);
    expect(tiles[1].hasScore).toBe(false);
  });
});
