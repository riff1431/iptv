import { describe, it, expect } from "vitest";
import { sportImage } from "./sport-image";

import basketball from "@/assets/sport-basketball.jpg";
import soccer from "@/assets/sport-soccer.jpg";
import combat from "@/assets/sport-combat.jpg";
import hockey from "@/assets/sport-hockey.jpg";
import defaultImg from "@/assets/sport-default.jpg";

describe("sportImage mapper", () => {
  it.each([
    ["NBA", basketball],
    ["nba", basketball],
    ["basketball", basketball],
    ["NBA Finals", basketball],
  ])("%s → basketball", (label, expected) => {
    expect(sportImage(label)).toBe(expected);
  });

  it.each([
    ["Soccer", soccer],
    ["EPL", soccer],
    ["La Liga", soccer],
    ["Serie A", soccer],
    ["MLS", soccer],
    ["Bundesliga", soccer],
    ["Ligue 1", soccer],
    ["Football", soccer],
  ])("%s → soccer", (label, expected) => {
    expect(sportImage(label)).toBe(expected);
  });

  it.each([
    ["UFC", combat],
    ["UFC 312", combat],
    ["MMA", combat],
    ["Boxing", combat],
    ["Kickboxing", combat],
    ["Fight Night", combat],
  ])("%s → combat", (label, expected) => {
    expect(sportImage(label)).toBe(expected);
  });

  it.each([
    ["NHL", hockey],
    ["Hockey", hockey],
    ["Ice hockey", hockey],
  ])("%s → hockey", (label, expected) => {
    expect(sportImage(label)).toBe(expected);
  });

  it.each([
    ["Cricket", defaultImg],
    ["F1", defaultImg],
    ["", defaultImg],
    ["random text", defaultImg],
  ])("unknown label %j falls back to default", (label, expected) => {
    expect(sportImage(label)).toBe(expected);
  });
});
