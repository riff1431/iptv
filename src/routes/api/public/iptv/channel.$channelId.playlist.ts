import { createFileRoute } from "@tanstack/react-router";
import { IptvRelayUpstreamError, getSharedGlobalPlaylist } from "@/lib/global-iptv-relay.server";
import { xtreamUpstreamUrl } from "@/lib/iptv-client.server";
import { decryptSecret } from "@/lib/iptv-crypto.server";
import { verifyRelayAccess } from "@/lib/iptv-relay-token.server";

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

export async function handleGlobalRelayPlaylist(
  request: Request,
  channelId: string,
): Promise<Response> {
  if (!/^\d{1,20}$/.test(channelId)) {
    return errorResponse(400, "Invalid Xtream channel ID");
  }

  const scope = scopeFor(channelId);
  const access = new URL(request.url).searchParams.get("access");
  if (!verifyRelayAccess(scope, access)) {
    return errorResponse(403, "Relay access token is missing, invalid, or expired");
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: row, error } = await supabaseAdmin
    .from("app_settings")
    .select(
      "iptv_provider_type, iptv_xtream_server_url, iptv_xtream_username, iptv_xtream_password_encrypted",
    )
    .eq("id", true)
    .maybeSingle();

  if (error) return errorResponse(500, "Could not load IPTV provider settings");
  if (!row || row.iptv_provider_type !== "xtream" || !row.iptv_xtream_server_url) {
    return errorResponse(409, "Global Xtream provider is not configured");
  }

  const password = decryptSecret(row.iptv_xtream_password_encrypted);
  if (!row.iptv_xtream_username || !password) {
    return errorResponse(409, "Global Xtream credentials are incomplete");
  }

  const upstreamUrl = xtreamUpstreamUrl(
    {
      server_url: row.iptv_xtream_server_url,
      username: row.iptv_xtream_username,
      password,
      connection_type: "xtream",
    },
    channelId,
  );
  const resourcePath = `/api/public/iptv/channel/${encodeURIComponent(channelId)}/segment`;

  try {
    const playlist = await getSharedGlobalPlaylist(scope, upstreamUrl, resourcePath);
    return new Response(playlist, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (relayError) {
    if (relayError instanceof IptvRelayUpstreamError) {
      return errorResponse(relayError.status, relayError.message);
    }
    console.error("[iptv-relay] playlist failed", relayError);
    return errorResponse(502, "IPTV relay could not load the upstream playlist");
  }
}

export const Route = createFileRoute("/api/public/iptv/channel/$channelId/playlist")({
  server: {
    handlers: {
      GET: async ({ request, params }) => handleGlobalRelayPlaylist(request, params.channelId),
    },
  },
});
