import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdminServer } from "@/lib/admin-guard";
import type { Database } from "@/integrations/supabase/types";
import type { IptvChannel } from "@/lib/iptv-client.server";

/**
 * Global IPTV provider settings — one row in app_settings (id = true).
 * Every match reads from this shared config so admins only maintain one place.
 * The Xtream password is encrypted at rest using IPTV_ENCRYPTION_KEY.
 */

export type IptvProviderType = "m3u" | "xtream";

export interface IptvProviderAdminView {
  provider_type: IptvProviderType;
  m3u_url: string;
  xtream_server_url: string;
  xtream_username: string;
  epg_url: string;
  has_xtream_password: boolean;
  updated_at: string | null;
}

export interface PublicIptvProvider {
  provider_type: IptvProviderType;
  m3u_url: string;
  xtream_server_url: string;
  epg_url: string;
}

// URL validator that permits empty string, otherwise must be http(s) < 2048 chars.
const urlOrEmpty = z
  .string()
  .trim()
  .max(2048)
  .refine((v) => v === "" || /^https?:\/\//i.test(v), "Must be an http:// or https:// URL");

const updateSchema = z.object({
  provider_type: z.enum(["m3u", "xtream"]),
  m3u_url: urlOrEmpty,
  xtream_server_url: urlOrEmpty,
  xtream_username: z.string().trim().max(200),
  // "" = leave unchanged; null = clear it explicitly.
  xtream_password: z.string().max(500).nullable().optional(),
  epg_url: urlOrEmpty,
});

export const getIptvProviderAdmin = createServerFn({ method: "GET" })
  .middleware([requireAdminServer])
  .handler(async (): Promise<IptvProviderAdminView> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("app_settings")
      .select(
        "iptv_provider_type, iptv_m3u_url, iptv_xtream_server_url, iptv_xtream_username, iptv_xtream_password_encrypted, iptv_epg_url, updated_at",
      )
      .eq("id", true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return {
      provider_type: (data?.iptv_provider_type as IptvProviderType) ?? "m3u",
      m3u_url: data?.iptv_m3u_url ?? "",
      xtream_server_url: data?.iptv_xtream_server_url ?? "",
      xtream_username: data?.iptv_xtream_username ?? "",
      epg_url: data?.iptv_epg_url ?? "",
      has_xtream_password: !!data?.iptv_xtream_password_encrypted,
      updated_at: data?.updated_at ?? null,
    };
  });

export const updateIptvProviderAdmin = createServerFn({ method: "POST" })
  .middleware([requireAdminServer])
  .validator((d: unknown) => updateSchema.parse(d))
  .handler(async ({ data, context }): Promise<IptvProviderAdminView> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { encryptSecret } = await import("@/lib/iptv-crypto.server");

    // Snapshot for audit.
    const { data: prev } = await supabaseAdmin
      .from("app_settings")
      .select(
        "iptv_provider_type, iptv_m3u_url, iptv_xtream_server_url, iptv_xtream_username, iptv_xtream_password_encrypted, iptv_epg_url",
      )
      .eq("id", true)
      .maybeSingle();

    type SettingsUpdate = Database["public"]["Tables"]["app_settings"]["Update"];
    const update: SettingsUpdate = {
      iptv_provider_type: data.provider_type,
      iptv_m3u_url: data.m3u_url || null,
      iptv_xtream_server_url: data.xtream_server_url || null,
      iptv_xtream_username: data.xtream_username || null,
      iptv_epg_url: data.epg_url || null,
      updated_at: new Date().toISOString(),
    };
    // Password rules: undefined/"" = keep as-is; null = clear; non-empty = encrypt + set.
    if (data.xtream_password === null) {
      update.iptv_xtream_password_encrypted = null;
    } else if (typeof data.xtream_password === "string" && data.xtream_password.length > 0) {
      update.iptv_xtream_password_encrypted = encryptSecret(data.xtream_password);
    }

    const { data: row, error } = await supabaseAdmin
      .from("app_settings")
      .update(update)
      .eq("id", true)
      .select(
        "iptv_provider_type, iptv_m3u_url, iptv_xtream_server_url, iptv_xtream_username, iptv_xtream_password_encrypted, iptv_epg_url, updated_at",
      )
      .single();
    if (error) throw new Error(error.message);

    // Best-effort audit (never leak the secret).
    try {
      const { data: actor } = await supabaseAdmin.auth.admin.getUserById(context.userId);
      await supabaseAdmin.from("admin_audit_log").insert({
        actor_id: context.userId,
        actor_email: actor?.user?.email ?? null,
        action: "update_iptv_provider",
        target_table: "app_settings",
        target_id: "app_settings",
        before: {
          provider_type: prev?.iptv_provider_type ?? null,
          m3u_url: prev?.iptv_m3u_url ?? null,
          xtream_server_url: prev?.iptv_xtream_server_url ?? null,
          xtream_username: prev?.iptv_xtream_username ?? null,
          epg_url: prev?.iptv_epg_url ?? null,
          had_password: !!prev?.iptv_xtream_password_encrypted,
        },
        after: {
          provider_type: row.iptv_provider_type,
          m3u_url: row.iptv_m3u_url,
          xtream_server_url: row.iptv_xtream_server_url,
          xtream_username: row.iptv_xtream_username,
          epg_url: row.iptv_epg_url,
          has_password: !!row.iptv_xtream_password_encrypted,
        },
      });
    } catch (e) {
      console.error("[audit] iptv provider update:", e);
    }

    const { invalidateIptvSettingsCache } = await import("@/lib/iptv-settings-cache.server");
    invalidateIptvSettingsCache();

    return {
      provider_type: (row.iptv_provider_type as IptvProviderType) ?? "m3u",
      m3u_url: row.iptv_m3u_url ?? "",
      xtream_server_url: row.iptv_xtream_server_url ?? "",
      xtream_username: row.iptv_xtream_username ?? "",
      epg_url: row.iptv_epg_url ?? "",
      has_xtream_password: !!row.iptv_xtream_password_encrypted,
      updated_at: row.updated_at ?? null,
    };
  });

/**
 * Public read of only the non-secret provider fields. Used by the client to
 * point everything (channel picker, playback) at the globally-configured
 * playlist without exposing credentials.
 */
function serializeIptvCatalog(channels: IptvChannel[], includeUrls: boolean): string {
  const groups = Array.from(
    new Set(channels.map((channel) => channel.group).filter((group): group is string => !!group)),
  );
  const groupIndexes = new Map(groups.map((group, index) => [group, index]));
  return JSON.stringify({
    v: 1,
    g: groups,
    c: channels.map((channel) => [
      channel.id,
      channel.name,
      channel.logo,
      channel.group ? (groupIndexes.get(channel.group) ?? -1) : -1,
      includeUrls ? channel.url : "",
    ]),
  });
}

const GLOBAL_CATALOG_CACHE_ID = true;
const CATALOG_STALE_MS = 60 * 60 * 1000;
const MEMORY_CATALOG_TTL_MS = 5 * 60 * 1000;

type GlobalProviderConfig = {
  type: IptvProviderType;
  serverUrl: string;
  username: string | null;
  encryptedPassword: string | null;
};

type GlobalCatalogCacheRow = {
  provider_fingerprint: string;
  catalog_json: string;
  channel_count: number;
  fetched_at: string;
  refresh_started_at: string | null;
  last_error: string | null;
};

export type IptvCatalogSyncStatus = {
  configured: boolean;
  cached: boolean;
  providerMatches: boolean;
  stale: boolean;
  refreshing: boolean;
  channelCount: number;
  fetchedAt: string | null;
  lastError: string | null;
  refreshed: boolean;
};

let memoryCatalogCache: {
  fingerprint: string;
  catalog: string;
  loadedAt: number;
} | null = null;
const catalogRefreshInflight = new Map<string, Promise<IptvCatalogSyncStatus>>();

async function loadGlobalProviderConfig(): Promise<GlobalProviderConfig | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: row, error } = await supabaseAdmin
    .from("app_settings")
    .select(
      "iptv_provider_type, iptv_m3u_url, iptv_xtream_server_url, iptv_xtream_username, iptv_xtream_password_encrypted",
    )
    .eq("id", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) return null;

  const type = (row.iptv_provider_type as IptvProviderType) ?? "m3u";
  const serverUrl = type === "m3u" ? row.iptv_m3u_url : row.iptv_xtream_server_url;
  if (!serverUrl) return null;

  return {
    type,
    serverUrl,
    username: row.iptv_xtream_username,
    encryptedPassword: row.iptv_xtream_password_encrypted,
  };
}

async function fingerprintProvider(config: GlobalProviderConfig): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256")
    .update(
      JSON.stringify([config.type, config.serverUrl, config.username, config.encryptedPassword]),
    )
    .digest("hex");
}

async function readGlobalCatalogCache(): Promise<GlobalCatalogCacheRow | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("iptv_global_catalog_cache")
    .select(
      "provider_fingerprint, catalog_json, channel_count, fetched_at, refresh_started_at, last_error",
    )
    .eq("id", GLOBAL_CATALOG_CACHE_ID)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

function catalogStatus(
  config: GlobalProviderConfig | null,
  fingerprint: string | null,
  cached: GlobalCatalogCacheRow | null,
  refreshed = false,
): IptvCatalogSyncStatus {
  const providerMatches = Boolean(fingerprint && cached?.provider_fingerprint === fingerprint);
  const fetchedAtMs = cached?.fetched_at ? Date.parse(cached.fetched_at) : 0;
  const refreshStartedMs = cached?.refresh_started_at ? Date.parse(cached.refresh_started_at) : 0;
  return {
    configured: Boolean(config),
    cached: Boolean(cached?.catalog_json),
    providerMatches,
    stale: !providerMatches || !fetchedAtMs || Date.now() - fetchedAtMs >= CATALOG_STALE_MS,
    refreshing:
      providerMatches &&
      Boolean(refreshStartedMs) &&
      Date.now() - refreshStartedMs < 10 * 60 * 1000,
    channelCount: providerMatches ? (cached?.channel_count ?? 0) : 0,
    fetchedAt: providerMatches ? (cached?.fetched_at ?? null) : null,
    lastError: cached?.last_error ?? null,
    refreshed,
  };
}

async function performGlobalCatalogSync(
  config: GlobalProviderConfig,
  fingerprint: string,
): Promise<IptvCatalogSyncStatus> {
  const existingRefresh = catalogRefreshInflight.get(fingerprint);
  if (existingRefresh) return existingRefresh;

  const pending = (async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { decryptSecret } = await import("@/lib/iptv-crypto.server");
    const { fetchChannels } = await import("@/lib/iptv-client.server");
    try {
      const password = decryptSecret(config.encryptedPassword);
      const channels = await fetchChannels({
        server_url: config.serverUrl,
        username: config.username,
        password: password || null,
        connection_type: config.type,
      });
      if (channels.length === 0) {
        throw new Error("Provider returned an empty channel catalog");
      }

      const catalog = serializeIptvCatalog(channels, config.type !== "xtream");
      const fetchedAt = new Date().toISOString();
      const { error } = await supabaseAdmin.from("iptv_global_catalog_cache").upsert({
        id: GLOBAL_CATALOG_CACHE_ID,
        provider_fingerprint: fingerprint,
        catalog_json: catalog,
        channel_count: channels.length,
        fetched_at: fetchedAt,
        refresh_started_at: null,
        last_error: null,
      });
      if (error) throw new Error(error.message);

      memoryCatalogCache = { fingerprint, catalog, loadedAt: Date.now() };
      return {
        configured: true,
        cached: true,
        providerMatches: true,
        stale: false,
        refreshing: false,
        channelCount: channels.length,
        fetchedAt,
        lastError: null,
        refreshed: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await supabaseAdmin
        .from("iptv_global_catalog_cache")
        .update({ refresh_started_at: null, last_error: message.slice(0, 1000) })
        .eq("id", GLOBAL_CATALOG_CACHE_ID);
      throw error;
    }
  })().finally(() => {
    catalogRefreshInflight.delete(fingerprint);
  });

  catalogRefreshInflight.set(fingerprint, pending);
  return pending;
}

async function syncGlobalIptvCatalog(force: boolean): Promise<IptvCatalogSyncStatus> {
  const config = await loadGlobalProviderConfig();
  if (!config) return catalogStatus(null, null, await readGlobalCatalogCache());

  const fingerprint = await fingerprintProvider(config);
  const cached = await readGlobalCatalogCache();
  const currentStatus = catalogStatus(config, fingerprint, cached);
  if (currentStatus.providerMatches && !currentStatus.stale && !force) {
    return currentStatus;
  }

  if (currentStatus.providerMatches) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: claimed, error } = await supabaseAdmin.rpc("claim_iptv_global_catalog_refresh", {
      _provider_fingerprint: fingerprint,
      _force: force,
    });
    if (error) throw new Error(error.message);
    if (!claimed) return { ...currentStatus, refreshing: true };
  }

  return performGlobalCatalogSync(config, fingerprint);
}

export const getPublicIptvProvider = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicIptvProvider> => {
    const supa = createClient<Database>(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
    );
    const { data, error } = await supa.rpc("get_public_iptv_provider");
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    return {
      provider_type: (row?.provider_type as IptvProviderType) ?? "m3u",
      m3u_url: row?.m3u_url ?? "",
      xtream_server_url: row?.xtream_server_url ?? "",
      epg_url: row?.epg_url ?? "",
    };
  },
);

export const getPublicIptvChannels = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<string> => {
    const config = await loadGlobalProviderConfig();
    if (!config) return serializeIptvCatalog([], false);
    const fingerprint = await fingerprintProvider(config);

    if (
      memoryCatalogCache?.fingerprint === fingerprint &&
      Date.now() - memoryCatalogCache.loadedAt < MEMORY_CATALOG_TTL_MS
    ) {
      return memoryCatalogCache.catalog;
    }

    const cached = await readGlobalCatalogCache();
    if (cached?.provider_fingerprint === fingerprint && cached.catalog_json) {
      memoryCatalogCache = { fingerprint, catalog: cached.catalog_json, loadedAt: Date.now() };
      return cached.catalog_json;
    }

    await performGlobalCatalogSync(config, fingerprint);
    if (!memoryCatalogCache?.catalog) {
      throw new Error("IPTV catalog sync completed without a catalog");
    }
    return memoryCatalogCache.catalog;
  });

export const refreshPublicIptvCatalog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<IptvCatalogSyncStatus> => syncGlobalIptvCatalog(false));

export const getIptvCatalogStatusAdmin = createServerFn({ method: "GET" })
  .middleware([requireAdminServer])
  .handler(async (): Promise<IptvCatalogSyncStatus> => {
    const config = await loadGlobalProviderConfig();
    const fingerprint = config ? await fingerprintProvider(config) : null;
    return catalogStatus(config, fingerprint, await readGlobalCatalogCache());
  });

export const syncIptvCatalogAdmin = createServerFn({ method: "POST" })
  .middleware([requireAdminServer])
  .handler(async (): Promise<IptvCatalogSyncStatus> => syncGlobalIptvCatalog(true));
export const getPublicIptvChannelPlayback = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) =>
    z.object({ channelId: z.string().trim().min(1).max(128) }).parse(data),
  )
  .handler(async ({ data }): Promise<{ url: string }> => {
    const { signRelayAccess } = await import("@/lib/iptv-relay-token.server");
    const scope = `global-xtream:${data.channelId}`;
    const access = signRelayAccess(scope);
    return {
      url: `/api/public/iptv/channel/${encodeURIComponent(data.channelId)}/playlist?access=${encodeURIComponent(access)}`,
    };
  });

export const getPublicIptvChannelPlaybacks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) =>
    z
      .object({
        channelIds: z
          .array(
            z
              .string()
              .trim()
              .regex(/^\d{1,20}$/),
          )
          .min(1)
          .max(16),
      })
      .transform(({ channelIds }) => ({ channelIds: Array.from(new Set(channelIds)) }))
      .parse(data),
  )
  .handler(async ({ data }): Promise<Record<string, string>> => {
    const { signRelayAccess } = await import("@/lib/iptv-relay-token.server");
    return Object.fromEntries(
      data.channelIds.map((channelId) => {
        const scope = `global-xtream:${channelId}`;
        const access = signRelayAccess(scope);
        return [
          channelId,
          `/api/public/iptv/channel/${encodeURIComponent(channelId)}/playlist?access=${encodeURIComponent(access)}`,
        ];
      }),
    );
  });
export const testIptvProviderAdmin = createServerFn({ method: "POST" })
  .middleware([requireAdminServer])
  .validator((d: unknown) => updateSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { decryptSecret } = await import("@/lib/iptv-crypto.server");
    const { testConnection } = await import("@/lib/iptv-client.server");

    let pass = data.xtream_password;
    if (!pass || pass.length === 0) {
      const { data: row } = await supabaseAdmin
        .from("app_settings")
        .select("iptv_xtream_password_encrypted")
        .eq("id", true)
        .maybeSingle();
      pass = decryptSecret(row?.iptv_xtream_password_encrypted);
    }

    const creds = {
      server_url: data.provider_type === "m3u" ? data.m3u_url : data.xtream_server_url,
      username: data.xtream_username || null,
      password: pass || null,
      connection_type: data.provider_type,
    };

    return testConnection(creds);
  });

export interface AdminChannelPreviewResponse {
  provider_type: IptvProviderType;
  totalChannels: number;
  categories: string[];
  channels: Array<{
    id: string;
    name: string;
    logo: string | null;
    group: string | null;
  }>;
}

export const previewIptvChannelsAdmin = createServerFn({ method: "GET" })
  .middleware([requireAdminServer])
  .handler(async (): Promise<AdminChannelPreviewResponse> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { decryptSecret } = await import("@/lib/iptv-crypto.server");
    const { fetchChannels } = await import("@/lib/iptv-client.server");

    const { data: row, error } = await supabaseAdmin
      .from("app_settings")
      .select(
        "iptv_provider_type, iptv_m3u_url, iptv_xtream_server_url, iptv_xtream_username, iptv_xtream_password_encrypted",
      )
      .eq("id", true)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!row) throw new Error("No provider settings configured in database");

    const type = (row.iptv_provider_type as IptvProviderType) ?? "m3u";
    const serverUrl = type === "m3u" ? row.iptv_m3u_url : row.iptv_xtream_server_url;
    if (!serverUrl) throw new Error("No provider URL configured in database");

    const password = decryptSecret(row.iptv_xtream_password_encrypted);
    if (type === "xtream" && !password) {
      throw new Error(
        "Saved password needs to be re-saved. Please re-enter your Xtream password and click Save settings.",
      );
    }

    const creds = {
      server_url: serverUrl,
      username: row.iptv_xtream_username || null,
      password: password || null,
      connection_type: type,
    };

    const channels = await fetchChannels(creds);
    const categorySet = new Set<string>();
    channels.forEach((c) => {
      if (c.group) categorySet.add(c.group);
    });

    return {
      provider_type: type,
      totalChannels: channels.length,
      categories: Array.from(categorySet).sort(),
      channels: channels,
    };
  });
