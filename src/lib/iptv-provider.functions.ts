import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireAdminServer } from "@/lib/admin-guard";
import type { Database } from "@/integrations/supabase/types";

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
  .refine(
    (v) => v === "" || /^https?:\/\//i.test(v),
    "Must be an http:// or https:// URL",
  );

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
      provider_type: ((data?.iptv_provider_type as IptvProviderType) ?? "m3u"),
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
  .inputValidator((d: unknown) => updateSchema.parse(d))
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
      provider_type: ((row?.provider_type as IptvProviderType) ?? "m3u"),
      m3u_url: row?.m3u_url ?? "",
      xtream_server_url: row?.xtream_server_url ?? "",
      epg_url: row?.epg_url ?? "",
    };
  },
);
