// Segment proxy: verifies the HMAC-signed opaque token and returns the
// segment via the shared micro-cache. Nested playlists are rewritten so
// variant streams stay behind the proxy.

import { createFileRoute } from "@tanstack/react-router";
import {
  getXtreamPlaylistError,
  IPTV_UPSTREAM_HEADERS,
  isUsablePlaylistResponse,
} from "@/lib/iptv-upstream.server";

// ---- Circuit breaker (per-tvId, in-memory) ----------------------------------
// Protects playback by short-circuiting retries when an upstream is clearly
// unhealthy. Sliding failure window; when failures within the window meet the
// threshold, the breaker opens for a cooldown. While OPEN, requests do a
// single probe (no retries/backoff) and any failure returns 404 immediately.
// A successful probe closes the breaker (half-open → closed).
const BREAKER = {
  windowMs: 10_000, // sliding window for counting failures
  threshold: 5, // failures within window to trip
  openMs: 15_000, // cooldown before half-open probe
} as const;

type BreakerState = { failures: number[]; openUntil: number };
const breakerByTv = new Map<string, BreakerState>();

function getBreaker(tvId: string): BreakerState {
  let s = breakerByTv.get(tvId);
  if (!s) {
    s = { failures: [], openUntil: 0 };
    breakerByTv.set(tvId, s);
  }
  return s;
}
function isBreakerOpen(tvId: string): boolean {
  return getBreaker(tvId).openUntil > Date.now();
}
function recordBreakerFailure(tvId: string): boolean {
  const s = getBreaker(tvId);
  const now = Date.now();
  s.failures = s.failures.filter((t) => now - t < BREAKER.windowMs);
  s.failures.push(now);
  if (s.failures.length >= BREAKER.threshold) {
    s.openUntil = now + BREAKER.openMs;
    s.failures = [];
    return true;
  }
  return false;
}
function recordBreakerSuccess(tvId: string): void {
  const s = getBreaker(tvId);
  s.failures = [];
  s.openUntil = 0;
}

export const Route = createFileRoute("/api/sports-arena/tv/$tvId/seg")({
  server: {
    handlers: {
      GET: async ({ request, params }) => handleSegRequest(request, params.tvId),
    },
  },
});

// Exported for integration tests. Contains all upstream fetch / retry / breaker
// logic; the route handler is a thin delegate so the same code path is exercised.
export async function handleSegRequest(request: Request, tvId: string): Promise<Response> {
  const url = new URL(request.url);
  const { verifySegmentToken, rewritePlaylist } = await import("@/lib/iptv-proxy.server");
  const upstreamUrl = verifySegmentToken(
    tvId,
    url.searchParams.get("u"),
    url.searchParams.get("e"),
    url.searchParams.get("s"),
  );
  if (!upstreamUrl) return new Response("Forbidden", { status: 403 });

  const upstreamHost = (() => {
    try {
      return new URL(upstreamUrl).host;
    } catch {
      return "unknown";
    }
  })();
  const isPlaylist = upstreamUrl.toLowerCase().split("?")[0].endsWith(".m3u8");
  const kind = isPlaylist ? "playlist" : "segment";

  const logFailure = (fields: {
    reason: "timeout" | "non_ok" | "network_error" | "exception";
    status?: number;
    statusText?: string;
    durationMs: number;
    message?: string;
    attempts?: number;
  }) => {
    // Structured single-line JSON log — greppable in worker logs.
    console.error(
      JSON.stringify({
        event: "seg_upstream_failure",
        kind,
        tvId: tvId,
        upstreamHost,
        reason: fields.reason,
        status: fields.status ?? null,
        statusText: fields.statusText ?? null,
        durationMs: fields.durationMs,
        attempts: fields.attempts ?? 1,
        message: fields.message ?? null,
        ts: new Date().toISOString(),
      }),
    );
    // Persist for the metrics dashboard (fire-and-forget).
    void (async () => {
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        await supabaseAdmin.from("seg_upstream_failures").insert({
          tv_id: tvId,
          kind,
          reason: fields.reason,
          status: fields.status ?? null,
          upstream_host: upstreamHost,
          duration_ms: Math.max(0, Math.round(fields.durationMs)),
          attempts: Math.max(1, fields.attempts ?? 1),
          succeeded: false,
          message: (fields.message ?? fields.statusText ?? "").slice(0, 500) || null,
        });
      } catch {
        // Metrics persistence must never break playback.
      }
    })();
  };

  // Log a successful upstream fetch that required more than one attempt,
  // so the dashboard can compute the "eventually succeeded" rate.
  const logRecovery = (fields: { durationMs: number; attempts: number }) => {
    if (fields.attempts <= 1) return;
    void (async () => {
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        await supabaseAdmin.from("seg_upstream_failures").insert({
          tv_id: tvId,
          kind,
          reason: "success",
          status: 200,
          upstream_host: upstreamHost,
          duration_ms: Math.max(0, Math.round(fields.durationMs)),
          attempts: fields.attempts,
          succeeded: true,
          message: null,
        });
      } catch {
        // Metrics persistence must never break playback.
      }
    })();
  };

  // Tunable via environment variables (read per-request; env is
  // injected at call time on the Worker). All values are clamped to
  // safe ranges so a bad env value cannot break playback.
  const envNum = (name: string, def: number, min: number, max: number) => {
    const raw = process.env[name];
    if (!raw) return def;
    const n = Number(raw);
    if (!Number.isFinite(n)) return def;
    return Math.min(max, Math.max(min, n));
  };
  const UPSTREAM_TIMEOUT_MS = envNum("SEG_UPSTREAM_TIMEOUT_MS", 10_000, 500, 60_000);
  const JITTER_RATIO = envNum("SEG_BACKOFF_JITTER_RATIO", 0.3, 0, 1);
  const playlistAttempts = envNum("SEG_PLAYLIST_MAX_ATTEMPTS", 3, 1, 10);
  const playlistBase = envNum("SEG_PLAYLIST_BASE_DELAY_MS", 150, 0, 10_000);
  const playlistCap = envNum("SEG_PLAYLIST_MAX_DELAY_MS", 1_000, 0, 30_000);
  const segmentAttempts = envNum("SEG_SEGMENT_MAX_ATTEMPTS", 2, 1, 10);
  const segmentBase = envNum("SEG_SEGMENT_BASE_DELAY_MS", 120, 0, 10_000);
  const segmentCap = envNum("SEG_SEGMENT_MAX_DELAY_MS", 400, 0, 30_000);

  const breakerOpen = isBreakerOpen(tvId);
  // While OPEN, allow only a single probe attempt (half-open behavior).
  const RETRY = {
    playlist: {
      maxAttempts: breakerOpen ? 1 : playlistAttempts,
      baseDelayMs: playlistBase,
      maxDelayMs: playlistCap,
    },
    segment: {
      maxAttempts: breakerOpen ? 1 : segmentAttempts,
      baseDelayMs: segmentBase,
      maxDelayMs: segmentCap,
    },
  } as const;

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const backoffDelay = (attempt: number, base: number, cap: number) => {
    const exp = Math.min(cap, base * 2 ** (attempt - 1));
    const jitter = exp * (Math.random() * 2 * JITTER_RATIO - JITTER_RATIO);
    return Math.max(0, Math.round(exp + jitter));
  };
  // Retry only on transient upstream problems, never on 4xx (except 429).
  const isRetryableStatus = (status: number) => status === 429 || (status >= 500 && status <= 599);

  if (isPlaylist) {
    const overallStart = Date.now();
    let lastFailure: {
      reason: "timeout" | "non_ok" | "network_error";
      status?: number;
      statusText?: string;
      message?: string;
    } | null = null;

    for (let attempt = 1; attempt <= RETRY.playlist.maxAttempts; attempt++) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS);
      try {
        const upstream = await fetch(upstreamUrl, {
          headers: IPTV_UPSTREAM_HEADERS,
          signal: ac.signal,
        });
        const text = await upstream.text();
        const xtreamError = getXtreamPlaylistError(upstream.status, text);
        if (xtreamError) {
          const tripped = recordBreakerFailure(tvId);
          logFailure({
            reason: "non_ok",
            status: upstream.status,
            statusText: upstream.statusText,
            durationMs: Date.now() - overallStart,
            attempts: attempt,
            message: xtreamError,
          });
          return new Response(xtreamError, {
            status: 429,
            headers: {
              "Cache-Control": "no-store",
              "Retry-After": "10",
            },
          });
        }
        if (isUsablePlaylistResponse(upstream.status, text)) {
          recordBreakerSuccess(tvId);
          logRecovery({ durationMs: Date.now() - overallStart, attempts: attempt });
          const rewritten = rewritePlaylist(
            text,
            tvId,
            upstream.url || upstreamUrl,
            `/api/sports-arena/tv/${tvId}/seg`,
          );
          return new Response(rewritten, {
            status: 200,
            headers: {
              "Content-Type": "application/vnd.apple.mpegurl",
              "Cache-Control": "no-store",
            },
          });
        }
        lastFailure = {
          reason: "non_ok",
          status: upstream.status,
          statusText: upstream.statusText,
          message: "Invalid HLS manifest response",
        };
        // Non-retryable 4xx — bail immediately.
        if (!isRetryableStatus(upstream.status)) {
          const tripped = recordBreakerFailure(tvId);
          logFailure({
            ...lastFailure,
            durationMs: Date.now() - overallStart,
            attempts: attempt,
            message:
              `${lastFailure.statusText ?? ""}${breakerOpen ? " [breaker:open]" : ""}${tripped ? " [breaker:tripped]" : ""}`.trim() ||
              undefined,
          });
          return new Response("Upstream unavailable", {
            status: 404,
            headers: { "Cache-Control": "no-store" },
          });
        }
      } catch (err) {
        const aborted = (err as { name?: string } | null)?.name === "AbortError";
        lastFailure = {
          reason: aborted ? "timeout" : "network_error",
          message: err instanceof Error ? err.message : String(err),
        };
      } finally {
        clearTimeout(timer);
      }

      if (attempt < RETRY.playlist.maxAttempts) {
        await sleep(backoffDelay(attempt, RETRY.playlist.baseDelayMs, RETRY.playlist.maxDelayMs));
      }
    }

    const tripped = recordBreakerFailure(tvId);
    logFailure({
      reason: lastFailure?.reason ?? "network_error",
      status: lastFailure?.status,
      statusText: lastFailure?.statusText,
      message:
        `${lastFailure?.message ?? ""}${breakerOpen ? " [breaker:open]" : ""}${tripped ? " [breaker:tripped]" : ""}`.trim() ||
        undefined,
      durationMs: Date.now() - overallStart,
      attempts: RETRY.playlist.maxAttempts,
    });
    return new Response("Upstream unavailable", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const { getSharedSegment } = await import("@/lib/stream-session.server");
  const overallStart = Date.now();
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= RETRY.segment.maxAttempts; attempt++) {
    try {
      const { bytes, contentType } = await getSharedSegment(tvId, upstreamUrl);
      recordBreakerSuccess(tvId);
      logRecovery({ durationMs: Date.now() - overallStart, attempts: attempt });
      return new Response(new Uint8Array(bytes).buffer as ArrayBuffer, {
        status: 200,
        headers: {
          "Content-Type": contentType || "video/mp2t",
          "Cache-Control": "public, max-age=10",
        },
      });
    } catch (err) {
      lastErr = err;
      if (attempt < RETRY.segment.maxAttempts) {
        await sleep(backoffDelay(attempt, RETRY.segment.baseDelayMs, RETRY.segment.maxDelayMs));
      }
    }
  }

  const name = (lastErr as { name?: string } | null)?.name;
  const message = lastErr instanceof Error ? lastErr.message : String(lastErr);
  const reason: "timeout" | "exception" =
    name === "AbortError" || /timeout/i.test(message) ? "timeout" : "exception";
  const tripped = recordBreakerFailure(tvId);
  logFailure({
    reason,
    durationMs: Date.now() - overallStart,
    message: `${message}${breakerOpen ? " [breaker:open]" : ""}${tripped ? " [breaker:tripped]" : ""}`,
    attempts: RETRY.segment.maxAttempts,
  });
  // Skip this segment gracefully — hls.js treats 404 as "segment gap"
  // and continues playback instead of erroring out.
  return new Response("Segment unavailable", {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });
}
