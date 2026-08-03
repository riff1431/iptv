import { createHash } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import type { TvRowForStream } from "@/lib/stream-session.server";
import {
  iptvRequestId,
  iptvResponseHeaders,
  logIptvTiming,
  redactIptvText,
  upstreamHostname,
} from "@/lib/iptv-diagnostics.server";

type Timed<T> = { value: T; expiresAt: number };
const authCache = new Map<string, Timed<true>>();
const tvCache = new Map<string, Timed<TvRowForStream>>();
const sessionCache = new Map<string, Timed<string | null>>();
const successfulTelemetryAt = new Map<string, number>();
const MAX_CACHE_ENTRIES = 500;

function putBounded<K, V>(map: Map<K, V>, key: K, value: V): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > MAX_CACHE_ENTRIES) map.delete(map.keys().next().value as K);
}

function getFresh<K, V>(map: Map<K, Timed<V>>, key: K): V | undefined {
  const entry = map.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    map.delete(key);
    return undefined;
  }
  map.delete(key);
  map.set(key, entry);
  return entry.value;
}

function safeErrorResponse(message: string, status: number, requestId: string): Response {
  return new Response(message, {
    status,
    headers: { "Cache-Control": "no-store", "X-IPTV-Request-Id": requestId },
  });
}

async function validateBearer(token: string): Promise<boolean> {
  const key = createHash("sha256").update(token).digest("base64url");
  if (getFresh(authCache, key)) return true;
  const url = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) throw new Error("Supabase authentication is not configured");
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return false;
  putBounded(authCache, key, { value: true, expiresAt: Date.now() + 20_000 });
  return true;
}

async function getTv(tvId: string): Promise<TvRowForStream | null> {
  const cached = getFresh(tvCache, tvId);
  if (cached) return cached;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("tvs")
    .select(
      "id, enabled, server_url, username, password, connection_type, selected_channel_id, current_stream_url",
    )
    .eq("id", tvId)
    .maybeSingle();
  if (error) throw new Error("TV configuration lookup failed");
  if (!data) return null;
  const tv = data as TvRowForStream;
  putBounded(tvCache, tvId, { value: tv, expiresAt: Date.now() + 5_000 });
  return tv;
}

async function getSessionStatus(tvId: string): Promise<string | null> {
  const cached = getFresh(sessionCache, tvId);
  if (cached !== undefined) return cached;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("tv_stream_sessions")
    .select("status")
    .eq("tv_id", tvId)
    .maybeSingle();
  if (error) throw new Error("Stream session lookup failed");
  const status = data?.status ?? null;
  putBounded(sessionCache, tvId, { value: status, expiresAt: Date.now() + 3_000 });
  return status;
}

async function recordTelemetry(
  tvId: string,
  status: "online" | "error",
  latencyMs: number,
  error?: unknown,
): Promise<void> {
  const now = Date.now();
  if (status === "online" && now - (successfulTelemetryAt.get(tvId) ?? 0) < 30_000) return;
  if (status === "online") putBounded(successfulTelemetryAt, tvId, now);
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const safeMessage = error == null ? null : redactIptvText(error);
    await Promise.all([
      supabaseAdmin
        .from("tv_stream_sessions")
        .update({
          status: status === "online" ? "live" : "error",
          ...(status === "online" ? { last_playlist_fetch_at: new Date().toISOString() } : {}),
          last_error: safeMessage,
        })
        .eq("tv_id", tvId),
      supabaseAdmin.from("stream_health_log").insert({
        tv_id: tvId,
        status,
        latency_ms: Math.max(0, Math.round(latencyMs)),
        ...(safeMessage ? { error: safeMessage } : {}),
      }),
    ]);
  } catch {
    // Playback must not depend on telemetry persistence.
  }
}

export async function handlePlaylistRequest(request: Request, tvId: string): Promise<Response> {
  const requestId = iptvRequestId();
  const startedAt = Date.now();
  const authStarted = Date.now();
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return safeErrorResponse("Unauthorized", 401, requestId);
  const token = authHeader.slice("Bearer ".length);
  if (token.split(".").length !== 3) return safeErrorResponse("Unauthorized", 401, requestId);

  try {
    if (!(await validateBearer(token))) return safeErrorResponse("Unauthorized", 401, requestId);
  } catch (error) {
    logIptvTiming({
      requestId,
      tvId,
      kind: "playlist",
      upstreamHost: "none",
      cache: "miss",
      startedAt,
      endedAt: Date.now(),
      failureCategory: "auth_service_error",
      message: error,
    });
    return safeErrorResponse("Authentication service unavailable", 503, requestId);
  }
  const authMs = Date.now() - authStarted;

  if (process.env.DISABLE_IPTV_PROXY === "true") {
    logIptvTiming({
      requestId,
      tvId,
      kind: "playlist",
      upstreamHost: "none",
      cache: "miss",
      startedAt,
      endedAt: Date.now(),
      failureCategory: "proxy_disabled",
      message: "DISABLE_IPTV_PROXY must remain false in production",
    });
    return safeErrorResponse("IPTV proxy is required", 503, requestId);
  }

  try {
    const [tv, sessionStatus] = await Promise.all([getTv(tvId), getSessionStatus(tvId)]);
    if (!tv || !tv.enabled) return safeErrorResponse("TV unavailable", 404, requestId);
    if (!tv.selected_channel_id) return safeErrorResponse("TV not configured", 409, requestId);
    if (sessionStatus === "stopped")
      return safeErrorResponse("Stream stopped by admin", 409, requestId);

    const { getSharedPlaylist } = await import("@/lib/stream-session.server");
    const result = await getSharedPlaylist(tv, `/api/sports-arena/tv/${tv.id}/seg`);
    void recordTelemetry(tv.id, "online", Date.now() - startedAt);
    logIptvTiming({
      requestId,
      tvId,
      kind: "playlist",
      upstreamHost: upstreamHostname(result.upstreamUrl),
      cache: result.cache,
      upstreamStatus: result.upstreamStatus,
      startedAt,
      upstreamTiming: result.timing,
      firstDownstreamAt: Date.now(),
      endedAt: Date.now(),
      bytes: Buffer.byteLength(result.rewritten),
    });
    const headers = new Headers({
      "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
      "Cache-Control": "no-store",
      ...iptvResponseHeaders(requestId, result.cache, result.timing),
    });
    headers.set("Server-Timing", `${headers.get("Server-Timing")}, auth;dur=${authMs}`);
    return new Response(result.rewritten, { status: 200, headers });
  } catch (error) {
    void recordTelemetry(tvId, "error", Date.now() - startedAt, error);
    const status = (error as { status?: number } | null)?.status === 429 ? 429 : 502;
    logIptvTiming({
      requestId,
      tvId,
      kind: "playlist",
      upstreamHost: "redacted",
      cache: "miss",
      startedAt,
      endedAt: Date.now(),
      failureCategory: status === 429 ? "connection_limit" : "playlist_failure",
      message: error,
    });
    return new Response(
      status === 429 ? "Provider connection limit reached" : "Temporary upstream failure",
      {
        status,
        headers: {
          "Cache-Control": "no-store",
          "X-IPTV-Request-Id": requestId,
          ...(status === 429 ? { "Retry-After": "10" } : { "Retry-After": "2" }),
        },
      },
    );
  }
}

export function resetPlaylistRouteCachesForTests(): void {
  authCache.clear();
  tvCache.clear();
  sessionCache.clear();
  successfulTelemetryAt.clear();
}

export const Route = createFileRoute("/api/sports-arena/tv/$tvId/playlist")({
  server: {
    handlers: { GET: async ({ request, params }) => handlePlaylistRequest(request, params.tvId) },
  },
});
