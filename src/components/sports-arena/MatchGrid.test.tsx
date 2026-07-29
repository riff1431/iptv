import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import type { PublicMatch } from "@/lib/matches.public.functions";

let instance = 0;
vi.mock("./MatchSlotTile", () => ({
  MatchSlotTile: ({ slot, channelName }: { slot: number; channelName: string | null }) => {
    const [id] = useState(() => ++instance);
    return (
      <div data-testid="slot" data-slot={slot} data-instance={id}>
        {channelName}
      </div>
    );
  },
}));

import { MatchGrid } from "./MatchGrid";

function makeMatch(slots: PublicMatch["slots"]): PublicMatch {
  return {
    id: "match-1",
    title: "Cricket",
    sport: "Cricket",
    homeLabel: null,
    awayLabel: null,
    homeScore: 0,
    awayScore: 0,
    status: "live",
    startsAt: null,
    clockLabel: null,
    periodLabel: null,
    accentHome: null,
    accentAway: null,
    thumbnailUrl: null,
    entryFeeCents: 0,
    sortOrder: 0,
    viewerCount: 0,
    ownerUserId: null,
    hostDisplayName: null,
    slots,
  };
}

const channels = [1, 2, 3, 4].map((n) => ({
  id: "channel-" + n,
  name: "Channel " + n,
  url: "https://example.test/" + n + ".m3u8",
  logo: null,
  group: "Sports",
  tvgId: null,
  tvgName: null,
}));

const slots = [4, 2, 1, 3].map((slot) => ({
  slot,
  channelId: "channel-" + slot,
  channelName: "Channel " + slot,
  channelLogo: null,
  enabled: true,
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("MatchGrid", () => {
  it("remounts only the changed slot player when Admin assigns a new channel", () => {
    const { rerender } = render(
      <MatchGrid
        match={makeMatch(slots)}
        channels={channels}
        activeSlot={1}
        onActiveSlotChange={() => {}}
      />,
    );
    const before = screen.getAllByTestId("slot").map((node) => node.getAttribute("data-instance"));
    const changed = slots.map((slot) =>
      slot.slot === 1 ? { ...slot, channelId: "channel-2", channelName: "Cricket Channel" } : slot,
    );
    rerender(
      <MatchGrid
        match={makeMatch(changed)}
        channels={channels}
        activeSlot={1}
        onActiveSlotChange={() => {}}
      />,
    );
    const after = screen.getAllByTestId("slot").map((node) => node.getAttribute("data-instance"));
    expect(after[0]).not.toBe(before[0]);
    expect(after.slice(1)).toEqual(before.slice(1));
  });
});
