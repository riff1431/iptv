import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Fires `onChange()` whenever any TV row for the given lounge is inserted,
 * updated, or deleted. Callers typically refetch or invalidate their local
 * cache in the handler so score / matchup edits reach every viewer instantly.
 */
export function useTvsRealtime(loungeId: string | null | undefined, onChange: () => void) {
  useEffect(() => {
    if (!loungeId) return;
    const channel = supabase
      .channel(`tvs:${loungeId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tvs", filter: `lounge_id=eq.${loungeId}` },
        () => onChange(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loungeId, onChange]);
}
