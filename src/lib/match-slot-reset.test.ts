import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  clearMatchSlotLocal,
  firstEnabledSlot,
  resetMatchSlot,
} from "./match-slot-reset";

const KEY = "arena.activeSlot";

describe("resetMatchSlot", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("removes only the target match entry from localStorage", () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ "match-1": 2, "match-2": 3 }),
    );
    clearMatchSlotLocal("match-1");
    expect(JSON.parse(window.localStorage.getItem(KEY) || "{}")).toEqual({
      "match-2": 3,
    });
  });

  it("returns the first enabled slot", () => {
    expect(firstEnabledSlot([{ slot: 2 }, { slot: 4 }])).toBe(2);
    expect(firstEnabledSlot([])).toBeNull();
  });

  it("clears both server pref and localStorage and selects first enabled slot", async () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ "match-1": 3, "match-2": 1 }),
    );
    const clearServerPref = vi.fn().mockResolvedValue(undefined);

    const result = await resetMatchSlot({
      matchId: "match-1",
      enabledSlots: [{ slot: 2 }, { slot: 4 }],
      isAuthenticated: true,
      clearServerPref,
    });

    expect(clearServerPref).toHaveBeenCalledTimes(1);
    expect(clearServerPref).toHaveBeenCalledWith("match-1");
    expect(JSON.parse(window.localStorage.getItem(KEY) || "{}")).toEqual({
      "match-2": 1,
    });
    expect(result).toEqual({ nextSlot: 2, serverCleared: true });
  });

  it("skips the server call when signed out", async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ "match-1": 3 }));
    const clearServerPref = vi.fn().mockResolvedValue(undefined);

    const result = await resetMatchSlot({
      matchId: "match-1",
      enabledSlots: [{ slot: 1 }],
      isAuthenticated: false,
      clearServerPref,
    });

    expect(clearServerPref).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(KEY)).toBe("{}");
    expect(result).toEqual({ nextSlot: 1, serverCleared: false });
  });

  it("still clears localStorage and returns next slot when the server call fails", async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ "match-1": 3 }));
    const clearServerPref = vi.fn().mockRejectedValue(new Error("network"));

    const result = await resetMatchSlot({
      matchId: "match-1",
      enabledSlots: [{ slot: 2 }],
      isAuthenticated: true,
      clearServerPref,
    });

    expect(clearServerPref).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(KEY)).toBe("{}");
    expect(result).toEqual({ nextSlot: 2, serverCleared: false });
  });

  it("returns null when no slots are enabled", async () => {
    const result = await resetMatchSlot({
      matchId: "match-1",
      enabledSlots: [],
      isAuthenticated: false,
      clearServerPref: vi.fn(),
    });
    expect(result.nextSlot).toBeNull();
  });
});
