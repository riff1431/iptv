import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { adminListTvsForLounge, adminUpsertTv } from "@/lib/tvs-admin.functions";

export type Lounge = Database["public"]["Tables"]["lounges"]["Row"];
export type LoungeInsert = Database["public"]["Tables"]["lounges"]["Insert"];
export type Tv = Database["public"]["Tables"]["tvs"]["Row"];
export type TvUpdate = Database["public"]["Tables"]["tvs"]["Update"];
export type Ad = Database["public"]["Tables"]["ads"]["Row"];
export type AdSchedule = Database["public"]["Tables"]["ad_schedules"]["Row"];
export type AppSettings = Database["public"]["Tables"]["app_settings"]["Row"];

// ---------- Lounges ----------
export function useLounges() {
  return useQuery({
    queryKey: ["admin", "lounges"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lounges")
        .select("*")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useUpsertLounge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: LoungeInsert) => {
      const { data, error } = await supabase
        .from("lounges")
        .upsert(values)
        .select()
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "lounges"] }),
  });
}

export type LoungeMatchInput = {
  match_title: string | null;
  match_sport: string | null;
  match_home_label: string | null;
  match_away_label: string | null;
  match_home_score: number;
  match_away_score: number;
  match_period_label: string | null;
  match_clock_label: string | null;
  match_thumbnail_url: string | null;
  match_status: "off" | "scheduled" | "live" | "halftime" | "final";
  match_starts_at: string | null;
  match_accent_home: string | null;
  match_accent_away: string | null;
};

export function useUpdateLoungeMatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, match }: { id: string; match: LoungeMatchInput }) => {
      const { data, error } = await supabase
        .from("lounges")
        .update(match)
        .eq("id", id)
        .select()
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "lounges"] });
      qc.invalidateQueries({ queryKey: ["publicLounges"] });
    },
  });
}

export function useDeleteLounge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("lounges").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "lounges"] }),
  });
}

// ---------- TVs ----------
export function useTvsForLounge(loungeId: string | null) {
  return useQuery({
    queryKey: ["admin", "tvs", loungeId],
    enabled: !!loungeId,
    queryFn: async () => {
      const rows = await adminListTvsForLounge({ data: { loungeId: loungeId! } });
      return rows ?? [];
    },
  });
}

export function useUpsertTv() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Database["public"]["Tables"]["tvs"]["Insert"]) => {
      const data = await adminUpsertTv({ data: values as any });
      return data;
    },
    onMutate: async (vars) => {
      // Optimistically patch the public lounges cache so Arena cards update
      // instantly while the admin save is in flight.
      await qc.cancelQueries({ queryKey: ["publicLounges"] });
      const prev = qc.getQueryData<any[]>(["publicLounges"]);
      if (prev && vars.lounge_id != null && vars.slot != null) {
        qc.setQueryData<any[]>(["publicLounges"], (list) =>
          (list ?? []).map((l) => {
            if (l.id !== vars.lounge_id) return l;
            const tvs = [...(l.tvs ?? [])];
            const idx = tvs.findIndex((t) => t.slot === vars.slot);
            const patched = {
              ...(idx >= 0 ? tvs[idx] : {}),
              slot: vars.slot,
              position: vars.slot,
              display_name: vars.display_name ?? (idx >= 0 ? tvs[idx].display_name : null),
              channel_logo:
                vars.selected_channel_logo ??
                (idx >= 0 ? tvs[idx].channel_logo : null),
              sport: vars.sport ?? (idx >= 0 ? tvs[idx].sport : ""),
              matchup: vars.matchup ?? (idx >= 0 ? tvs[idx].matchup : ""),
            };
            if (idx >= 0) tvs[idx] = patched;
            else tvs.push(patched);
            tvs.sort((a, b) => a.slot - b.slot);
            return { ...l, tvs };
          }),
        );
      }
      return { prev };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["publicLounges"], ctx.prev);
    },
    onSettled: (_d, _e, vars) => {
      qc.invalidateQueries({ queryKey: ["admin", "tvs", vars.lounge_id] });
      qc.invalidateQueries({ queryKey: ["publicLounges"] });
    },
  });
}

export function useSwapTvSlots() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { loungeId: string; slotA: number; slotB: number }) => {
      const { error } = await supabase.rpc("swap_tv_slots", {
        _lounge_id: vars.loungeId,
        _slot_a: vars.slotA,
        _slot_b: vars.slotB,
      });
      if (error) throw error;
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ["publicLounges"] });
      const prev = qc.getQueryData<any[]>(["publicLounges"]);
      qc.setQueryData<any[]>(["publicLounges"], (list) =>
        (list ?? []).map((l) => {
          if (l.id !== vars.loungeId) return l;
          const tvs = (l.tvs ?? []).map((t: any) => {
            if (t.slot === vars.slotA) return { ...t, slot: vars.slotB, position: vars.slotB };
            if (t.slot === vars.slotB) return { ...t, slot: vars.slotA, position: vars.slotA };
            return t;
          });
          tvs.sort((a: any, b: any) => a.slot - b.slot);
          return { ...l, tvs };
        }),
      );
      // Also patch admin cache so ▲▼ buttons reflect immediately.
      const adminKey = ["admin", "tvs", vars.loungeId];
      const prevAdmin = qc.getQueryData<any[]>(adminKey);
      if (prevAdmin) {
        qc.setQueryData<any[]>(
          adminKey,
          prevAdmin
            .map((t) => {
              if (t.slot === vars.slotA) return { ...t, slot: vars.slotB };
              if (t.slot === vars.slotB) return { ...t, slot: vars.slotA };
              return t;
            })
            .sort((a: any, b: any) => a.slot - b.slot),
        );
      }
      return { prev, prevAdmin };
    },
    onError: (_e, vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["publicLounges"], ctx.prev);
      if (ctx?.prevAdmin)
        qc.setQueryData(["admin", "tvs", vars.loungeId], ctx.prevAdmin);
    },
    onSettled: (_d, _e, vars) => {
      qc.invalidateQueries({ queryKey: ["admin", "tvs", vars.loungeId] });
      qc.invalidateQueries({ queryKey: ["publicLounges"] });
    },
  });
}

// ---------- Ads ----------
export function useAds() {
  return useQuery({
    queryKey: ["admin", "ads"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ads")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useUpsertAd() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Database["public"]["Tables"]["ads"]["Insert"]) => {
      const { data, error } = await supabase.from("ads").upsert(values).select().maybeSingle();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "ads"] }),
  });
}

export function useDeleteAd() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("ads").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "ads"] }),
  });
}

// ---------- Ad schedules ----------
export function useAdSchedules() {
  return useQuery({
    queryKey: ["admin", "ad_schedules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ad_schedules")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useUpsertAdSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      values: Database["public"]["Tables"]["ad_schedules"]["Insert"],
    ) => {
      const { data, error } = await supabase
        .from("ad_schedules")
        .upsert(values)
        .select()
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "ad_schedules"] }),
  });
}

export function useDeleteAdSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("ad_schedules").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "ad_schedules"] }),
  });
}

// ---------- App settings ----------
export function useAppSettings() {
  return useQuery({
    queryKey: ["admin", "app_settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("*")
        .eq("id", true)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useUpdateAppSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<AppSettings>) => {
      const { data, error } = await supabase
        .from("app_settings")
        .upsert({ id: true, ...patch })
        .select()
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "app_settings"] }),
  });
}
