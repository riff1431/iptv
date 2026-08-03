// @vitest-environment node
import http, { type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  IptvRelayUpstreamError,
  getSharedGlobalPlaylist,
  getSharedGlobalResourceResponse,
  resetGlobalIptvRelayForTests,
  rewriteNestedRelayPlaylist,
} from "./global-iptv-relay.server";

type Handler = (request: http.IncomingMessage, response: http.ServerResponse) => void;

let server: Server;
let origin = "";
let handler: Handler = (_request, response) => {
  response.writeHead(500).end();
};

beforeAll(async () => {
  process.env.IPTV_PROXY_SIGNING_KEY = "relay-test-signing-key-with-enough-entropy";
  server = http.createServer((request, response) => handler(request, response));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind");
  origin = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  resetGlobalIptvRelayForTests();
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

describe("global IPTV shared relay", () => {
  it("single-flights concurrent playlists and hides upstream credentials", async () => {
    let requests = 0;
    handler = (_request, response) => {
      requests += 1;
      response.writeHead(200, { "content-type": "application/vnd.apple.mpegurl" });
      response.end("#EXTM3U\n#EXT-X-TARGETDURATION:6\nsegment-1.ts\n");
    };
    const upstream = `${origin}/live/private-user/private-password/123.m3u8`;
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        getSharedGlobalPlaylist(
          "global-xtream:123",
          upstream,
          "/api/public/iptv/channel/123/segment",
        ),
      ),
    );

    expect(requests).toBe(1);
    expect(new Set(results.map((result) => result.body)).size).toBe(1);
    expect(results[0].body).toContain("/api/public/iptv/channel/123/segment?token=");
    expect(results[0].body).not.toContain("private-user");
    expect(results[0].body).not.toContain("private-password");
    expect(results.map((result) => result.cache).sort()).toEqual([
      "in-flight",
      "in-flight",
      "in-flight",
      "in-flight",
      "in-flight",
      "in-flight",
      "in-flight",
      "miss",
    ]);
  });

  it("streams first media bytes before upstream completion and single-flights a concurrent viewer", async () => {
    let requests = 0;
    let finish!: () => void;
    handler = (_request, response) => {
      requests += 1;
      response.writeHead(200, { "content-type": "video/mp2t", "content-length": "10" });
      response.write(Buffer.from([0x47, 0x40, 0x00, 0x10, 0x00, 0x00, 0x00, 0x00]));
      finish = () => response.end(Buffer.from([0x00, 0x10]));
    };

    const upstream = `${origin}/hls/live-segment.ts`;
    const first = await getSharedGlobalResourceResponse("global-xtream:123", upstream);
    expect(first.kind).toBe("stream");
    if (first.kind !== "stream") throw new Error("Expected streaming response");
    const reader = first.body.getReader();
    expect(await reader.read()).toEqual({
      done: false,
      value: new Uint8Array([0x47, 0x40, 0x00, 0x10, 0x00, 0x00, 0x00, 0x00]),
    });

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
    expect(second.cache).toBe("in-flight");
    expect(requests).toBe(1);
  });

  it("maps an empty Xtream HTTP 458 to an actionable 429 relay error", async () => {
    handler = (_request, response) => response.writeHead(458).end();
    await expect(
      getSharedGlobalPlaylist(
        "global-xtream:123",
        `${origin}/live/u/p/123.m3u8`,
        "/api/public/iptv/channel/123/segment",
      ),
    ).rejects.toMatchObject({ status: 429 } satisfies Partial<IptvRelayUpstreamError>);
  });

  it("accepts a valid Xtream playlist body even when the provider uses HTTP 458", async () => {
    handler = (_request, response) => {
      response.writeHead(458, { "content-type": "application/vnd.apple.mpegurl" });
      response.end("#EXTM3U\nsegment.ts\n");
    };
    const result = await getSharedGlobalPlaylist(
      "global-xtream:123",
      `${origin}/live/u/p/valid-458.m3u8`,
      "/api/public/iptv/channel/123/segment",
    );
    expect(result.status).toBe(458);
    expect(result.body).toContain("/api/public/iptv/channel/123/segment?token=");
  });

  it("forwards Range and preserves a 206 response without caching it", async () => {
    let seenRange: string | undefined;
    handler = (request, response) => {
      seenRange = request.headers.range;
      response.writeHead(206, {
        "content-type": "video/mp2t",
        "content-length": "2",
        "content-range": "bytes 2-3/4",
        "accept-ranges": "bytes",
      });
      response.end(Buffer.from([0x00, 0x10]));
    };

    const result = await getSharedGlobalResourceResponse(
      "global-xtream:123",
      `${origin}/range.ts`,
      { range: "bytes=2-3" },
    );
    expect(result.kind).toBe("stream");
    if (result.kind !== "stream") throw new Error("Expected streaming range response");
    expect(seenRange).toBe("bytes=2-3");
    expect(result.resource).toMatchObject({
      status: 206,
      contentLength: "2",
      contentRange: "bytes 2-3/4",
      acceptRanges: "bytes",
    });
    expect(new Uint8Array(await new Response(result.body).arrayBuffer())).toEqual(
      new Uint8Array([0x00, 0x10]),
    );
  });

  it("detects and rewrites an opaque nested playlist by its body prefix", async () => {
    handler = (_request, response) => {
      response.writeHead(200, { "content-type": "application/octet-stream" });
      response.end('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\nchunk.ts\n');
    };

    const result = await getSharedGlobalResourceResponse(
      "global-xtream:123",
      `${origin}/opaque-resource`,
    );
    expect(result.kind).toBe("buffered");
    if (result.kind !== "buffered") throw new Error("Expected buffered nested playlist");
    expect(result.resource.contentType).toBe("application/vnd.apple.mpegurl");
    const rewritten = rewriteNestedRelayPlaylist(
      new TextDecoder().decode(result.resource.bytes),
      "global-xtream:123",
      result.resource.finalUrl,
      "/api/public/iptv/channel/123/segment",
    );
    expect(rewritten).toMatch(/URI="\/api\/public\/iptv\/channel\/123\/segment\?token=/);
    expect(rewritten).toMatch(/\/api\/public\/iptv\/channel\/123\/segment\?token=/);
    expect(rewritten).not.toContain("key.bin");
    expect(rewritten).not.toContain("chunk.ts");
  });

  it("does not cache a partial response and removes rejected in-flight state", async () => {
    let requests = 0;
    handler = (_request, response) => {
      requests += 1;
      response.writeHead(200, { "content-type": "video/mp2t", "content-length": "10" });
      if (requests === 1) {
        response.write(Buffer.from([0x47, 0x40, 0, 0, 0, 0, 0, 0]));
        response.destroy(new Error("intentional partial response"));
        return;
      }
      response.end(Buffer.from([0x47, 0x40, 0, 0, 0, 0, 0, 0, 0, 0]));
    };

    const upstream = `${origin}/partial.ts`;
    await expect(
      getSharedGlobalResourceResponse("global-xtream:123", upstream).then((result) => {
        if (result.kind !== "stream") throw new Error("Expected streaming response");
        return new Response(result.body).arrayBuffer();
      }),
    ).rejects.toBeTruthy();

    const retry = await getSharedGlobalResourceResponse("global-xtream:123", upstream);
    expect(retry.kind).toBe("stream");
    if (retry.kind !== "stream") throw new Error("Expected a new upstream stream");
    expect(new Uint8Array(await new Response(retry.body).arrayBuffer())).toHaveLength(10);
    expect(requests).toBe(2);
  });
});
