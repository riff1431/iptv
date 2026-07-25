import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type Profile = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
};

type ProfilePayload = { new: unknown };
type ProfileListener = (payload: ProfilePayload) => void;

type ProfileChannelEntry = {
  channel: ReturnType<typeof supabase.channel>;
  listeners: Set<ProfileListener>;
  refCount: number;
};

// Module-level registry: one realtime channel per userId, shared across every
// useProfile consumer in the tree (header, nav, dropdown, mobile menu, etc.).
// Ref-counted so the channel is torn down only when the last consumer unmounts.
const profileChannels = new Map<string, ProfileChannelEntry>();

function acquireProfileChannel(userId: string, listener: ProfileListener): () => void {
  const tag = `[useProfile:realtime] profile:${userId}`;
  // eslint-disable-next-line no-console
  const log = (...args: unknown[]) => console.debug(tag, ...args);
  // eslint-disable-next-line no-console
  const warn = (...args: unknown[]) => console.warn(tag, ...args);
  // eslint-disable-next-line no-console
  const err = (...args: unknown[]) => console.error(tag, ...args);

  let entry = profileChannels.get(userId);
  if (entry) {
    entry.refCount += 1;
    entry.listeners.add(listener);
    log("reused shared channel (refs=" + entry.refCount + ")");
  } else {
    const listeners = new Set<ProfileListener>([listener]);
    let channel: ReturnType<typeof supabase.channel>;
    try {
      channel = supabase
        .channel(`profile:${userId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "profiles",
            filter: `id=eq.${userId}`,
          },
          (payload) => {
            for (const l of listeners) {
              try {
                l(payload as ProfilePayload);
              } catch (e) {
                warn("listener threw", e);
              }
            }
          },
        )
        .subscribe((status, subErr) => {
          if (status === "SUBSCRIBED") log("subscribed");
          else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT")
            err("subscribe failed", status, subErr);
          else log("status", status);
        });
    } catch (e) {
      // Synchronous throw from `.on()` (e.g. collision on a reused channel
      // name) — surface with context rather than tripping the error boundary.
      err("failed to build channel", e);
      // Return a no-op release so the caller's cleanup is safe.
      return () => {};
    }
    entry = { channel, listeners, refCount: 1 };
    profileChannels.set(userId, entry);
    log("created shared channel");
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = profileChannels.get(userId);
    if (!current) return;
    current.listeners.delete(listener);
    current.refCount -= 1;
    if (current.refCount > 0) {
      log("released (refs=" + current.refCount + ")");
      return;
    }
    profileChannels.delete(userId);
    log("teardown last ref");
    void current.channel
      .unsubscribe()
      .catch((e) => warn("unsubscribe error", e))
      .finally(() => {
        void supabase.removeChannel(current.channel);
      });
  };
}


/**
 * Live view of the current user's profile row.
 *
 * Reads `profiles` via TanStack Query and subscribes to realtime UPDATEs so
 * changes to display_name / avatar_url made on the profile page (or via any
 * other client / session) propagate everywhere the hook is consumed —
 * header avatar, mobile menu, dropdown label — without a manual refresh.
 */
export function useProfile() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();

  const query = useQuery<Profile | null>({
    queryKey: ["profile", userId],
    enabled: !!userId,
    staleTime: 30_000,
    queryFn: async () => {
      if (!userId) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .eq("id", userId)
        .maybeSingle();
      if (error) throw error;
      return (data as Profile | null) ?? null;
    },
  });

  useEffect(() => {
    if (!userId) return;
    const onChange = (payload: { new: unknown }) => {
      const next = (payload.new ?? null) as Profile | null;
      if (next) {
        queryClient.setQueryData<Profile | null>(["profile", userId], next);
      } else {
        void queryClient.invalidateQueries({ queryKey: ["profile", userId] });
      }
    };
    const release = acquireProfileChannel(userId, onChange);
    return release;
  }, [userId, queryClient]);




  const profile = query.data ?? null;
  const fallbackName = user?.user_metadata?.display_name as string | undefined;
  const fallbackAvatar = user?.user_metadata?.avatar_url as string | undefined;
  const displayName =
    profile?.display_name ??
    fallbackName ??
    (user?.email ? user.email.split("@")[0] : "PGX Player");
  const avatarUrl = profile?.avatar_url ?? fallbackAvatar ?? null;
  const initial = (displayName || "P").slice(0, 1).toUpperCase();

  return {
    profile,
    displayName,
    avatarUrl,
    initial,
    loading: query.isLoading,
  };
}
