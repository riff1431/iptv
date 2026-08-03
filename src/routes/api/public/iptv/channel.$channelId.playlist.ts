import { createFileRoute } from "@tanstack/react-router";
import { IptvRelayUpstreamError, getSharedGlobalPlaylist } from "@/lib/global-iptv-relay.server";
import { xtreamUpstreamUrl } from "@/lib/iptv-client.server";
import { getCachedGlobalIptvSettings } from "@/lib/iptv-settings-cache.server";
import { verifyRelayAccess } from "@/lib/iptv-relay-token.server";
import {
  iptvRequestId,
  iptvResponseHeaders,
  logIptvTiming,
  redactIptvText,
  upstreamHostname,
} from "@/lib/iptv-diagnostics.server";

function scopeFor(channelId: string): string {
  return `global-xtream:${channelId}`;
}

function errorResponse(status: number, message: string, requestId?: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...(requestId ? { "X-IPTV-Request-Id": requestId } : {}),
    },
  });
}

export async function handleGlobalRelayPlaylist(
  request: Request,
  channelId: string,
): Promise<Response> {
  const requestId = iptvRequestId();
  const startedAt = Date.now();
  if (!/^\d{1,20}$/.test(channelId)) {
    return errorResponse(400, "Invalid Xtream channel ID");
  }

  const scope = scopeFor(channelId);
  const access = new URL(request.url).searchParams.get("access");
  if (!verifyRelayAccess(scope, access)) {
    return errorResponse(403, "Relay access token is missing, invalid, or expired");
  }

  const settings = await getCachedGlobalIptvSettings();
  if (!settings) {
    return errorResponse(409, "Global Xtream provider is not configured or incomplete");
  }

  const upstreamUrl = xtreamUpstreamUrl(
    {
      server_url: settings.server_url,
      username: settings.username,
      password: settings.password,
      connection_type: "xtream",
    },
    channelId,
  );
  const resourcePath = `/api/public/iptv/channel/${encodeURIComponent(channelId)}/segment`;

  try {
    const playlist = await getSharedGlobalPlaylist(scope, upstreamUrl, resourcePath);
    logIptvTiming({
      requestId,
      tvId: channelId,
      kind: "playlist",
      upstreamHost: upstreamHostname(upstreamUrl),
      cache: playlist.cache,
      upstreamStatus: playlist.status,
      startedAt,
      upstreamTiming: playlist.upstreamTiming,
      firstDownstreamAt: Date.now(),
      endedAt: Date.now(),
      bytes: new TextEncoder().encode(playlist.body).byteLength,
    });
    return new Response(playlist.body, {
      status: playlist.status === 458 ? 200 : playlist.status,
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        ...iptvResponseHeaders(requestId, playlist.cache, playlist.upstreamTiming),
      },
    });
  } catch (relayError) {
    if (relayError instanceof IptvRelayUpstreamError) {
      logIptvTiming({
        requestId,
        tvId: channelId,
        kind: "playlist",
        upstreamHost: upstreamHostname(upstreamUrl),
        cache: "miss",
        startedAt,
        endedAt: Date.now(),
        failureCategory: relayError.status === 504 ? "upstream_timeout" : "upstream_http_error",
        message: relayError,
      });
      return errorResponse(relayError.status, relayError.message, requestId);
    }
    console.error("[iptv-relay] playlist failed", redactIptvText(relayError));
    logIptvTiming({
      requestId,
      tvId: channelId,
      kind: "playlist",
      upstreamHost: upstreamHostname(upstreamUrl),
      cache: "miss",
      startedAt,
      endedAt: Date.now(),
      failureCategory: "network_error",
      message: relayError,
    });
    return errorResponse(502, "IPTV relay could not load the upstream playlist", requestId);
  }
}

export const Route = createFileRoute("/api/public/iptv/channel/$channelId/playlist")({
  server: {
    handlers: {
      GET: async ({ request, params }) => handleGlobalRelayPlaylist(request, params.channelId),
    },
  },
});
