// Admin lifecycle controls for the shared TV stream session.
// All server functions require an authenticated admin.
//
// Uses the request-scoped Supabase client from `requireAdminServer`
// (which extends `requireSupabaseAuth`). RLS policies on `tvs`,
// `tv_stream_sessions`, and `stream_health_log` already permit
// `has_role(auth.uid(), 'admin')`, so no service-role key is required.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdminServer } from "@/lib/admin-guard";

const tvIdInput = z.object({ tvId: z.string().uuid() });
const switchInput = z.object({
  tvId: z.string().uuid(),
  channelId: z.string().min(1).max(120),
  channelName: z.string().max(120).optional(),
  channelLogo: z.string().max(2048).optional(),
  streamUrl: z.string().max(2048).optional(),
});

export const startLoungeStream = createServerFn({ method: "POST" })
  .middleware([requireAdminServer])
  .validator((d: unknown) => tvIdInput.parse(d))
  .handler(async ({ data, context }) => {
    // SELECT on `tvs` is revoked from the `authenticated` role (it was revoked
    // to protect the credential columns), so read via the service-role admin
    // client — same pattern as tvs-admin.functions.ts. This fn is already
    // admin-gated by requireAdminServer. Only the columns we actually use are
    // selected (server_url/enabled were read but never used).
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: tv, error } = await supabaseAdmin
      .from("tvs")
      .select("id, selected_channel_id")
      .eq("id", data.tvId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!tv) throw new Error("TV not found");
    if (!tv.selected_channel_id) throw new Error("Select a channel before starting");

    const { error: upsertErr } = await context.supabase.from("tv_stream_sessions").upsert(
      {
        tv_id: tv.id,
        status: "live",
        channel_id: tv.selected_channel_id,
        started_at: new Date().toISOString(),
        stopped_at: null,
        last_error: null,
      },
      { onConflict: "tv_id" },
    );
    if (upsertErr) throw new Error(upsertErr.message);

    // Evict any stale cache from a previous run.
    const { evictTvCache } = await import("@/lib/stream-session.server");
    evictTvCache(tv.id);
    return { ok: true };
  });

export const stopLoungeStream = createServerFn({ method: "POST" })
  .middleware([requireAdminServer])
  .validator((d: unknown) => tvIdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("tv_stream_sessions").upsert(
      {
        tv_id: data.tvId,
        status: "stopped",
        stopped_at: new Date().toISOString(),
      },
      { onConflict: "tv_id" },
    );
    if (error) throw new Error(error.message);

    const { evictTvCache } = await import("@/lib/stream-session.server");
    evictTvCache(data.tvId);
    return { ok: true };
  });

export const switchChannel = createServerFn({ method: "POST" })
  .middleware([requireAdminServer])
  .validator((d: unknown) => switchInput.parse(d))
  .handler(async ({ data, context }) => {
    const { error: tvErr } = await context.supabase
      .from("tvs")
      .update({
        selected_channel_id: data.channelId,
        selected_channel_name: data.channelName ?? null,
        selected_channel_logo: data.channelLogo ?? null,
        current_stream_url: data.streamUrl ?? null,
      })
      .eq("id", data.tvId);
    if (tvErr) throw new Error(tvErr.message);

    await context.supabase.from("tv_stream_sessions").upsert(
      {
        tv_id: data.tvId,
        channel_id: data.channelId,
        status: "live",
        started_at: new Date().toISOString(),
        stopped_at: null,
        last_error: null,
      },
      { onConflict: "tv_id" },
    );

    const { evictTvCache } = await import("@/lib/stream-session.server");
    evictTvCache(data.tvId);
    return { ok: true };
  });

export type StreamHealth = {
  session: {
    status: "starting" | "live" | "stopped" | "error";
    channelId: string | null;
    startedAt: string | null;
    lastPlaylistFetchAt: string | null;
    lastError: string | null;
  } | null;
  recent: Array<{
    checkedAt: string;
    status: string;
    latencyMs: number | null;
    error: string | null;
  }>;
};

export const getStreamHealth = createServerFn({ method: "GET" })
  .middleware([requireAdminServer])
  .validator((d: unknown) => tvIdInput.parse(d))
  .handler(async ({ data, context }): Promise<StreamHealth> => {
    const [{ data: session }, { data: rows }] = await Promise.all([
      context.supabase
        .from("tv_stream_sessions")
        .select("status, channel_id, started_at, last_playlist_fetch_at, last_error")
        .eq("tv_id", data.tvId)
        .maybeSingle(),
      context.supabase
        .from("stream_health_log")
        .select("checked_at, status, latency_ms, error")
        .eq("tv_id", data.tvId)
        .order("checked_at", { ascending: false })
        .limit(10),
    ]);

    return {
      session: session
        ? {
            status: session.status as "starting" | "live" | "stopped" | "error",
            channelId: session.channel_id,
            startedAt: session.started_at,
            lastPlaylistFetchAt: session.last_playlist_fetch_at,
            lastError: session.last_error,
          }
        : null,
      recent: (rows ?? []).map((r) => ({
        checkedAt: r.checked_at,
        status: r.status as string,
        latencyMs: r.latency_ms,
        error: r.error,
      })),
    };
  });
