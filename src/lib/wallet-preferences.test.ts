import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  getAutoMarkReadOnDeepLink,
  setAutoMarkReadOnDeepLink,
  useAutoMarkReadOnDeepLink,
} from "./wallet-preferences";

const KEY = "wallet.autoMarkReadOnDeepLink";

describe("wallet-preferences cross-tab sync", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to true when unset", () => {
    expect(getAutoMarkReadOnDeepLink()).toBe(true);
  });

  it("persists changes to localStorage", () => {
    setAutoMarkReadOnDeepLink(false);
    expect(window.localStorage.getItem(KEY)).toBe("0");
    expect(getAutoMarkReadOnDeepLink()).toBe(false);
    setAutoMarkReadOnDeepLink(true);
    expect(window.localStorage.getItem(KEY)).toBe("1");
    expect(getAutoMarkReadOnDeepLink()).toBe(true);
  });

  it("updates the hook value in the same tab immediately via custom event", () => {
    const { result } = renderHook(() => useAutoMarkReadOnDeepLink());
    expect(result.current[0]).toBe(true);

    act(() => {
      result.current[1](false);
    });
    expect(result.current[0]).toBe(false);

    act(() => {
      result.current[1](true);
    });
    expect(result.current[0]).toBe(true);
  });

  it("updates the hook value when another tab writes to localStorage (storage event)", () => {
    // Seed the value this "tab" sees, then simulate another tab flipping it.
    window.localStorage.setItem(KEY, "1");
    const { result } = renderHook(() => useAutoMarkReadOnDeepLink());
    expect(result.current[0]).toBe(true);

    // Another tab writes directly to localStorage — the browser fires a
    // `storage` event in *other* tabs (not the writer). Simulate that here.
    act(() => {
      window.localStorage.setItem(KEY, "0");
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: KEY,
          newValue: "0",
          oldValue: "1",
          storageArea: window.localStorage,
        }),
      );
    });
    expect(result.current[0]).toBe(false);

    act(() => {
      window.localStorage.setItem(KEY, "1");
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: KEY,
          newValue: "1",
          oldValue: "0",
          storageArea: window.localStorage,
        }),
      );
    });
    expect(result.current[0]).toBe(true);
  });

  it("consumers depending on the returned value re-run immediately when the toggle flips", () => {
    // Emulates the TopupSection effect: when `autoMarkRead` becomes true,
    // the mark-as-read side effect runs; when it becomes false, it resets.
    const sideEffect = vi.fn();
    const { result, rerender } = renderHook(() => {
      const [autoMarkRead] = useAutoMarkReadOnDeepLink();
      sideEffect(autoMarkRead);
      return autoMarkRead;
    });

    expect(sideEffect).toHaveBeenLastCalledWith(true);

    // Same-tab flip
    act(() => setAutoMarkReadOnDeepLink(false));
    rerender();
    expect(sideEffect).toHaveBeenLastCalledWith(false);

    // Cross-tab flip
    act(() => {
      window.localStorage.setItem(KEY, "1");
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: KEY,
          newValue: "1",
          oldValue: "0",
          storageArea: window.localStorage,
        }),
      );
    });
    rerender();
    expect(sideEffect).toHaveBeenLastCalledWith(true);
    expect(result.current).toBe(true);
  });
});
