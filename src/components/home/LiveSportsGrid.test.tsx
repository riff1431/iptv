import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href="#" data-to={to}>
      {children}
    </a>
  ),
}));

import LiveSportsGrid from "./LiveSportsGrid";

afterEach(cleanup);

describe("LiveSportsGrid public demo", () => {
  it("always renders the four fixed sports mock-ups without database data", () => {
    render(<LiveSportsGrid />);

    expect(screen.getByText("Lakers vs Celtics")).toBeTruthy();
    expect(screen.getByText("Rangers vs Bruins")).toBeTruthy();
    expect(screen.getByText("Real Madrid vs Barcelona")).toBeTruthy();
    expect(screen.getByText("India vs Pakistan")).toBeTruthy();
    expect(screen.getAllByText("Administrator")).toHaveLength(4);
  });

  it("keeps every demo card on the public lobby path instead of a configured lounge", () => {
    render(<LiveSportsGrid />);

    for (const title of [
      "Lakers vs Celtics",
      "Rangers vs Bruins",
      "Real Madrid vs Barcelona",
      "India vs Pakistan",
    ]) {
      expect(screen.getByText(title).closest("a")?.dataset.to).toBe("/lobby");
    }
  });
});
