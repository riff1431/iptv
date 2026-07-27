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
  entryFeeCents: number;
  sortOrder: number;
  viewerCount: number;
  ownerUserId: string | null;
  hostDisplayName: string | null;
  slots: PublicMatchSlot[];
};

function serverPublic() {
  return createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

type MatchRow = Database["public"]["Tables"]["matches"]["Row"];
type SlotRow = Database["public"]["Tables"]["match_slots"]["Row"];

function mapMatch(
  row: MatchRow,
  slots: SlotRow[],
  hostDisplayName: string | null,
  viewerCount: number,
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
    entryFeeCents: row.entry_fee_cents ?? 0,
    sortOrder: row.sort_order ?? 0,
    viewerCount,
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
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [{ data: slots }, profileRes, sessionRes] = await Promise.all([
    ids.length
      ? supa.from("match_slots").select("*").in("match_id", ids).order("slot")
      : Promise.resolve({ data: [] as SlotRow[] }),
    ownerIds.length
      ? supa.from("profiles").select("id, display_name").in("id", ownerIds)
      : Promise.resolve({ data: [] as Array<{ id: string; display_name: string | null }> }),
    ids.length
      ? supabaseAdmin
          .from("match_sessions")
          .select("match_id, user_id")
          .in("match_id", ids)
          .gte("entered_at", since)
      : Promise.resolve({ data: [] as Array<{ match_id: string; user_id: string }> }),
  ]);
  const nameMap = new Map<string, string | null>();
  for (const p of (profileRes.data ?? []) as Array<{ id: string; display_name: string | null }>) {
    nameMap.set(p.id, p.display_name);
  }
  const viewersByMatch = new Map<string, Set<string>>();
  for (const session of sessionRes.data ?? []) {
    const viewers = viewersByMatch.get(session.match_id) ?? new Set<string>();
    viewers.add(session.user_id);
    viewersByMatch.set(session.match_id, viewers);
  }

  return (matches ?? []).map((m) =>
    mapMatch(
      m,
      (slots ?? []).filter((s) => s.match_id === m.id),
      m.owner_id ? (nameMap.get(m.owner_id) ?? null) : null,
      viewersByMatch.get(m.id)?.size ?? 0,
    ),
  );
});

export const publicMatchesQuery = () =>
  queryOptions({
    queryKey: ["publicMatches"],
    queryFn: () => listPublicMatches(),
    staleTime: 30_000,
  });
