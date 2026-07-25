import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdminServer } from "@/lib/admin-guard";

export interface SiteSettings {
  site_name: string;
  meta_title: string;
  meta_description: string;
  logo_url: string | null;
  favicon_url: string | null;
  og_image_url: string | null;
  twitter_handle: string | null;
  updated_at: string | null;
}

const DEFAULTS: SiteSettings = {
  site_name: "Sports Lounge — PlayGroundX",
  meta_title: "Sports Lounge — PlayGroundX",
  meta_description:
    "Enter a luxury virtual sports lounge and watch four live sporting events at once. Powered by PlayGroundX.",
  logo_url: null,
  favicon_url: null,
  og_image_url: null,
  twitter_handle: null,
  updated_at: null,
};

// Per-isolate cache for site settings. Cloudflare Workers reuse isolates for
// warm requests, so this cuts the DB read from once-per-request down to
// once-per-TTL-per-isolate. Concurrent misses share a single in-flight promise
// (single-flight) so a burst of requests only issues one query.
const SETTINGS_TTL_MS = 60_000;
type CacheEntry = { value: SiteSettings; expiresAt: number };
let cached: CacheEntry | null = null;
let inflight: Promise<SiteSettings> | null = null;

function readCacheFresh(): SiteSettings | null {
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  return null;
}

/** Invalidate the in-isolate cache. Called from updateSiteSettings. */
function primeCache(value: SiteSettings): void {
  cached = { value, expiresAt: Date.now() + SETTINGS_TTL_MS };
}

async function loadSiteSettingsFromDb(): Promise<SiteSettings> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;
    const { data, error } = await db
      .from("site_settings")
      .select(
        "site_name, meta_title, meta_description, logo_url, favicon_url, og_image_url, twitter_handle, updated_at",
      )
      .eq("id", true)
      .maybeSingle();
    if (error || !data) return DEFAULTS;
    return { ...DEFAULTS, ...(data as Partial<SiteSettings>) };
  } catch {
    return DEFAULTS;
  }
}

/** Public: readable without auth so the shell can render dynamic head tags. */
export const getSiteSettings = createServerFn({ method: "GET" }).handler(
  async (): Promise<SiteSettings> => {
    const hit = readCacheFresh();
    if (hit) return hit;
    if (!inflight) {
      inflight = loadSiteSettingsFromDb()
        .then((value) => {
          primeCache(value);
          return value;
        })
        .finally(() => {
          inflight = null;
        });
    }
    return inflight;
  },
);


const urlOrEmpty = z
  .string()
  .trim()
  .max(2048)
  .refine((v) => v === "" || /^https?:\/\//.test(v) || v.startsWith("/"), {
    message: "Must be a URL or start with /",
  })
  .transform((v) => (v === "" ? null : v));

const updateInput = z.object({
  site_name: z.string().trim().min(1).max(120),
  meta_title: z.string().trim().min(1).max(160),
  meta_description: z.string().trim().min(1).max(320),
  logo_url: urlOrEmpty.nullable().default(null),
  favicon_url: urlOrEmpty.nullable().default(null),
  og_image_url: urlOrEmpty.nullable().default(null),
  twitter_handle: z
    .string()
    .trim()
    .max(64)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .default(null),
});

export const updateSiteSettings = createServerFn({ method: "POST" })
  .middleware([requireAdminServer])
  .inputValidator((data: unknown) => updateInput.parse(data))
  .handler(async ({ data, context }): Promise<SiteSettings> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;

    const { data: prev } = await db
      .from("site_settings")
      .select("*")
      .eq("id", true)
      .maybeSingle();

    const { data: row, error } = await db
      .from("site_settings")
      .upsert({ id: true, ...data, updated_at: new Date().toISOString() })
      .select(
        "site_name, meta_title, meta_description, logo_url, favicon_url, og_image_url, twitter_handle, updated_at",
      )
      .single();
    if (error) throw new Error(error.message);

    try {
      const { data: actor } = await supabaseAdmin.auth.admin.getUserById(context.userId);
      await supabaseAdmin.from("admin_audit_log").insert({
        actor_id: context.userId,
        actor_email: actor?.user?.email ?? null,
        action: "update_site_settings",
        target_table: "site_settings",
        target_id: "site_settings",
        before: (prev ?? null) as never,
        after: data as never,
      });
    } catch (e) {
      console.error("[audit] failed to log site settings update", e);
    }

    const fresh: SiteSettings = { ...DEFAULTS, ...(row as Partial<SiteSettings>) };
    primeCache(fresh);
    return fresh;
  });
