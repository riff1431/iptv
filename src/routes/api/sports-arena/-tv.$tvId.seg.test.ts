// @vitest-environment node
import http, { type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { signSegmentUrl } from "@/lib/iptv-proxy.server";
import {
  getSegmentCacheStatsForTests,
  getSharedSegment,
  resetStreamSessionForTests,
} from "@/lib/stream-session.server";
import { handleSegRequest } from "./tv.$tvId.seg";

process.env.IPTV_PROXY_SIGNING_KEY = "test-signing-key-for-vitest-0000000000";
process.env.IPTV_SEGMENT_CACHE_TTL_MS = "20000";
process.env.IPTV_SEGMENT_CACHE_ITEM_MAX_BYTES = "800000";
process.env.IPTV_SEGMENT_CACHE_TOTAL_MAX_BYTES = "1048576";
process.env.IPTV_SEGMENT_MAX_ATTEMPTS = "1";

const TV_ID = "00000000-0000-4000-8000-000000000001";
let server: Server;
let origin = "";
const calls = new Map<string, number>();
let slowEnded = false;

function count(path: string): void {
  calls.set(path, (calls.get(path) ?? 0) + 1);
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const path = req.url?.split("?")[0] ?? "/";
    count(path);
    if (path === "/slow.ts" || path === "/concurrent.ts") {
      res.writeHead(200, { "content-type": "video/mp2t", "content-length": "6" });
      res.write(Buffer.from([0x47, 1, 2]));
      setTimeout(() => {
        res.end(Buffer.from([3, 4, 5]));
        if (path === "/slow.ts") slowEnded = true;
      }, 180);
      return;
    }
    if (path === "/nested") {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end(
        '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXT-X-MAP:URI="init.mp4"\nchunk.ts\n',
      );
      return;
    }
    if (path === "/range.ts") {
      const ok = req.headers.range === "bytes=2-4";
      res.writeHead(ok ? 206 : 400, {
        "content-type": "video/mp2t",
        "content-range": "bytes 2-4/10",
        "accept-ranges": "bytes",
        "content-length": "3",
      });
      res.end("234");
      return;
    }
    if (path === "/large-a.ts" || path === "/large-b.ts") {
      const bytes = Buffer.alloc(700_000, 0x47);
      res.writeHead(200, { "content-type": "video/mp2t", "content-length": String(bytes.length) });
      res.end(bytes);
      return;
    }
    if (path === "/oversize.ts") {
      const bytes = Buffer.alloc(70_000, 0x47);
      res.writeHead(200, {
        "content-type": "video/mp2t",
        "content-length": String(bytes.length),
      });
      res.end(bytes);
      return;
    }
    if (path === "/partial.ts") {
      res.writeHead(200, { "content-type": "video/mp2t", "content-length": "10" });
      res.flushHeaders();
      res.write("abc");
      setTimeout(() => res.destroy(), 20);
      return;
    }
    if (path === "/missing.ts") {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(500).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server failed");
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  calls.clear();
  slowEnded = false;
  resetStreamSessionForTests();
});

function request(path: string, headers?: HeadersInit): Request {
  const query = signSegmentUrl(TV_ID, `${origin}${path}`);
  return new Request(`http://app.test/api/sports-arena/tv/${TV_ID}/seg?${query}`, { headers });
}

describe("Sports Arena canonical segment relay", () => {
  it("keeps the upstream credential path encrypted in browser-facing tokens", () => {
    const secretUrl = `${origin}/live/test-user/test-password/1.ts`;
    const query = signSegmentUrl(TV_ID, secretUrl);
    const encoded = new URLSearchParams(query).get("u")!;
    const decoded = Buffer.from(encoded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
      "utf8",
    );
    expect(query).not.toContain("test-user");
    expect(query).not.toContain("test-password");
    expect(decoded).not.toContain("test-user");
    expect(decoded).not.toContain("test-password");
  });

  it("delivers first route bytes before the upstream body finishes", async () => {
    const response = await handleSegRequest(request("/slow.ts"), TV_ID);
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(first.value?.byteLength).toBeGreaterThan(0);
    expect(slowEnded).toBe(false);
    await reader.read();
    await reader.read();
    expect(slowEnded).toBe(true);
  });

  it("coalesces concurrent segment demand into one upstream GET", async () => {
    const first = await handleSegRequest(request("/concurrent.ts"), TV_ID);
    const firstDownload = first.arrayBuffer();
    const secondPromise = handleSegRequest(request("/concurrent.ts"), TV_ID);
    const [firstBytes, second] = await Promise.all([firstDownload, secondPromise]);
    expect(firstBytes.byteLength).toBe(6);
    expect((await second.arrayBuffer()).byteLength).toBe(6);
    expect(second.headers.get("x-iptv-cache")).toBe("in-flight");
    expect(calls.get("/concurrent.ts")).toBe(1);
  });

  it("detects and rewrites a nested playlist without an m3u8 filename", async () => {
    const response = await handleSegRequest(request("/nested"), TV_ID);
    const text = await response.text();
    expect(response.headers.get("content-type")).toMatch(/mpegurl/);
    expect(text).toContain("#EXTM3U");
    expect(text).toMatch(/URI="\/api\/sports-arena\/tv\/.+\/seg\?/);
    expect(text).not.toContain('URI="key.bin"');
    expect(text).not.toContain("\nchunk.ts");
  });

  it("forwards Range and preserves upstream 206 headers without caching", async () => {
    const response = await handleSegRequest(request("/range.ts", { Range: "bytes=2-4" }), TV_ID);
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 2-4/10");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-length")).toBe("3");
    expect(await response.text()).toBe("234");
  });

  it("enforces a total-byte cache limit, not only an entry count", async () => {
    const a = await handleSegRequest(request("/large-a.ts"), TV_ID);
    await a.arrayBuffer();
    const b = await handleSegRequest(request("/large-b.ts"), TV_ID);
    await b.arrayBuffer();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const stats = getSegmentCacheStatsForTests();
    expect(stats.bytes).toBeLessThanOrEqual(1_048_576);
    expect(stats.entries).toBe(1);
  });

  it("does not cache a resource above the per-item byte limit", async () => {
    process.env.IPTV_SEGMENT_CACHE_ITEM_MAX_BYTES = "64000";
    try {
      const response = await handleSegRequest(request("/oversize.ts"), TV_ID);
      expect((await response.arrayBuffer()).byteLength).toBe(70_000);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(getSegmentCacheStatsForTests().entries).toBe(0);
    } finally {
      process.env.IPTV_SEGMENT_CACHE_ITEM_MAX_BYTES = "800000";
    }
  });

  it("does not cache failed/partial bodies and removes in-flight state", async () => {
    const first = await handleSegRequest(request("/partial.ts"), TV_ID);
    await expect(first.arrayBuffer()).rejects.toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(getSegmentCacheStatsForTests().inflight).toBe(0);
    const second = await handleSegRequest(request("/partial.ts"), TV_ID);
    await expect(second.arrayBuffer()).rejects.toBeTruthy();
    expect(calls.get("/partial.ts")).toBe(2);
  });

  it("keeps actual upstream 404 semantics", async () => {
    const response = await handleSegRequest(request("/missing.ts"), TV_ID);
    expect(response.status).toBe(404);
  });

  it("cleans rejected cache/in-flight entries", async () => {
    await expect(getSharedSegment(TV_ID, `${origin}/server-error.ts`)).rejects.toBeTruthy();
    expect(getSegmentCacheStatsForTests().inflight).toBe(0);
  });
});
