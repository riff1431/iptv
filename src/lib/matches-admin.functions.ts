import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAdminServer } from "@/lib/admin-guard";

/**
 * Admin-only server functions for managing standalone matches and their
 * configurable IPTV channel slots (1-8). All calls go through
 * requireAdminServer so RLS plus role check enforce access.
 */

const matchStatusEnum = z.enum(["scheduled", "live", "halftime", "final"]);

const upsertSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  title: z.string().trim().max(200),
  sport: z.string().trim().max(80).optional().nullable(),
  home_label: z.string().trim().max(80).optional().nullable(),
  away_label: z.string().trim().max(80).optional().nullable(),
  home_score: z.number().int().min(0).max(9999),
  away_score: z.number().int().min(0).max(9999),
  status: matchStatusEnum,
  starts_at: z.string().datetime().optional().nullable(),
  clock_label: z.string().trim().max(40).optional().nullable(),
  period_label: z.string().trim().max(40).optional().nullable(),
  accent_home: z.string().trim().max(40).optional().nullable(),
  accent_away: z.string().trim().max(40).optional().nullable(),
  thumbnail_url: z.string().trim().max(2048).optional().nullable(),
  is_active: z.boolean(),
  sort_order: z.number().int(),
  slot_count: z.number().int().min(1).max(8).optional(),
});

const slotSchema = z
  .object({
    match_id: z.string().uuid(),
    slot: z.number().int().min(1).max(8),
    channel_id: z.string().trim().max(120).optional().nullable(),
    channel_name: z.string().trim().max(120).optional().nullable(),
    channel_logo: z.string().trim().max(2048).optional().nullable(),
    enabled: z.boolean(),
  })
  .refine((v) => !v.channel_id || !!v.channel_name, {
    message: "channel_name is required when channel_id is set",
    path: ["channel_name"],
  });

export const listMatchesAdmin = createServerFn({ method: "GET" })
  .middleware([requireAdminServer])
  .handler(async ({ context }) => {
    const { data: matches, error } = await context.supabase
      .from("matches")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    const ids = (matches ?? []).map((m) => m.id);
    const { data: slots, error: se } = ids.length
      ? await context.supabase.from("match_slots").select("*").in("match_id", ids).order("slot")
      : { data: [], error: null };
    if (se) throw new Error(se.message);

    return { matches: matches ?? [], slots: slots ?? [] };
  });

export const upsertMatch = createServerFn({ method: "POST" })
  .middleware([requireAdminServer])
  .validator((d) => upsertSchema.parse(d))
  .handler(async ({ data, context }) => {
    const row = {
      ...data,
      id: data.id ?? undefined,
      owner_id: data.id ? undefined : context.userId,
    };
    const { data: saved, error } = await context.supabase
      .from("matches")
      .upsert(row)
      .select()
      .maybeSingle();
    if (error) throw new Error(error.message);
    return saved;
  });

export const deleteMatch = createServerFn({ method: "POST" })
  .middleware([requireAdminServer])
  .validator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("matches").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const upsertMatchSlot = createServerFn({ method: "POST" })
  .middleware([requireAdminServer])
  .validator((d) => slotSchema.parse(d))
  .handler(async ({ data, context }) => {
    // Defense in depth: verify slot fits within the parent match's slot_count
    const { data: match, error: mErr } = await context.supabase
      .from("matches")
      .select("slot_count")
      .eq("id", data.match_id)
      .maybeSingle();
    if (mErr) throw new Error(mErr.message);
    if (!match) throw new Error("Match not found");
    if (data.slot > match.slot_count) {
      throw new Error(`Slot ${data.slot} exceeds this match's slot count (${match.slot_count})`);
    }

    const { data: saved, error } = await context.supabase
      .from("match_slots")
      .upsert(data, { onConflict: "match_id,slot" })
      .select()
      .maybeSingle();
    if (error) throw new Error(error.message);
    return saved;
  });

export const swapMatchSlots = createServerFn({ method: "POST" })
  .middleware([requireAdminServer])
  .validator((d) =>
    z
      .object({
        match_id: z.string().uuid(),
        slot_a: z.number().int().min(1).max(8),
        slot_b: z.number().int().min(1).max(8),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("swap_match_slots", {
      _match_id: data.match_id,
      _slot_a: data.slot_a,
      _slot_b: data.slot_b,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
