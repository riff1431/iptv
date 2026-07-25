import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Global realtime subscription for ad_schedules changes. Any insert/update/delete
 * invalidates the react-query cache so admin lists and lounge players refetch.
 */
export function useAdScheduleRealtime() {
  const qc = useQueryClient();

  useEffect(() => {
    const suffix = Math.random().toString(36).slice(2);
    const channel = supabase
      .channel(`ad_schedules:global:${suffix}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ad_schedules" },
        () => {
          void qc.invalidateQueries({ queryKey: ["admin", "ad_schedules"] });
          void qc.invalidateQueries({ queryKey: ["ad_schedules"] });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc]);
}
