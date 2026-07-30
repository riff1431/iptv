import { afterEach, describe, expect, it, vi } from "vitest";
import { xtreamChannels } from "./iptv-client.server";

const credentials = {
  server_url: "https://provider.test",
  username: "user",
  password: "pass",
  connection_type: "xtream" as const,
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("xtreamChannels", () => {
  it("aborts a provider that does not respond within 15 seconds", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        });
      }),
    );

    const request = xtreamChannels(credentials);
    const rejection = expect(request).rejects.toThrow("IPTV provider timed out after 15s");
    await vi.advanceTimersByTimeAsync(15_000);
    await rejection;
  });

  it("maps live streams and provider categories without a database cache", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        const body = url.includes("get_live_categories")
          ? [{ category_id: "9", category_name: "Sports" }]
          : [
              {
                stream_id: 123,
                name: "Provider Sports",
                stream_icon: "https://provider.test/logo.png",
                category_id: "9",
              },
            ];
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    await expect(xtreamChannels(credentials)).resolves.toEqual([
      expect.objectContaining({
        id: "123",
        name: "Provider Sports",
        group: "Sports",
      }),
    ]);
  });
});
