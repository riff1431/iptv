import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { SlotThumbs } from "./SlotThumbs";
import type { Database } from "@/integrations/supabase/types";

type MatchRow = Database["public"]["Tables"]["matches"]["Row"];
type SlotRow = Database["public"]["Tables"]["match_slots"]["Row"];

function makeMatch(slot_count: number, overrides: Partial<MatchRow> = {}): MatchRow {
  return {
    id: "m1",
    title: "Test",
    sport: null,
    home_label: null,
    away_label: null,
    home_score: 0,
    away_score: 0,
    status: "scheduled",
    starts_at: null,
    clock_label: null,
    period_label: null,
    accent_home: null,
    accent_away: null,
    thumbnail_url: null,
    is_active: true,
    sort_order: 0,
    slot_count,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    owner_id: null,
    ...overrides,
  } as MatchRow;
}

function makeSlot(slot: number, overrides: Partial<SlotRow> = {}): SlotRow {
  return {
    id: `s${slot}`,
    match_id: "m1",
    slot,
    channel_id: null,
    channel_name: null,
    channel_logo: null,
    enabled: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as SlotRow;
}

describe("SlotThumbs (admin match list)", () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    "renders exactly %i slot cells when slot_count is %i",
    (n) => {
      const { unmount } = render(<SlotThumbs match={makeMatch(n)} slots={[]} />);
      const strip = screen.getByTestId("slot-thumbs");
      expect(within(strip).getAllByTestId("slot-thumb")).toHaveLength(n);
      // Placeholder labels S1..Sn should be present in order.
      for (let i = 1; i <= n; i++) {
        expect(within(strip).getByText(`S${i}`)).toBeInTheDocument();
      }
      unmount();
    },
  );

  it("clamps out-of-range slot_count values into 1..8", () => {
    const { unmount: u1 } = render(<SlotThumbs match={makeMatch(0)} slots={[]} />);
    expect(screen.getAllByTestId("slot-thumb")).toHaveLength(1);
    u1();

    const { unmount: u2 } = render(<SlotThumbs match={makeMatch(99)} slots={[]} />);
    expect(screen.getAllByTestId("slot-thumb")).toHaveLength(8);
    u2();
  });

  it("ignores slot rows above slot_count (does not render extra thumbs)", () => {
    const match = makeMatch(3);
    const slots = [
      makeSlot(1, { channel_name: "One", channel_logo: "https://x/1.png" }),
      makeSlot(2),
      makeSlot(3),
      // Stale row beyond slot_count — must NOT render:
      makeSlot(5, { channel_name: "Stale", channel_logo: "https://x/5.png" }),
    ];
    render(<SlotThumbs match={match} slots={slots} />);
    expect(screen.getAllByTestId("slot-thumb")).toHaveLength(3);
    expect(screen.queryByText("S5")).not.toBeInTheDocument();
  });
});
