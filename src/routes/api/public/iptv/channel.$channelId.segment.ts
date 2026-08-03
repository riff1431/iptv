import { createFileRoute } from "@tanstack/react-router";
import {
  IptvRelayUpstreamError,
  getSharedGlobalResourceResponse,
  rewriteNestedRelayPlaylist,
} from "@/lib/global-iptv-relay.server";
import { openRelayUrl } from "@/lib/iptv-relay-token.server";
import { redactIptvText } from "@/lib/iptv-diagnostics.server";

function scopeFor(channelId: string): string {
  return `global-xtream:${channelId}`;
}

function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
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
    const result = await getSharedGlobalResourceResponse(scope, upstreamUrl);
    if (result.kind === "stream") {
      return new Response(result.body, {
        status: 200,
        headers: {
          "Content-Type": mediaContentType(result.contentType, result.finalUrl),
          "Cache-Control": "public, max-age=15, immutable",
          "X-Accel-Buffering": "no",
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
      return new Response(rewritten, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }

    return new Response(new Uint8Array(resource.bytes).buffer as ArrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": mediaContentType(resource.contentType, resource.finalUrl),
        "Cache-Control": "public, max-age=15, immutable",
      },
    });
  } catch (relayError) {
    if (relayError instanceof IptvRelayUpstreamError) {
      return errorResponse(relayError.status, relayError.message);
    }
    console.error("[iptv-relay] resource failed", redactIptvText(relayError));
    return errorResponse(502, "IPTV relay could not load the upstream resource");
  }
}

export const Route = createFileRoute("/api/public/iptv/channel/$channelId/segment")({
  server: {
    handlers: {
      GET: async ({ request, params }) => handleGlobalRelaySegment(request, params.channelId),
    },
  },
});
