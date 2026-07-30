// Playlist proxy: serves the shared per-TV rewritten playlist.
// Every viewer request returns the same cached body within the TTL, so the
// IPTV provider sees ~1 upstream poll per target-duration regardless of
// viewer count. Refuses when the admin has stopped the stream.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/sports-arena/tv/$tvId/playlist")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const authHeader = request.headers.get("authorization");
        if (!authHeader?.startsWith("Bearer ")) {
          return new Response("Unauthorized", { status: 401 });
        }
        const token = authHeader.slice("Bearer ".length);
        if (token.split(".").length !== 3) {
          return new Response("Unauthorized", { status: 401 });
        }

        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
          return new Response("Server misconfigured", { status: 500 });
        }

        const { createClient } = await import("@supabase/supabase-js");
        const anon = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
        });
        const { data: userData, error: userErr } = await anon.auth.getUser(token);
        if (userErr || !userData?.user) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: tv, error } = await supabaseAdmin
          .from("tvs")
          .select(
            "id, enabled, server_url, username, password, connection_type, selected_channel_id, current_stream_url",
          )
          .eq("id", params.tvId)
          .maybeSingle();
        if (error) return new Response(error.message, { status: 500 });
        if (!tv || !tv.enabled) return new Response("TV unavailable", { status: 404 });
        // A channel must be selected. server_url is optional: when a TV has no
        // per-TV credentials, getSharedPlaylist -> credsFor falls back to the
        // global IPTV provider (app_settings). Requiring server_url here would
        // wrongly 409 the common global-Xtream-TV case.
        if (!tv.selected_channel_id) {
          return new Response("TV not configured", { status: 409 });
        }

        if (process.env.DISABLE_IPTV_PROXY === "true") {
          const { credsFor } = await import("@/lib/stream-session.server");
          const { xtreamUpstreamUrl, resolveStreamUrl } = await import("@/lib/iptv-client.server");
          try {
            const creds = await credsFor(tv);
            const upstreamUrl =
              creds.connection_type === "xtream"
                ? xtreamUpstreamUrl(creds, tv.selected_channel_id)
                : resolveStreamUrl(creds, tv.selected_channel_id, tv.current_stream_url ?? null);
            
            return new Response(null, {
              status: 302,
              headers: {
                "Location": upstreamUrl,
                "Cache-Control": "no-store",
              },
            });
          } catch (e) {
            const msg = e instanceof Error ? e.message : "Redirect error";
            return new Response(msg, { status: 500 });
          }
        }

        // Respect admin lifecycle: refuse when the shared session is stopped.
        const { data: session } = await supabaseAdmin
          .from("tv_stream_sessions")
          .select("status")
          .eq("tv_id", tv.id)
          .maybeSingle();
        if (session?.status === "stopped") {
          return new Response("Stream stopped by admin", { status: 409 });
        }

        const { getSharedPlaylist } = await import("@/lib/stream-session.server");
        const started = Date.now();
        try {
          const { rewritten } = await getSharedPlaylist(
            tv,
            `/api/sports-arena/tv/${tv.id}/seg`,
          );
          // Best-effort telemetry — never block the response.
          void supabaseAdmin
            .from("tv_stream_sessions")
            .update({
              status: "live",
              last_playlist_fetch_at: new Date().toISOString(),
              last_error: null,
            })
            .eq("tv_id", tv.id);
          void supabaseAdmin.from("stream_health_log").insert({
            tv_id: tv.id,
            status: "online",
            latency_ms: Date.now() - started,
          });
          return new Response(rewritten, {
            status: 200,
            headers: {
              "Content-Type": "application/vnd.apple.mpegurl",
              "Cache-Control": "no-store",
            },
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Upstream error";
          void supabaseAdmin
            .from("tv_stream_sessions")
            .update({ status: "error", last_error: msg })
            .eq("tv_id", tv.id);
          void supabaseAdmin.from("stream_health_log").insert({
            tv_id: tv.id,
            status: "error",
            latency_ms: Date.now() - started,
            error: msg,
          });
          return new Response(msg, { status: 502 });
        }
      },
    },
  },
});
