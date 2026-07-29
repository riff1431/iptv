import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Global realtime subscription for `tvs` changes. Any insert/update/delete —
 * e.g. an admin saving a new channel, matchup, or scoreboard for TV1–4 —
 * invalidates the `publicLounges` react-query cache so the lobby list and home
 * grid refetch within ~1s. No page refresh required.
 *
 * Unfiltered because these pages span many lounges (unlike `useTvsRealtime`,
 * which watches a single lounge). `public.tvs` is in the realtime publication
 * and RLS only exposes active/public rows, so this is safe for anon fans.
 */
export function usePublicLoungesRealtime() {
  const qc = useQueryClient();

  useEffect(() => {
    const suffix = Math.random().toString(36).slice(2);
    const channel = supabase
      .channel(`publicLounges:tvs:${suffix}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tvs" }, () => {
        void qc.invalidateQueries({ queryKey: ["publicLounges"] });
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc]);
}
