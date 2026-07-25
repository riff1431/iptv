import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

/**
 * Public, non-authenticated read layer for lounges + their TVs.
 *
 * Uses the publishable (anon) key on the server so it works during SSR /
 * `build:dev` prerender without a bearer token. Reads are guarded by RLS
 * on `lounges` and `tvs` (only active, non-private rows are returned).
 */

export type PublicTv = {
  id: string;
  slot: number;
  /** Legacy alias so existing components (`tv.position`) keep compiling. */
  position: number;
  display_name: string | null;
  sport: string;
  matchup: string;
  home_label: string | null;
  away_label: string | null;
  home_score: number;
  away_score: number;
  period_label: string | null;
  clock_label: string | null;
  accent_home: string | null;
  accent_away: string | null;
  channel_logo: string | null;
};

export type PublicMatch = {
  title: string;
  sport: string | null;
  homeLabel: string | null;
  awayLabel: string | null;
  homeScore: number;
  awayScore: number;
  periodLabel: string | null;
  clockLabel: string | null;
  status: "off" | "scheduled" | "live" | "halftime" | "final";
  startsAt: string | null;
  thumbnailUrl: string | null;
  accentHome: string | null;
  accentAway: string | null;
};

export type PublicLounge = {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  entryFeeCents: number;
  freePreviewSeconds: number;
  vibe: string;
  viewerCount: number; // baseline; realtime presence overrides on the lounge page
  isActive: boolean;
  isFeatured: boolean;
  coverImageUrl: string | null;
  match: PublicMatch | null;
  tvs: PublicTv[];
};

/** Server-side publishable client (no session, no localStorage). */
function serverPublic() {
  return createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
  );
}

/** Stable pseudo-random baseline so cards don't all show identical viewer counts. */
function baselineViewers(id: string): number {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = ((h << 5) + h + id.charCodeAt(i)) | 0;
  return 200 + (Math.abs(h) % 3000);
}

type LoungeRow = Database["public"]["Tables"]["lounges"]["Row"];
type TvRow = Database["public"]["Tables"]["tvs"]["Row"];
type PublicTvRow = Pick<
  TvRow,
  | "id" | "lounge_id" | "slot" | "display_name" | "provider_name"
  | "connection_type" | "selected_channel_id" | "selected_channel_name"
  | "selected_channel_logo" | "enabled" | "status" | "last_status_message"
  | "last_checked_at" | "created_at" | "updated_at" | "sport" | "matchup"
  | "home_label" | "away_label" | "home_score" | "away_score" | "period_label"
  | "clock_label" | "accent_home" | "accent_away"
>;

/**
 * Safe columns to project from `tvs`. Excludes credential + raw stream URL
 * fields (server_url, username, password, current_stream_url) which are
 * column-level revoked from anon/authenticated at the database layer.
 */
const TV_SAFE_COLUMNS =
  "id, lounge_id, slot, display_name, provider_name, connection_type, selected_channel_id, selected_channel_name, selected_channel_logo, enabled, status, last_status_message, last_checked_at, created_at, updated_at, sport, matchup, home_label, away_label, home_score, away_score, period_label, clock_label, accent_home, accent_away";

function mapLounge(row: LoungeRow, tvs: PublicTvRow[]): PublicLounge {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    tagline: row.tagline ?? "",
    entryFeeCents: row.entry_fee_cents,
    freePreviewSeconds: row.free_preview_seconds,
    vibe: row.vibe ?? "Themed",
    viewerCount: baselineViewers(row.id),
    isActive: row.is_active,
    isFeatured: row.is_featured,
    coverImageUrl: row.cover_image_url,
    match: row.match_title && row.match_title.trim()
      ? {
          title: row.match_title,
          sport: row.match_sport,
          homeLabel: row.match_home_label,
          awayLabel: row.match_away_label,
          homeScore: row.match_home_score ?? 0,
          awayScore: row.match_away_score ?? 0,
          periodLabel: row.match_period_label,
          clockLabel: row.match_clock_label,
          status: (row.match_status ?? "off") as PublicMatch["status"],
          startsAt: row.match_starts_at,
          thumbnailUrl: row.match_thumbnail_url,
          accentHome: row.match_accent_home,
          accentAway: row.match_accent_away,
        }
      : null,
    tvs: tvs
      .slice()
      .sort((a, b) => a.slot - b.slot)
      .map((t) => ({
        id: t.id,
        slot: t.slot,
        position: t.slot,
        display_name: t.display_name,
        sport: (t.sport ?? t.display_name ?? "").toString(),
        matchup: (t.matchup ?? "").toString(),
        home_label: t.home_label,
        away_label: t.away_label,
        home_score: t.home_score ?? 0,
        away_score: t.away_score ?? 0,
        period_label: t.period_label,
        clock_label: t.clock_label,
        accent_home: t.accent_home,
        accent_away: t.accent_away,
        channel_logo: t.selected_channel_logo ?? null,
      })),
  };
}

/** All public, active lounges with their enabled TVs. */
export const listPublicLounges = createServerFn({ method: "GET" }).handler(async () => {
  const supa = serverPublic();
  const { data: lounges, error } = await supa
    .from("lounges")
    .select("*")
    .eq("is_active", true)
    .eq("is_private", false)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);

  const ids = (lounges ?? []).map((l) => l.id);
  const { data: tvs } = ids.length
    ? await supa.from("tvs").select(TV_SAFE_COLUMNS).in("lounge_id", ids).eq("enabled", true).order("slot")
    : { data: [] as PublicTvRow[] };

  return (lounges ?? []).map((l) => mapLounge(l, (tvs ?? []).filter((t) => t.lounge_id === l.id)));
});

/** One lounge by slug (public). Returns null when missing/inactive. */
export const getPublicLoungeBySlug = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ slug: z.string().min(1).max(120) }).parse(d))
  .handler(async ({ data }): Promise<PublicLounge | null> => {
    const supa = serverPublic();
    const { data: l } = await supa
      .from("lounges")
      .select("*")
      .eq("slug", data.slug)
      .eq("is_active", true)
      .eq("is_private", false)
      .maybeSingle();
    if (!l) return null;
    const { data: tvs } = await supa
      .from("tvs")
      .select(TV_SAFE_COLUMNS)
      .eq("lounge_id", l.id)
      .eq("enabled", true)
      .order("slot");
    return mapLounge(l, (tvs ?? []) as PublicTvRow[]);
  });

// ---------- Query options helpers ----------

export const publicLoungesQuery = () =>
  queryOptions({
    queryKey: ["publicLounges"],
    queryFn: () => listPublicLounges(),
    staleTime: 30_000,
  });

export const publicLoungeBySlugQuery = (slug: string) =>
  queryOptions({
    queryKey: ["publicLounge", slug],
    queryFn: () => getPublicLoungeBySlug({ data: { slug } }),
    staleTime: 30_000,
  });
