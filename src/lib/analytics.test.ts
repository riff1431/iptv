import { describe, it, expect, beforeEach, vi } from "vitest";
import { trackEvent, ANALYTICS_EVENT, type AnalyticsEvent } from "./analytics";

describe("trackEvent", () => {
  let received: AnalyticsEvent[] = [];
  const listener = (e: Event) => {
    received.push((e as CustomEvent<AnalyticsEvent>).detail);
  };

  beforeEach(() => {
    received = [];
    window.addEventListener(ANALYTICS_EVENT, listener);
    return () => window.removeEventListener(ANALYTICS_EVENT, listener);
  });

  it("dispatches an analytics:event with name and props", () => {
    trackEvent("wallet.deep_link.auto_mark_read", {
      topup_id: "abc-123",
      count: 2,
      amount_cents: 2500,
    });
    expect(received).toHaveLength(1);
    expect(received[0].name).toBe("wallet.deep_link.auto_mark_read");
    expect(received[0].props).toEqual({
      topup_id: "abc-123",
      count: 2,
      amount_cents: 2500,
    });
    expect(typeof received[0].ts).toBe("number");
  });

  it("defaults props to an empty object", () => {
    trackEvent("test.event");
    expect(received[0].props).toEqual({});
  });

  it("does not throw when window.dispatchEvent errors", () => {
    const spy = vi
      .spyOn(window, "dispatchEvent")
      .mockImplementation(() => {
        throw new Error("boom");
      });
    expect(() => trackEvent("x")).not.toThrow();
    spy.mockRestore();
  });
});
