import { randomUUID } from "node:crypto";
import type { UpstreamTiming } from "@/lib/iptv-upstream.server";

export type IptvResourceKind = "playlist" | "nested_playlist" | "segment" | "key" | "init_segment";
export type IptvCacheStatus = "hit" | "miss" | "in-flight";

export function iptvRequestId(): string {
  return randomUUID();
}

export function upstreamHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "invalid";
  }
}

/** Remove URLs, bearer values, cookies, and security-token-shaped query data. */
export function redactIptvText(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value ?? "");
  return text
    .replace(/https?:\/\/[^\s"']+/gi, (raw) => {
      try {
        return `${new URL(raw).protocol}//${new URL(raw).hostname}/[redacted]`;
      } catch {
        return "[redacted-url]";
      }
    })
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(
      /\b(authorization|cookie|set-cookie|password|username|token|access|signature|sig|s)=([^\s,;&]+)/gi,
      "$1=[redacted]",
    )
    .slice(0, 500);
}

export type IptvTimingEvent = {
  requestId: string;
  tvId: string;
  kind: IptvResourceKind;
  upstreamHost: string;
  cache: IptvCacheStatus;
  upstreamStatus?: number;
  startedAt: number;
  upstreamTiming?: UpstreamTiming;
  firstDownstreamAt?: number | null;
  endedAt?: number;
  bytes?: number;
  retryCount?: number;
  clientDisconnected?: boolean;
  upstreamAborted?: boolean;
  failureCategory?: string | null;
  message?: unknown;
};

export function logIptvTiming(event: IptvTimingEvent): void {
  const failed = Boolean(event.failureCategory);
  if (!failed && process.env.IPTV_DEBUG_TIMING !== "true") return;
  const endedAt = event.endedAt ?? Date.now();
  const durationMs = Math.max(0, endedAt - event.startedAt);
  const bytes = Math.max(0, event.bytes ?? event.upstreamTiming?.bytes ?? 0);
  const bodyMs = event.upstreamTiming?.firstByteAt
    ? Math.max(1, endedAt - event.upstreamTiming.firstByteAt)
    : Math.max(1, durationMs);
  const throughputKbps = bytes ? Math.round((bytes * 8) / bodyMs) : 0;
  const record = {
    event: failed ? "iptv_request_failure" : "iptv_request_timing",
    requestId: event.requestId,
    tvId: event.tvId,
    kind: event.kind,
    upstreamHost: event.upstreamHost,
    cache: event.cache,
    upstreamStatus: event.upstreamStatus ?? null,
    headersMs: event.upstreamTiming
      ? Math.max(0, event.upstreamTiming.headersAt - event.upstreamTiming.startedAt)
      : null,
    firstUpstreamByteMs: event.upstreamTiming?.firstByteAt
      ? Math.max(0, event.upstreamTiming.firstByteAt - event.startedAt)
      : null,
    firstDownstreamByteMs: event.firstDownstreamAt
      ? Math.max(0, event.firstDownstreamAt - event.startedAt)
      : null,
    durationMs,
    bytes,
    throughputKbps,
    retryCount: event.retryCount ?? 0,
    clientDisconnected: event.clientDisconnected ?? false,
    upstreamAborted: event.upstreamAborted ?? false,
    failureCategory: event.failureCategory ?? null,
    message: event.message == null ? null : redactIptvText(event.message),
    timestamp: new Date(endedAt).toISOString(),
  };
  (failed ? console.error : console.info)(JSON.stringify(record));
}

export function iptvResponseHeaders(
  requestId: string,
  cache: IptvCacheStatus,
  timing?: UpstreamTiming,
): Record<string, string> {
  const metrics = [`app;dur=${Math.max(0, Date.now() - (timing?.startedAt ?? Date.now()))}`];
  if (timing)
    metrics.push(`upstream_headers;dur=${Math.max(0, timing.headersAt - timing.startedAt)}`);
  return {
    "X-IPTV-Request-Id": requestId,
    "X-IPTV-Cache": cache,
    "Server-Timing": metrics.join(", "),
  };
}

export function classifyResourceKind(url: string, contentType = ""): IptvResourceKind {
  const type = contentType.toLowerCase();
  let path = "";
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    /* safe fallback */
  }
  if (type.includes("mpegurl") || path.endsWith(".m3u8")) return "nested_playlist";
  if (path.endsWith(".key") || (type.includes("application/octet-stream") && /key/i.test(path)))
    return "key";
  if (path.endsWith(".mp4") || path.endsWith(".m4s") || /init/i.test(path)) return "init_segment";
  return "segment";
}
