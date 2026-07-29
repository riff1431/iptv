import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  IptvRelayUpstreamError,
  getSharedGlobalPlaylist,
  getSharedGlobalResource,
  getSharedGlobalResourceResponse,
  resetGlobalIptvRelayForTests,
} from "./global-iptv-relay.server";

beforeAll(() => {
  process.env.IPTV_PROXY_SIGNING_KEY = "relay-test-signing-key-with-enough-entropy";
});

beforeEach(() => {
  resetGlobalIptvRelayForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("global IPTV shared relay", () => {
  it("single-flights concurrent playlist requests and hides upstream credentials", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("#EXTM3U\n#EXT-X-TARGETDURATION:6\nsegment-1.ts\n", {
        status: 200,
        headers: { "content-type": "application/vnd.apple.mpegurl" },
      }),
    );
    const upstream = "http://provider.test/live/private-user/private-password/123.m3u8";
    const requests = Array.from({ length: 8 }, () =>
      getSharedGlobalPlaylist(
        "global-xtream:123",
        upstream,
        "/api/public/iptv/channel/123/segment",
      ),
    );

    const playlists = await Promise.all(requests);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(new Set(playlists).size).toBe(1);
    expect(playlists[0]).toContain("/api/public/iptv/channel/123/segment?token=");
    expect(playlists[0]).not.toContain("private-user");
    expect(playlists[0]).not.toContain("private-password");
  });

  it("single-flights and caches the same media segment for concurrent viewers", async () => {
    const bytes = new Uint8Array([0x47, 0x40, 0x00, 0x10]);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(bytes, {
        status: 200,
        headers: { "content-type": "video/mp2t" },
      }),
    );
    const upstream = "https://cdn.provider.test/hls/segment-1.ts";

    const resources = await Promise.all(
      Array.from({ length: 12 }, () => getSharedGlobalResource("global-xtream:123", upstream)),
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(resources.every((resource) => resource.bytes.byteLength === bytes.byteLength)).toBe(
      true,
    );

    await getSharedGlobalResource("global-xtream:123", upstream);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("maps an empty Xtream HTTP 458 to an actionable 429 relay error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 458 }));

    await expect(
      getSharedGlobalPlaylist(
        "global-xtream:123",
        "http://provider.test/live/u/p/123.m3u8",
        "/api/public/iptv/channel/123/segment",
      ),
    ).rejects.toMatchObject({
      status: 429,
    } satisfies Partial<IptvRelayUpstreamError>);
  });

  it("rejects an oversized resource before buffering its body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("not-read", {
        status: 200,
        headers: { "content-length": String(33 * 1024 * 1024) },
      }),
    );

    await expect(
      getSharedGlobalResource("global-xtream:123", "https://cdn.provider.test/hls/oversized.ts"),
    ).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining("size limit"),
    } satisfies Partial<IptvRelayUpstreamError>);
  });
  it("streams the first media response while warming the shared cache", async () => {
    let finish!: () => void;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0x47, 0x40]));
        finish = () => {
          controller.enqueue(new Uint8Array([0x00, 0x10]));
          controller.close();
        };
      },
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { "content-type": "video/mp2t" },
      }),
    );
    const upstream = "https://cdn.provider.test/hls/live-segment.ts";

    const first = await getSharedGlobalResourceResponse("global-xtream:123", upstream);
    expect(first.kind).toBe("stream");
    if (first.kind !== "stream") throw new Error("Expected progressive media response");

    const reader = first.body.getReader();
    expect(await reader.read()).toEqual({ done: false, value: new Uint8Array([0x47, 0x40]) });

    let secondSettled = false;
    const secondPromise = getSharedGlobalResourceResponse("global-xtream:123", upstream).then(
      (result) => {
        secondSettled = true;
        return result;
      },
    );
    await Promise.resolve();
    expect(secondSettled).toBe(false);

    finish();
    expect(await reader.read()).toEqual({ done: false, value: new Uint8Array([0x00, 0x10]) });
    expect(await reader.read()).toEqual({ done: true, value: undefined });

    const second = await secondPromise;
    expect(second.kind).toBe("buffered");
    if (second.kind !== "buffered") throw new Error("Expected cached media response");
    expect(second.resource.bytes).toEqual(new Uint8Array([0x47, 0x40, 0x00, 0x10]));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
