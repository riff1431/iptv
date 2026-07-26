import { decryptSecret } from "@/lib/iptv-crypto.server";

export type CachedIptvSettings = {
  fetchedAt: number;
  server_url: string;
  username: string;
  password: string;
};

let cachedSettings: CachedIptvSettings | null = null;
const CACHE_TTL_MS = 60_000; // Cache DB settings for 60s in Node memory

export async function getCachedGlobalIptvSettings(): Promise<CachedIptvSettings | null> {
  const now = Date.now();
  if (cachedSettings && now - cachedSettings.fetchedAt < CACHE_TTL_MS) {
    return cachedSettings;
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: row, error } = await supabaseAdmin
    .from("app_settings")
    .select(
      "iptv_provider_type, iptv_xtream_server_url, iptv_xtream_username, iptv_xtream_password_encrypted",
    )
    .eq("id", true)
    .maybeSingle();

  if (error || !row || row.iptv_provider_type !== "xtream" || !row.iptv_xtream_server_url) {
    return null;
  }

  const password = decryptSecret(row.iptv_xtream_password_encrypted);
  if (!row.iptv_xtream_username || !password) return null;

  cachedSettings = {
    fetchedAt: now,
    server_url: row.iptv_xtream_server_url,
    username: row.iptv_xtream_username,
    password,
  };
  return cachedSettings;
}

export function invalidateIptvSettingsCache(): void {
  cachedSettings = null;
}
