import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { queryOptions } from "@tanstack/react-query";
import type { Database } from "@/integrations/supabase/types";

/**
 * Public read layer for standalone matches + their 4 channel slots.
 * Uses the server publishable client so it works during SSR without a bearer.
 * RLS on `matches` / `match_slots` gates results to `is_active = true`.
 */

export type PublicMatchSlot = {
  slot: number;
  channelId: string | null;
  channelName: string | null;
  channelLogo: string | null;
  enabled: boolean;
};

export type PublicMatch = {
  id: string;
  title: string;
  sport: string | null;
  homeLabel: string | null;
  awayLabel: string | null;
  homeScore: number;
  awayScore: number;
  status: "scheduled" | "live" | "halftime" | "final";
  startsAt: string | null;
  clockLabel: string | null;
  periodLabel: string | null;
  accentHome: string | null;
  accentAway: string | null;
  thumbnailUrl: string | null;
  sortOrder: number;
  viewerCount: number;
  ownerUserId: string | null;
  hostDisplayName: string | null;
  slots: PublicMatchSlot[];
};


function serverPublic() {
  return createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
  );
}

function baselineViewers(id: string): number {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = ((h << 5) + h + id.charCodeAt(i)) | 0;
  return 200 + (Math.abs(h) % 3000);
}

type MatchRow = Database["public"]["Tables"]["matches"]["Row"];
type SlotRow = Database["public"]["Tables"]["match_slots"]["Row"];

function mapMatch(
  row: MatchRow,
  slots: SlotRow[],
  hostDisplayName: string | null,
): PublicMatch {
  const bySlot = new Map(slots.map((s) => [s.slot, s]));
  const count = Math.max(1, Math.min(8, row.slot_count ?? 4));
  const fullSlots: PublicMatchSlot[] = Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    const s = bySlot.get(n);
    return {
      slot: n,
      channelId: s?.channel_id ?? null,
      channelName: s?.channel_name ?? null,
      channelLogo: s?.channel_logo ?? null,
      enabled: s?.enabled ?? false,
    };
  });
  return {
    id: row.id,
    title: row.title ?? "",
    sport: row.sport,
    homeLabel: row.home_label,
    awayLabel: row.away_label,
    homeScore: row.home_score ?? 0,
    awayScore: row.away_score ?? 0,
    status: (row.status ?? "scheduled") as PublicMatch["status"],
    startsAt: row.starts_at,
    clockLabel: row.clock_label,
    periodLabel: row.period_label,
    accentHome: row.accent_home,
    accentAway: row.accent_away,
    thumbnailUrl: row.thumbnail_url,
    sortOrder: row.sort_order ?? 0,
    viewerCount: baselineViewers(row.id),
    ownerUserId: row.owner_id ?? null,
    hostDisplayName,
    slots: fullSlots,
  };
}

export const listPublicMatches = createServerFn({ method: "GET" }).handler(async () => {
  const supa = serverPublic();
  const { data: matches, error } = await supa
    .from("matches")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const ids = (matches ?? []).map((m) => m.id);
  const ownerIds = Array.from(
    new Set((matches ?? []).map((m) => m.owner_id).filter((v): v is string => Boolean(v))),
  );
  const [{ data: slots }, profileRes] = await Promise.all([
    ids.length
      ? supa.from("match_slots").select("*").in("match_id", ids).order("slot")
      : Promise.resolve({ data: [] as SlotRow[] }),
    ownerIds.length
      ? supa.from("profiles").select("id, display_name").in("id", ownerIds)
      : Promise.resolve({ data: [] as Array<{ id: string; display_name: string | null }> }),
  ]);
  const nameMap = new Map<string, string | null>();
  for (const p of (profileRes.data ?? []) as Array<{ id: string; display_name: string | null }>) {
    nameMap.set(p.id, p.display_name);
  }

  return (matches ?? []).map((m) =>
    mapMatch(
      m,
      (slots ?? []).filter((s) => s.match_id === m.id),
      m.owner_id ? nameMap.get(m.owner_id) ?? null : null,
    ),
  );
});

export const publicMatchesQuery = () =>

  queryOptions({
    queryKey: ["publicMatches"],
    queryFn: () => listPublicMatches(),
    staleTime: 30_000,
  });
