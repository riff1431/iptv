import { createServerFn } from "@tanstack/react-start";
import { queryOptions } from "@tanstack/react-query";

export interface PublicQuickDare {
  id: string;
  label: string;
  icon: string;
  price_cents: number;
  sort_order: number;
}

/**
 * Public list of active Quick Dares for the homepage card.
 * Reads through the anon Data API so it works for signed-out visitors.
 * RLS restricts anon to `is_active = true` rows.
 */
export const listPublicQuickDares = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicQuickDare[]> => {
    const { createClient } = await import("@supabase/supabase-js");
    const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
    const key =
      process.env.SUPABASE_PUBLISHABLE_KEY ??
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) throw new Error("Supabase public config missing");

    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await client
      .from("quick_dares")
      .select("id, label, icon, price_cents, sort_order")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(20);

    if (error) throw new Error(error.message);
    return (data ?? []) as PublicQuickDare[];
  },
);

export const publicQuickDaresQuery = () =>
  queryOptions({
    queryKey: ["public", "quick-dares"],
    queryFn: () => listPublicQuickDares(),
    staleTime: 30_000,
  });
