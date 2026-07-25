import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdminServer } from "@/lib/admin-guard";

/** Strip username:password from a URL so it's safe to log/display. */
function redactUrlCreds(input: string): string {
  try {
    const u = new URL(input);
    if (u.username || u.password) {
      u.username = "***";
      u.password = "***";
    }
    // Redact common credential query params (Xtream-style playlist links).
    for (const key of ["username", "password", "token", "auth", "key"]) {
      if (u.searchParams.has(key)) u.searchParams.set(key, "***");
    }
    return u.toString();
  } catch {
    return input;
  }
}


export interface IptvChannelDTO {
  id: string;
  name: string;
  logo: string | null;
  group: string | null;
}

const testInput = z.object({
  server_url: z.string().url().max(2048),
  username: z.string().max(255).nullable().optional(),
  password: z.string().max(1024).nullable().optional(),
  connection_type: z.enum(["xtream", "m3u"]),
});

/**
 * Test IPTV credentials without persisting anything. Called from the admin
 * TV editor before saving. Returns a categorized code so the UI can render
 * a specific error class (invalid URL, unreachable, auth failure, empty
 * subscription, upstream error).
 */
export const testIptvConnection = createServerFn({ method: "POST" })
  .middleware([requireAdminServer])
  .inputValidator((d: unknown) => testInput.parse(d))
  .handler(
    async ({
      data,
    }): Promise<{
      ok: boolean;
      code:
        | "ok"
        | "invalid_url"
        | "unreachable"
        | "auth_failed"
        | "no_channels"
        | "upstream_error";
      message: string;
      channelCount?: number;
    }> => {
      const { testConnection } = await import("@/lib/iptv-client.server");
      const res = await testConnection({
        server_url: data.server_url,
        username: data.username ?? null,
        password: data.password ?? null,
        connection_type: data.connection_type,
      });
      return {
        ok: res.ok,
        code: res.code,
        message: res.message,
        channelCount: res.channelCount,
      };
    },
  );

const fetchInput = z.object({ tvId: z.string().uuid() });

/**
 * Fetch the channel list for a saved TV, cache it in iptv_channels_cache,
 * and return the caller a channel DTO list for the picker UI. Never returns
 * upstream stream URLs — those are constructed server-side only.
 */
export const fetchIptvChannelsForTv = createServerFn({ method: "POST" })
  .middleware([requireAdminServer])
  .inputValidator((d: unknown) => fetchInput.parse(d))
  .handler(async ({ data }): Promise<IptvChannelDTO[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { fetchChannels } = await import("@/lib/iptv-client.server");
    const { decryptSecret } = await import("@/lib/iptv-crypto.server");

    const { data: tv, error } = await supabaseAdmin
      .from("tvs")
      .select("id, server_url, username, password, connection_type")
      .eq("id", data.tvId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!tv?.server_url) throw new Error("TV has no server URL configured");

    const channels = await fetchChannels({
      server_url: tv.server_url,
      username: tv.username ?? null,
      password: decryptSecret(tv.password) || null,
      connection_type: tv.connection_type as "xtream" | "m3u",
    }).catch((err: unknown) => {
      const raw = err instanceof Error ? err.message : String(err);
      const safeUrl = redactUrlCreds(tv.server_url!);
      const who = tv.username ? ` (user: ${tv.username})` : "";
      const isAuth = /Upstream 40[13]/i.test(raw);
      if (isAuth) {
        throw new Error(
          `IPTV upstream rejected the ${tv.connection_type} playlist for TV ${tv.id}${who}.\n` +
            `URL: ${safeUrl}\n${raw}\n\n` +
            `Action: open this TV in the admin editor, paste a fresh playlist URL from your provider, and save. ` +
            `M3U links commonly expire or rotate their embedded credentials.`,
        );
      }
      throw new Error(
        `IPTV fetch failed for TV ${tv.id}${who}.\nURL: ${safeUrl}\n${raw}`,
      );
    });


    // Upsert into cache. iptv_channels_cache columns:
    // (tv_id, channel_id, name, logo, group_title, updated_at)
    if (channels.length) {
      // Wipe old cache for this TV first to prevent stale entries.
      await supabaseAdmin.from("iptv_channels_cache").delete().eq("tv_id", tv.id);
      await supabaseAdmin.from("iptv_channels_cache").insert(
        channels.map((c) => ({
          tv_id: tv.id,
          channel_id: c.id,
          name: c.name,
          logo_url: c.logo,
          category: c.group,
        })),
      );
    }

    return channels;
  });

const previewInput = z.object({
  tvId: z.string().uuid(),
  channelId: z.string().min(1).max(255),
});

/**
 * Resolve a playable stream URL for a specific channel on a saved TV so the
 * admin can preview it before final selection. Admin-only.
 *
 * Xtream: URL is derived from credentials and returned directly. It contains
 * user/pass — acceptable because only the admin who owns those credentials
 * ever sees it.
 * M3U: the channel entry IS the URL; we look it up in `iptv_channels_cache`
 * (populated by fetchIptvChannelsForTv). We only ship `stream_url` back when
 * present in the cache; otherwise return an error the UI can surface.
 */
export const getChannelPreviewUrl = createServerFn({ method: "POST" })
  .middleware([requireAdminServer])
  .inputValidator((d: unknown) => previewInput.parse(d))
  .handler(async ({ data }): Promise<{ url: string }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { xtreamStreamUrl } = await import("@/lib/iptv-client.server");
    const { decryptSecret } = await import("@/lib/iptv-crypto.server");

    const { data: tv, error } = await supabaseAdmin
      .from("tvs")
      .select("id, server_url, username, password, connection_type")
      .eq("id", data.tvId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!tv?.server_url) throw new Error("TV has no server URL configured");

    if (tv.connection_type === "xtream") {
      const url = xtreamStreamUrl(
        {
          server_url: tv.server_url,
          username: tv.username ?? null,
          password: decryptSecret(tv.password) || null,
          connection_type: "xtream",
        },
        data.channelId,
      );
      return { url };
    }

    // M3U: look up the URL from cache. iptv_channels_cache doesn't currently
    // store stream_url per row, so surface a friendly message for now.
    throw new Error(
      "Preview isn't available for M3U playlists yet — save this channel and use the TV preview instead.",
    );
  });


const saveInput = z.object({
  id: z.string().uuid().optional(),
  lounge_id: z.string().uuid(),
  slot: z.number().int().min(1).max(16),
  display_name: z.string().max(120).nullable().optional(),
  provider_name: z.string().max(120).nullable().optional(),
  server_url: z.string().url().max(2048).nullable().optional(),
  username: z.string().max(255).nullable().optional(),
  password: z.string().max(1024).nullable().optional(), // plaintext from form; encrypted here
  connection_type: z.enum(["xtream", "m3u", "hls"]),
  selected_channel_id: z.string().max(255).nullable().optional(),
  selected_channel_name: z.string().max(255).nullable().optional(),
  selected_channel_logo: z.string().max(2048).nullable().optional(),
  enabled: z.boolean().optional(),
});

/**
 * Persist a TV row. Encrypts `password` at rest and only updates it when the
 * caller sends a non-empty value (so opening the editor and saving without
 * re-typing does not blank the stored password).
 */
export const saveTv = createServerFn({ method: "POST" })
  .middleware([requireAdminServer])
  .inputValidator((d: unknown) => saveInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { encryptSecret } = await import("@/lib/iptv-crypto.server");

    const now = new Date().toISOString();
    type TvPatch = {
      lounge_id: string;
      slot: number;
      display_name: string | null;
      provider_name: string | null;
      server_url: string | null;
      username: string | null;
      connection_type: "xtream" | "m3u" | "hls";
      selected_channel_id: string | null;
      selected_channel_name: string | null;
      selected_channel_logo: string | null;
      updated_at: string;
      enabled?: boolean;
      password?: string;
    };
    const patch: TvPatch = {
      lounge_id: data.lounge_id,
      slot: data.slot,
      display_name: data.display_name ?? null,
      provider_name: data.provider_name ?? null,
      server_url: data.server_url ?? null,
      username: data.username ?? null,
      connection_type: data.connection_type,
      selected_channel_id: data.selected_channel_id ?? null,
      selected_channel_name: data.selected_channel_name ?? null,
      selected_channel_logo: data.selected_channel_logo ?? null,
      updated_at: now,
    };
    if (typeof data.enabled === "boolean") patch.enabled = data.enabled;
    if (data.password) patch.password = encryptSecret(data.password);

    let row;
    if (data.id) {
      const { data: r, error } = await supabaseAdmin
        .from("tvs")
        .update(patch)
        .eq("id", data.id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      row = r;
    } else {
      const { data: r, error } = await supabaseAdmin
        .from("tvs")
        .insert({ ...patch, enabled: patch.enabled ?? true })
        .select()
        .single();
      if (error) throw new Error(error.message);
      row = r;
    }
    return { id: row.id };
  });
