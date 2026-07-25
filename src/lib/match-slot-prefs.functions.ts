import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getMatchSlotPref = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { matchId: string }) => {
    if (!data?.matchId || typeof data.matchId !== "string") {
      throw new Error("matchId is required");
    }
    return data;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("user_match_slot_prefs")
      .select("slot")
      .eq("user_id", userId)
      .eq("match_id", data.matchId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { slot: (row?.slot as number | null) ?? null };
  });

export const setMatchSlotPref = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { matchId: string; slot: number | null }) => {
    if (!data?.matchId || typeof data.matchId !== "string") {
      throw new Error("matchId is required");
    }
    if (data.slot != null && (!Number.isInteger(data.slot) || data.slot < 1 || data.slot > 4)) {
      throw new Error("slot must be 1-4 or null");
    }
    return data;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (data.slot == null) {
      const { error } = await supabase
        .from("user_match_slot_prefs")
        .delete()
        .eq("user_id", userId)
        .eq("match_id", data.matchId);
      if (error) throw new Error(error.message);
      return { ok: true, slot: null as number | null };
    }
    const { error } = await supabase
      .from("user_match_slot_prefs")
      .upsert(
        { user_id: userId, match_id: data.matchId, slot: data.slot },
        { onConflict: "user_id,match_id" },
      );
    if (error) throw new Error(error.message);
    return { ok: true, slot: data.slot };
  });
