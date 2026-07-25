// Scheduled health check for all enabled TVs. Called by pg_cron (see the SQL
// insert added alongside this route). Writes a row to `stream_health_log` and
// flips `tvs.status` based on whether the upstream playlist responds in time.
//
// Auth model: /api/public/* bypasses site-wide auth, so we verify the caller
// with the Supabase anon key via the `apikey` header, matching the cron pattern.

import { createFileRoute } from "@tanstack/react-router";

const TIMEOUT_MS = 6000;

async function checkOne(url: string): Promise<{ ok: boolean; latency: number; error: string | null; status: number }> {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    // Some IPTV servers reject HEAD; use GET but abort after first byte.
    const res = await fetch(url, {
      method: "GET",
      headers: { "User-Agent": "VLC/3.0" },
      signal: ctrl.signal,
    });
    const latency = Date.now() - t0;
    // Consume a tiny amount to release the connection quickly.
    try { await res.body?.cancel(); } catch { /* ignore */ }
    return { ok: res.ok, latency, error: res.ok ? null : `HTTP ${res.status}`, status: res.status };
  } catch (e) {
    return { ok: false, latency: Date.now() - t0, error: e instanceof Error ? e.message : "fetch failed", status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

export const Route = createFileRoute("/api/public/hooks/health-check")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey") ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!expected || apikey !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { decryptSecret } = await import("@/lib/iptv-crypto.server");
        const { resolveStreamUrl } = await import("@/lib/iptv-client.server");

        const { data: tvs, error } = await supabaseAdmin
          .from("tvs")
          .select("id, enabled, server_url, username, password, connection_type, selected_channel_id, current_stream_url")
          .eq("enabled", true);

        if (error) return new Response(error.message, { status: 500 });

        const results: Array<{ tv_id: string; status: "online" | "offline"; latency: number; error: string | null }> = [];

        for (const tv of tvs ?? []) {
          if (!tv.server_url || !tv.selected_channel_id) {
            results.push({ tv_id: tv.id, status: "offline", latency: 0, error: "not configured" });
            continue;
          }
          let upstream: string;
          try {
            upstream = resolveStreamUrl(
              {
                server_url: tv.server_url,
                username: tv.username ?? null,
                password: decryptSecret(tv.password) || null,
                connection_type: tv.connection_type as "xtream" | "m3u",
              },
              tv.selected_channel_id,
              tv.current_stream_url ?? null,
            );
          } catch (e) {
            results.push({ tv_id: tv.id, status: "offline", latency: 0, error: e instanceof Error ? e.message : "url error" });
            continue;
          }
          const check = await checkOne(upstream);
          results.push({
            tv_id: tv.id,
            status: check.ok ? "online" : "offline",
            latency: check.latency,
            error: check.error,
          });
        }

        if (results.length > 0) {
          await supabaseAdmin.from("stream_health_log").insert(
            results.map((r) => ({
              tv_id: r.tv_id,
              status: r.status,
              latency_ms: r.latency,
              error: r.error,
            })),
          );
          for (const r of results) {
            await supabaseAdmin
              .from("tvs")
              .update({
                status: r.status,
                last_status_message: r.error ?? (r.status === "online" ? `OK ${r.latency}ms` : null),
                last_checked_at: new Date().toISOString(),
              })
              .eq("id", r.tv_id);
          }
        }

        return Response.json({ checked: results.length, results });
      },
    },
  },
});
