// Integration tests for the /seg upstream proxy handler.
// Covers retry-budget behavior for timeouts, 429, and 5xx, plus the 4xx fast
// path and eventual-success recovery.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Deterministic, fast retry budget for tests. Must be set BEFORE importing
// the handler so the module-scope reads (inside handler) pick them up.
process.env.IPTV_PROXY_SIGNING_KEY = "test-signing-key-for-vitest-0000000000";
process.env.SEG_PLAYLIST_MAX_ATTEMPTS = "3";
process.env.SEG_PLAYLIST_BASE_DELAY_MS = "1";
process.env.SEG_PLAYLIST_MAX_DELAY_MS = "5";
process.env.SEG_SEGMENT_MAX_ATTEMPTS = "2";
process.env.SEG_SEGMENT_BASE_DELAY_MS = "1";
process.env.SEG_SEGMENT_MAX_DELAY_MS = "5";
process.env.SEG_UPSTREAM_TIMEOUT_MS = "80";
process.env.SEG_BACKOFF_JITTER_RATIO = "0";

// The persist-to-DB path uses supabaseAdmin. Stub it so tests do not touch DB.
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: () => ({ insert: async () => ({ error: null }) }),
  },
}));

// Silence the structured JSON failure log so test output stays readable.
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

// Signing helper reuses the real key configured above.
import { signSegmentUrl } from "@/lib/iptv-proxy.server";
import { handleSegRequest } from "./tv.$tvId.seg";

const TV_ID = "00000000-0000-4000-8000-000000000001";

function makeRequest(upstreamUrl: string): Request {
  const qs = signSegmentUrl(TV_ID, upstreamUrl);
  return new Request(`https://app.test/api/sports-arena/tv/${TV_ID}/seg?${qs}`);
}

// Use distinct upstream URLs per test so the module-scope circuit breaker
// (keyed by tvId) cannot leak state between them: instead of new tvIds, we
// avoid tripping the breaker by keeping failure counts small per test. If a
// test needs many failures, we vary the tvId to keep breaker state isolated.
function playlistUrl(host: string): string {
  return `http://${host}/hls/stream.m3u8`;
}

describe("/seg — playlist retry budget", () => {
  it("returns 200 on first-attempt success (no retries)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-ENDLIST\n", { status: 200 }),
    );
    const res = await handleSegRequest(makeRequest(playlistUrl("ok-host.test")), TV_ID);
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("retries on 5xx and returns 404 after budget is exhausted", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("bad gateway", { status: 502 }));
    const res = await handleSegRequest(makeRequest(playlistUrl("5xx-host.test")), TV_ID);
    expect(res.status).toBe(404);
    // SEG_PLAYLIST_MAX_ATTEMPTS=3 → exactly 3 upstream attempts before 404.
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("retries on 429 and returns 404 after budget is exhausted", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("slow down", { status: 429 }));
    const res = await handleSegRequest(makeRequest(playlistUrl("429-host.test")), TV_ID);
    expect(res.status).toBe(404);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry on non-retryable 4xx and returns 404 after one attempt", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("bad request", { status: 400 }));
    const res = await handleSegRequest(makeRequest(playlistUrl("4xx-host.test")), TV_ID);
    expect(res.status).toBe(404);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("retries on upstream timeout (AbortError) and returns 404 after budget", async () => {
    // Simulate an upstream that never resolves within SEG_UPSTREAM_TIMEOUT_MS.
    // The handler passes an AbortSignal — reject with AbortError when it fires.
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((_input, init) => {
        return new Promise((_resolve, reject) => {
          const signal = (init as RequestInit | undefined)?.signal;
          if (signal) {
            signal.addEventListener("abort", () => {
              const err = new Error("aborted");
              (err as Error & { name: string }).name = "AbortError";
              reject(err);
            });
          }
        });
      });
    const res = await handleSegRequest(makeRequest(playlistUrl("timeout-host.test")), TV_ID);
    expect(res.status).toBe(404);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  }, 10_000);

  it("recovers on a later attempt: fails twice, then 200 (no extra retries)", async () => {
    let calls = 0;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      calls += 1;
      if (calls < 3) return new Response("upstream flaky", { status: 503 });
      return new Response("#EXTM3U\n#EXT-X-ENDLIST\n", { status: 200 });
    });
    const res = await handleSegRequest(makeRequest(playlistUrl("recover-host.test")), TV_ID);
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("returns 403 when the signed token is missing / invalid", async () => {
    const req = new Request(`https://app.test/api/sports-arena/tv/${TV_ID}/seg`);
    const res = await handleSegRequest(req, TV_ID);
    expect(res.status).toBe(403);
  });
});
