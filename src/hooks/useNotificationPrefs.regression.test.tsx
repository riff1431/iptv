import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/notif-prefs.functions", () => ({
  getMyNotifPrefs: vi.fn(async () => ({ prefs: null, updatedAt: null })),
  saveMyNotifPrefs: vi.fn(async () => undefined),
}));

vi.mock("@tanstack/react-start", () => ({
  useServerFn: (fn: unknown) => fn,
}));

import { useNotifPrefs } from "@/hooks/useNotificationPrefs";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("useNotifPrefs local sync regression", () => {
  it("does not re-render forever when it receives its own change event", async () => {
    const renders = { count: 0 };

    function Harness() {
      renders.count += 1;
      const { hydrated } = useNotifPrefs("user-1");
      return <div data-testid="status">{hydrated ? "ready" : "loading"}</div>;
    }

    const view = render(<Harness />);

    await waitFor(() => {
      expect(view.getByTestId("status").textContent).toBe("ready");
    });

    window.dispatchEvent(
      new CustomEvent("pgx:notif-prefs-changed", {
        detail: { userId: "user-1" },
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 25));
    const afterEvent = renders.count;
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(renders.count).toBe(afterEvent);
    expect(renders.count).toBeLessThan(8);
  });
});
