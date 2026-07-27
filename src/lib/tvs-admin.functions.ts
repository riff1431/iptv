import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdminServer } from "@/lib/admin-guard";
import type { Database } from "@/integrations/supabase/types";

type TvRow = Database["public"]["Tables"]["tvs"]["Row"];
type TvInsert = Database["public"]["Tables"]["tvs"]["Insert"];

/**
 * Admin-only fetch of every column on `tvs` for a lounge, including the
 * credential and stream URL fields which are column-level revoked from
 * anon/authenticated at the DB layer. Uses supabaseAdmin so admins can
 * populate the edit form.
 */
export const adminListTvsForLounge = createServerFn({ method: "POST" })
  .middleware([requireAdminServer])
  .validator((d: unknown) => z.object({ loungeId: z.string().uuid() }).parse(d))
  .handler(async ({ data }): Promise<TvRow[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("tvs")
      .select("*")
      .eq("lounge_id", data.loungeId)
      .order("slot", { ascending: true });
    if (error) throw new Error(error.message);
    return (rows ?? []) as TvRow[];
  });

const upsertInput = z.object({
  id: z.string().uuid().optional(),
  lounge_id: z.string().uuid(),
  slot: z.number().int().min(1).max(16),
  display_name: z.string().max(120).nullable().optional(),
  provider_name: z.string().max(120).nullable().optional(),
  server_url: z.string().max(2048).nullable().optional(),
  username: z.string().max(255).nullable().optional(),
  password: z.string().max(1024).nullable().optional(),
  connection_type: z.enum(["xtream", "m3u", "hls"]).optional(),
  selected_channel_id: z.string().max(255).nullable().optional(),
  selected_channel_name: z.string().max(255).nullable().optional(),
  selected_channel_logo: z.string().max(2048).nullable().optional(),
  current_stream_url: z.string().max(2048).nullable().optional(),
  enabled: z.boolean().optional(),
  sport: z.string().max(120).nullable().optional(),
  matchup: z.string().max(240).nullable().optional(),
  home_label: z.string().max(60).nullable().optional(),
  away_label: z.string().max(60).nullable().optional(),
  home_score: z.number().int().optional(),
  away_score: z.number().int().optional(),
  period_label: z.string().max(60).nullable().optional(),
  clock_label: z.string().max(60).nullable().optional(),
  accent_home: z.string().max(60).nullable().optional(),
  accent_away: z.string().max(60).nullable().optional(),
});

/**
 * Admin-only upsert for a TV row. Runs via supabaseAdmin so we can update
 * and return every column (including credential/stream URL columns that
 * are column-level revoked from anon/authenticated).
 */
export const adminUpsertTv = createServerFn({ method: "POST" })
  .middleware([requireAdminServer])
  .validator((d: unknown) => upsertInput.parse(d))
  .handler(async ({ data }): Promise<TvRow | null> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const values = data as TvInsert;
    const { data: row, error } = await supabaseAdmin
      .from("tvs")
      .upsert(values, { onConflict: "lounge_id,slot" })
      .select()
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (row ?? null) as TvRow | null;
  });
