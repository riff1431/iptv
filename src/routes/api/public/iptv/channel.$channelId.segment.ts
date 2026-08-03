import { createFileRoute } from "@tanstack/react-router";
import {
  IptvRelayUpstreamError,
  getSharedGlobalResourceResponse,
  rewriteNestedRelayPlaylist,
} from "@/lib/global-iptv-relay.server";
import { openRelayUrl } from "@/lib/iptv-relay-token.server";
import {
  classifyResourceKind,
  iptvRequestId,
  iptvResponseHeaders,
  logIptvTiming,
  redactIptvText,
  upstreamHostname,
} from "@/lib/iptv-diagnostics.server";

function scopeFor(channelId: string): string {
  return `global-xtream:${channelId}`;
}

function errorResponse(
  status: number,
  message: string,
  requestId?: string,
  retryAfter?: string,
): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...(requestId ? { "X-IPTV-Request-Id": requestId } : {}),
      ...(retryAfter ? { "Retry-After": retryAfter } : {}),
    },
  });
}

function mediaContentType(upstreamType: string, url: string): string {
  const type = upstreamType.toLowerCase();
  if (type.includes("video/") || type.includes("audio/") || type.includes("octet-stream")) {
    return upstreamType;
  }
  const path = new URL(url).pathname.toLowerCase();
  if (path.endsWith(".ts")) return "video/mp2t";
  if (path.endsWith(".m4s") || path.endsWith(".mp4")) return "video/mp4";
  if (path.endsWith(".aac")) return "audio/aac";
  if (path.endsWith(".key")) return "application/octet-stream";
  return upstreamType || "application/octet-stream";
}

export async function handleGlobalRelaySegment(
  request: Request,
  channelId: string,
): Promise<Response> {
  const requestId = iptvRequestId();
  const startedAt = Date.now();
  if (!/^\d{1,20}$/.test(channelId)) {
    return errorResponse(400, "Invalid Xtream channel ID");
  }

  const scope = scopeFor(channelId);
  const token = new URL(request.url).searchParams.get("token");
  const upstreamUrl = openRelayUrl(scope, token);
  if (!upstreamUrl) {
    return errorResponse(403, "Relay resource token is missing, invalid, or expired");
  }

  try {
    const result = await getSharedGlobalResourceResponse(scope, upstreamUrl, {
      range: request.headers.get("range"),
      signal: request.signal,
    });
    if (result.kind === "stream") {
      const reader = result.body.getReader();
      let firstDownstreamAt: number | null = null;
      let bytes = 0;
      let finished = false;
      const finish = (clientDisconnected = false, failureCategory: string | null = null) => {
        if (finished) return;
        finished = true;
        logIptvTiming({
          requestId,
          tvId: channelId,
          kind: classifyResourceKind(upstreamUrl, result.resource.contentType),
          upstreamHost: upstreamHostname(upstreamUrl),
          cache: result.cache,
          upstreamStatus: result.resource.status,
          startedAt,
          upstreamTiming: result.upstreamTiming,
          firstDownstreamAt,
          endedAt: Date.now(),
          bytes,
          clientDisconnected,
          upstreamAborted: clientDisconnected,
          failureCategory,
        });
      };
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const chunk = await reader.read();
            if (chunk.done) {
              finish();
              controller.close();
              return;
            }
            firstDownstreamAt ??= Date.now();
            bytes += chunk.value.byteLength;
            controller.enqueue(chunk.value);
          } catch (error) {
            finish(false, "upstream_stream_error");
            controller.error(error);
          }
        },
        async cancel(reason) {
          finish(true, "client_cancelled");
          await reader.cancel(reason);
        },
      });
      const meta = result.resource;
      return new Response(body, {
        status: meta.status,
        headers: {
          "Content-Type": mediaContentType(meta.contentType, meta.finalUrl),
          ...(meta.contentLength ? { "Content-Length": meta.contentLength } : {}),
          ...(meta.contentRange ? { "Content-Range": meta.contentRange } : {}),
          ...(meta.acceptRanges ? { "Accept-Ranges": meta.acceptRanges } : {}),
          ...(meta.etag ? { ETag: meta.etag } : {}),
          ...(meta.lastModified ? { "Last-Modified": meta.lastModified } : {}),
          "Cache-Control": "public, max-age=20, stale-while-revalidate=10, no-transform",
          "X-Content-Type-Options": "nosniff",
          "X-Accel-Buffering": "no",
          ...iptvResponseHeaders(requestId, result.cache, result.upstreamTiming),
        },
      });
    }

    const resource = result.resource;
    const maybePlaylist = new TextDecoder().decode(resource.bytes.subarray(0, 16_384));
    const isPlaylist =
      resource.contentType.toLowerCase().includes("mpegurl") ||
      maybePlaylist.trimStart().startsWith("#EXTM3U");

    if (isPlaylist) {
      const resourcePath = `/api/public/iptv/channel/${encodeURIComponent(channelId)}/segment`;
      const rewritten = rewriteNestedRelayPlaylist(
        new TextDecoder().decode(resource.bytes),
        scope,
        resource.finalUrl,
        resourcePath,
      );
      logIptvTiming({
        requestId,
        tvId: channelId,
        kind: "nested_playlist",
        upstreamHost: upstreamHostname(upstreamUrl),
        cache: result.cache,
        upstreamStatus: resource.status,
        startedAt,
        firstDownstreamAt: Date.now(),
        endedAt: Date.now(),
        bytes: new TextEncoder().encode(rewritten).byteLength,
      });
      return new Response(rewritten, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          ...iptvResponseHeaders(requestId, result.cache),
        },
      });
    }

    logIptvTiming({
      requestId,
      tvId: channelId,
      kind: classifyResourceKind(upstreamUrl, resource.contentType),
      upstreamHost: upstreamHostname(upstreamUrl),
      cache: result.cache,
      upstreamStatus: resource.status,
      startedAt,
      endedAt: Date.now(),
      firstDownstreamAt: Date.now(),
      bytes: resource.bytes.byteLength,
    });
    return new Response(new Uint8Array(resource.bytes).buffer as ArrayBuffer, {
      status: resource.status,
      headers: {
        "Content-Type": mediaContentType(resource.contentType, resource.finalUrl),
        "Content-Length": String(resource.bytes.byteLength),
        ...(resource.contentRange ? { "Content-Range": resource.contentRange } : {}),
        ...(resource.acceptRanges ? { "Accept-Ranges": resource.acceptRanges } : {}),
        ...(resource.etag ? { ETag: resource.etag } : {}),
        ...(resource.lastModified ? { "Last-Modified": resource.lastModified } : {}),
        "Cache-Control": "public, max-age=20, stale-while-revalidate=10, no-transform",
        "X-Content-Type-Options": "nosniff",
        ...iptvResponseHeaders(requestId, result.cache),
      },
    });
  } catch (relayError) {
    if (relayError instanceof IptvRelayUpstreamError) {
      logIptvTiming({
        requestId,
        tvId: channelId,
        kind: classifyResourceKind(upstreamUrl),
        upstreamHost: upstreamHostname(upstreamUrl),
        cache: "miss",
        startedAt,
        endedAt: Date.now(),
        failureCategory: relayError.status === 504 ? "upstream_timeout" : "upstream_http_error",
        message: relayError,
      });
      return errorResponse(
        relayError.status,
        relayError.message,
        requestId,
        relayError.status === 429 || relayError.status >= 500 ? "2" : undefined,
      );
    }
    console.error("[iptv-relay] resource failed", redactIptvText(relayError));
    logIptvTiming({
      requestId,
      tvId: channelId,
      kind: classifyResourceKind(upstreamUrl),
      upstreamHost: upstreamHostname(upstreamUrl),
      cache: "miss",
      startedAt,
      endedAt: Date.now(),
      failureCategory: "network_error",
      message: relayError,
    });
    return errorResponse(502, "IPTV relay could not load the upstream resource", requestId, "2");
  }
}

export const Route = createFileRoute("/api/public/iptv/channel/$channelId/segment")({
  server: {
    handlers: {
      GET: async ({ request, params }) => handleGlobalRelaySegment(request, params.channelId),
    },
  },
});
