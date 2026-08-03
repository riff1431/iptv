import { describe, expect, it } from "vitest";
import { getBufferedSecondsAhead } from "./iptv-player-utils";

function timeRanges(ranges: Array<[number, number]>): TimeRanges {
  return {
    length: ranges.length,
    start: (index: number) => ranges[index]![0],
    end: (index: number) => ranges[index]![1],
  };
}

describe("IPTV startup buffer", () => {
  it("measures buffer ahead from the current playback position", () => {
    expect(getBufferedSecondsAhead({ currentTime: 105, buffered: timeRanges([[100, 120]]) })).toBe(
      15,
    );
  });

  it("uses the first MSE range length before autoplay sets currentTime", () => {
    expect(
      getBufferedSecondsAhead({ currentTime: 0, buffered: timeRanges([[10_000, 10_012]]) }),
    ).toBe(12);
  });

  it("returns zero when no playable range is buffered", () => {
    expect(getBufferedSecondsAhead({ currentTime: 50, buffered: timeRanges([]) })).toBe(0);
  });
});
