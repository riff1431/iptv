import { describe, expect, it } from "vitest";
import {
  resolveSlotCount,
  slotNumbers,
  resolveTvTileLayout,
  TV_TILE_LAYOUT_SIZE,
  type TvTileSlotShape,
} from "./match-slot-count";

const placeholder = (slot: number): TvTileSlotShape => ({
  slot,
  channelId: null,
  channelName: null,
  channelLogo: null,
  enabled: false,
});

const filled = (slot: number, channelId = `ch-${slot}`): TvTileSlotShape => ({
  slot,
  channelId,
  channelName: `Channel ${slot}`,
  channelLogo: null,
  enabled: true,
});

describe("resolveSlotCount", () => {
  it("returns the value unchanged when inside 1..8", () => {
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) {
      expect(resolveSlotCount(n)).toBe(n);
    }
  });

  it("clamps values below 1 up to 1", () => {
    expect(resolveSlotCount(0)).toBe(1);
    expect(resolveSlotCount(-5)).toBe(1);
  });

  it("clamps values above 8 down to 8", () => {
    expect(resolveSlotCount(9)).toBe(8);
    expect(resolveSlotCount(999)).toBe(8);
  });

  it("falls back to 4 for null/undefined/NaN", () => {
    expect(resolveSlotCount(null)).toBe(4);
    expect(resolveSlotCount(undefined)).toBe(4);
    expect(resolveSlotCount(Number.NaN)).toBe(4);
  });

  it("floors non-integer values", () => {
    expect(resolveSlotCount(3.9)).toBe(3);
  });
});

describe("slotNumbers", () => {
  it("returns [1..count] for each valid count", () => {
    expect(slotNumbers(1)).toEqual([1]);
    expect(slotNumbers(3)).toEqual([1, 2, 3]);
    expect(slotNumbers(8)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("clamps to the valid range before generating", () => {
    expect(slotNumbers(0)).toEqual([1]);
    expect(slotNumbers(99)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(slotNumbers(null)).toEqual([1, 2, 3, 4]);
  });
});

describe("resolveTvTileLayout (fixed 4-tile TV view)", () => {
  it("locks the layout size to 4", () => {
    expect(TV_TILE_LAYOUT_SIZE).toBe(4);
  });

  it("returns exactly 4 tiles in slot order 1..4 when fully configured", () => {
    const layout = resolveTvTileLayout(
      [filled(1), filled(2), filled(3), filled(4)],
      placeholder,
    );
    expect(layout.tiles.map((t) => t.slot)).toEqual([1, 2, 3, 4]);
    expect(layout.paddedCount).toBe(0);
    expect(layout.overflowCount).toBe(0);
    expect(layout.overflow).toEqual([]);
  });

  it("pads missing slots with disabled placeholders (fewer than 4 configured)", () => {
    const layout = resolveTvTileLayout([filled(1), filled(3)], placeholder);
    expect(layout.tiles.map((t) => t.slot)).toEqual([1, 2, 3, 4]);
    expect(layout.tiles[1].channelId).toBeNull();
    expect(layout.tiles[1].enabled).toBe(false);
    expect(layout.tiles[3].enabled).toBe(false);
    expect(layout.paddedCount).toBe(2);
    expect(layout.overflowCount).toBe(0);
  });

  it("hides slots beyond the 4-tile limit into overflow (extra slots)", () => {
    const layout = resolveTvTileLayout(
      [filled(1), filled(2), filled(3), filled(4), filled(5), filled(8)],
      placeholder,
    );
    expect(layout.tiles).toHaveLength(4);
    expect(layout.tiles.map((t) => t.slot)).toEqual([1, 2, 3, 4]);
    expect(layout.overflow.map((t) => t.slot)).toEqual([5, 8]);
    expect(layout.overflowCount).toBe(2);
    expect(layout.paddedCount).toBe(0);
  });

  it("handles a completely empty config by returning 4 placeholder tiles", () => {
    const layout = resolveTvTileLayout([], placeholder);
    expect(layout.tiles).toHaveLength(4);
    expect(layout.tiles.every((t) => !t.enabled && t.channelId === null)).toBe(true);
    expect(layout.paddedCount).toBe(4);
    expect(layout.overflowCount).toBe(0);
  });

  it("drops invalid slot numbers (<=0, non-integer)", () => {
    const layout = resolveTvTileLayout(
      [
        { ...filled(1), slot: 0 },
        { ...filled(2), slot: -1 },
        { ...filled(3), slot: 2.5 },
        filled(1),
      ],
      placeholder,
    );
    // Only slot 1 is real; 2..4 padded.
    expect(layout.tiles[0].channelId).toBe("ch-1");
    expect(layout.paddedCount).toBe(3);
    expect(layout.overflowCount).toBe(0);
  });

  it("keeps the first occurrence when duplicate slot numbers are provided", () => {
    const layout = resolveTvTileLayout(
      [filled(1, "first"), filled(1, "second"), filled(2)],
      placeholder,
    );
    expect(layout.tiles[0].channelId).toBe("first");
  });
});

