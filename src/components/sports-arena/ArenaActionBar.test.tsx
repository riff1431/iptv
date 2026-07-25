import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock external deps so ArenaActionBar renders in isolation.
const toastFn = vi.fn();
vi.mock("sonner", () => {
  const t = (msg: string, opts?: unknown) => toastFn(msg, opts);
  return {
    toast: Object.assign(t, {
      success: (m: string) => toastFn(m),
      error: (m: string) => toastFn(m),
    }),
  };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "u1" } }),
}));

vi.mock("@/hooks/useLoungeChat", () => ({
  useLoungeChat: () => ({ send: vi.fn().mockResolvedValue(undefined) }),
}));

import { ArenaActionBar } from "./ArenaActionBar";

describe("ArenaActionBar toggles", () => {
  beforeEach(() => {
    toastFn.mockClear();
  });
  afterEach(() => cleanup());

  // Wait past the 350ms per-toggle debounce window between intentional flips.
  const pastDebounce = () => new Promise((r) => setTimeout(r, 400));

  function renderBar() {
    return render(<ArenaActionBar loungeId="lounge-1" tvs={[]} />);
  }

  it("Voice Chat toggle flips state and fires a toast each way", async () => {
    const user = userEvent.setup();
    renderBar();

    const enter = screen.getByRole("button", { name: /voice chat/i });
    expect(enter).not.toHaveAttribute("aria-pressed");
    await user.click(enter);

    expect(toastFn).toHaveBeenCalledWith("Voice chat joined", undefined);
    const leave = screen.getByRole("button", { name: /leave voice/i });
    expect(leave).toHaveAttribute("aria-pressed", "true");

    await pastDebounce();
    await user.click(leave);
    expect(toastFn).toHaveBeenCalledWith("Voice chat left", undefined);
    expect(
      screen.getByRole("button", { name: /voice chat/i }),
    ).not.toHaveAttribute("aria-pressed");
  });

  it("Mute Mic toggle flips state and fires a toast each way", async () => {
    const user = userEvent.setup();
    renderBar();

    const mute = screen.getByRole("button", { name: /^mute mic$/i });
    expect(mute).not.toHaveAttribute("aria-pressed");
    await user.click(mute);

    expect(toastFn).toHaveBeenCalledWith("Your mic is muted", undefined);
    const unmute = screen.getByRole("button", { name: /^unmute mic$/i });
    expect(unmute).toHaveAttribute("aria-pressed", "true");

    await pastDebounce();
    await user.click(unmute);
    expect(toastFn).toHaveBeenCalledWith("Your mic is live", undefined);
  });

  it("Mute All toggle flips state and fires a toast each way", async () => {
    const user = userEvent.setup();
    renderBar();

    const muteAll = screen.getByRole("button", { name: /^mute all$/i });
    expect(muteAll).not.toHaveAttribute("aria-pressed");
    await user.click(muteAll);

    expect(toastFn).toHaveBeenCalledWith("Muted everyone in voice", undefined);
    const unmuteAll = screen.getByRole("button", { name: /^unmute all$/i });
    expect(unmuteAll).toHaveAttribute("aria-pressed", "true");

    await pastDebounce();
    await user.click(unmuteAll);
    expect(toastFn).toHaveBeenCalledWith("Unmuted everyone in voice", undefined);
  });

  describe("rapid double-click debounce", () => {
    // fireEvent dispatches synchronously — two clicks land inside the 350ms
    // debounce window without waiting for real user timing.
    it.each([
      ["Voice Chat", /voice chat/i, "Voice chat joined"],
      ["Mute Mic", /^mute mic$/i, "Your mic is muted"],
      ["Mute All", /^mute all$/i, "Muted everyone in voice"],
    ])(
      "%s: two rapid clicks fire only one toast and one state flip",
      async (_label, matcher, expectedToast) => {
        const { fireEvent } = await import("@testing-library/react");
        renderBar();
        const btn = screen.getByRole("button", { name: matcher });

        fireEvent.click(btn);
        fireEvent.click(btn);

        const matching = toastFn.mock.calls.filter(
          ([m]) => m === expectedToast,
        );
        expect(matching).toHaveLength(1);
        expect(toastFn).toHaveBeenCalledTimes(1);
        // State stayed "pressed" — did not flip back off.
        expect(btn).toHaveAttribute("aria-pressed", "true");
      },
    );
  });

  describe("keyboard operation and ARIA", () => {
    it.each([
      ["Voice Chat", /voice chat/i, "Voice chat joined"],
      ["Mute Mic", /^mute mic$/i, "Your mic is muted"],
      ["Mute All", /^mute all$/i, "Muted everyone in voice"],
    ])(
      "%s: Enter activates the toggle and updates aria-pressed",
      async (_label, matcher, expectedToast) => {
        const user = userEvent.setup();
        renderBar();
        const btn = screen.getByRole("button", { name: matcher });

        // Off state exposes no aria-pressed (only present when active).
        expect(btn).not.toHaveAttribute("aria-pressed");

        btn.focus();
        expect(btn).toHaveFocus();
        await user.keyboard("{Enter}");

        expect(toastFn).toHaveBeenCalledWith(expectedToast, undefined);
        expect(btn).toHaveAttribute("aria-pressed", "true");
      },
    );

    it.each([
      ["Voice Chat", /voice chat/i, "Voice chat joined"],
      ["Mute Mic", /^mute mic$/i, "Your mic is muted"],
      ["Mute All", /^mute all$/i, "Muted everyone in voice"],
    ])(
      "%s: Space activates the toggle and updates aria-pressed",
      async (_label, matcher, expectedToast) => {
        const user = userEvent.setup();
        renderBar();
        const btn = screen.getByRole("button", { name: matcher });

        btn.focus();
        await user.keyboard(" ");

        expect(toastFn).toHaveBeenCalledWith(expectedToast, undefined);
        expect(btn).toHaveAttribute("aria-pressed", "true");
      },
    );
  });
});
