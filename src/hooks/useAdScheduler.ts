import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type ScheduledAd = {
  id: string;
  title: string;
  url: string;
  duration_sec: number;
};

type Schedule = {
  id: string;
  interval_minutes: number;
  ad_ids: string[];
};

/**
 * Resolves ad `storage_path` to a playable URL. Accepts either a full http(s)
 * URL or a Supabase storage path in the `lounge-ads` bucket.
 */
function resolveUrl(storagePath: string): string {
  if (/^https?:\/\//i.test(storagePath)) return storagePath;
  const { data } = supabase.storage.from("lounge-ads").getPublicUrl(storagePath);
  return data.publicUrl;
}

/**
 * Ad break scheduler for a single lounge.
 * - Loads active ad_schedules matching the lounge (or lounge_id null = all lounges).
 * - Picks the shortest interval, then triggers a break every N minutes from mount.
 * - When a break starts, exposes the ordered ad queue for an overlay to play.
 *
 * Timing is session-local so viewers who arrive mid-hour don't get an ad
 * immediately. Cross-viewer sync via `last_played_at` is a Phase-10 concern.
 */
export function useAdScheduler(loungeId: string | null, enabled: boolean) {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [adsById, setAdsById] = useState<Record<string, ScheduledAd>>({});
  const [queue, setQueue] = useState<ScheduledAd[] | null>(null);
  const [cursor, setCursor] = useState(0);

  // Load schedules for this lounge (plus any all-lounge schedules).
  useEffect(() => {
    if (!loungeId || !enabled) {
      setSchedules([]);
      return;
    }
    let mounted = true;
    void supabase
      .from("ad_schedules")
      .select("id, interval_minutes, ad_ids, lounge_id, is_active")
      .eq("is_active", true)
      .or(`lounge_id.eq.${loungeId},lounge_id.is.null`)
      .then(({ data }) => {
        if (!mounted) return;
        setSchedules(
          (data ?? []).map((s) => ({
            id: s.id,
            interval_minutes: s.interval_minutes,
            ad_ids: s.ad_ids ?? [],
          })),
        );
      });
    return () => {
      mounted = false;
    };
  }, [loungeId, enabled]);

  // Load referenced active ads.
  useEffect(() => {
    const ids = Array.from(new Set(schedules.flatMap((s) => s.ad_ids)));
    if (ids.length === 0) {
      setAdsById({});
      return;
    }
    let mounted = true;
    void supabase
      .from("ads")
      .select("id, title, storage_path, duration_sec, is_active")
      .in("id", ids)
      .eq("is_active", true)
      .then(({ data }) => {
        if (!mounted) return;
        const map: Record<string, ScheduledAd> = {};
        for (const a of data ?? []) {
          map[a.id] = {
            id: a.id,
            title: a.title,
            url: resolveUrl(a.storage_path),
            duration_sec: a.duration_sec,
          };
        }
        setAdsById(map);
      });
    return () => {
      mounted = false;
    };
  }, [schedules]);

  const intervalMs = useMemo(() => {
    const mins = schedules
      .map((s) => s.interval_minutes)
      .filter((n) => n > 0);
    if (mins.length === 0) return null;
    return Math.min(...mins) * 60 * 1000;
  }, [schedules]);

  // Trigger the break on interval.
  useEffect(() => {
    if (!enabled || !intervalMs || schedules.length === 0) return;
    const timer = setInterval(() => {
      // Pick a random active schedule; fall back to the first.
      const active = schedules.filter((s) => s.ad_ids.length > 0);
      if (active.length === 0) return;
      const chosen = active[Math.floor(Math.random() * active.length)];
      const ordered = chosen.ad_ids
        .map((id) => adsById[id])
        .filter((a): a is ScheduledAd => !!a);
      if (ordered.length === 0) return;
      setQueue(ordered);
      setCursor(0);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [enabled, intervalMs, schedules, adsById]);

  const current = queue?.[cursor] ?? null;

  function advance() {
    if (!queue) return;
    if (cursor + 1 >= queue.length) {
      setQueue(null);
      setCursor(0);
    } else {
      setCursor((n) => n + 1);
    }
  }

  function skip() {
    setQueue(null);
    setCursor(0);
  }

  return {
    playing: !!current,
    current,
    index: cursor,
    total: queue?.length ?? 0,
    advance,
    skip,
    hasSchedule: schedules.length > 0 && Object.keys(adsById).length > 0,
    intervalMs,
  };
}
