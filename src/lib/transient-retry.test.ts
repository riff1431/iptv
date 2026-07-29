import { describe, expect, it, vi } from "vitest";
import { retryTransient } from "@/lib/transient-retry";

describe("retryTransient", () => {
  it("recovers from a short-lived failure", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue("ready");

    await expect(retryTransient(operation, { attempts: 3, delayMs: () => 0 })).resolves.toBe(
      "ready",
    );
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("stops after the configured number of attempts", async () => {
    const operation = vi.fn<() => Promise<never>>().mockRejectedValue(new Error("offline"));

    await expect(retryTransient(operation, { attempts: 3, delayMs: () => 0 })).rejects.toThrow(
      "offline",
    );
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("does not retry a permanent failure", async () => {
    const operation = vi.fn<() => Promise<never>>().mockRejectedValue(new Error("forbidden"));

    await expect(
      retryTransient(operation, {
        attempts: 3,
        delayMs: () => 0,
        shouldRetry: () => false,
      }),
    ).rejects.toThrow("forbidden");
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
