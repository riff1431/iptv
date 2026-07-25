import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

/**
 * Fetch the caller's stored notification preferences blob. Returns null when
 * the user has never saved preferences (caller should fall back to defaults).
 */
export const getMyNotifPrefs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("user_notification_prefs")
      .select("prefs, updated_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return {
      prefs: (data?.prefs ?? null) as Json | null,
      updatedAt: data?.updated_at ?? null,
    };
  });

/**
 * Upsert the caller's notification preferences. Accepts an arbitrary JSON
 * blob; validation of shape happens in the client hook so the schema stays
 * flexible as categories/channels evolve.
 */
export const saveMyNotifPrefs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { prefs: Json }) => {
    if (!input || typeof input !== "object" || input.prefs === undefined) {
      throw new Error("Invalid prefs payload");
    }
    // Cheap size guard — a valid prefs blob is well under 4KB.
    const size = JSON.stringify(input.prefs).length;
    if (size > 8_000) throw new Error("Preferences payload too large");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("user_notification_prefs")
      .upsert(
        {
          user_id: userId,
          prefs: data.prefs as never,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

