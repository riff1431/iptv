import { useEffect, useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import {
  readNotifPrefs,
  shouldDeliverInApp,
  notificationAllowed,
} from "@/hooks/useNotificationPrefs";

export type Notification = Database["public"]["Tables"]["notifications"]["Row"];

/**
 * Streams the current user's notifications in realtime and exposes
 * mark-as-read helpers. Filters items and surfaces in-app toasts
 * according to the user's saved notification preferences.
 */
export function useNotifications() {
  const [userId, setUserId] = useState<string | null>(null);
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const seenIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (mounted) setUserId(data.user?.id ?? null);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!userId) {
      setItems([]);
      seenIdsRef.current = new Set();
      setLoading(false);
      return;
    }
    let mounted = true;
    setLoading(true);

    (async () => {
      const { data } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (mounted && data) {
        setItems(data);
        seenIdsRef.current = new Set(data.map((n) => n.id));
      }
      if (mounted) setLoading(false);
    })();

    const channel = supabase
      .channel(`notifications:${userId}:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const n = payload.new as Notification;
          const isNew = !seenIdsRef.current.has(n.id);
          seenIdsRef.current.add(n.id);
          setItems((prev) =>
            prev.some((x) => x.id === n.id) ? prev : [n, ...prev].slice(0, 50),
          );

          if (!isNew) return;
          const prefs = readNotifPrefs(userId);
          if (!shouldDeliverInApp(n, prefs)) return;
          toast(n.title, {
            description: n.body ?? undefined,
            action: n.link
              ? {
                  label: "Open",
                  onClick: () => {
                    if (typeof window !== "undefined") {
                      window.location.assign(n.link as string);
                    }
                  },
                }
              : undefined,
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const n = payload.new as Notification;
          setItems((prev) => prev.map((x) => (x.id === n.id ? n : x)));
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const old = payload.old as Partial<Notification>;
          setItems((prev) => prev.filter((x) => x.id !== old.id));
          if (old.id) seenIdsRef.current.delete(old.id);
        },
      )
      .subscribe();

    return () => {
      mounted = false;
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  const markAsRead = useCallback(
    async (id: string) => {
      if (!userId) return;
      // optimistic
      setItems((prev) =>
        prev.map((x) =>
          x.id === id && !x.read_at ? { ...x, read_at: new Date().toISOString() } : x,
        ),
      );
      await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", id)
        .is("read_at", null);
    },
    [userId],
  );

  const markAllAsRead = useCallback(async () => {
    if (!userId) return;
    const now = new Date().toISOString();
    setItems((prev) => prev.map((x) => (x.read_at ? x : { ...x, read_at: now })));
    await supabase
      .from("notifications")
      .update({ read_at: now })
      .eq("user_id", userId)
      .is("read_at", null);
  }, [userId]);

  // Re-render when prefs change so filtering stays live.
  const [, bumpPrefs] = useState(0);
  useEffect(() => {
    const handler = () => bumpPrefs((x) => x + 1);
    window.addEventListener("pgx:notif-prefs-changed", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("pgx:notif-prefs-changed", handler);
      window.removeEventListener("storage", handler);
    };
  }, []);

  // Filter to only the categories the user opted into. Lounge kind is
  // allowed if EITHER hostedMatches or liveLobbies is on.
  const prefs = readNotifPrefs(userId);
  const visible = items.filter((n) => {
    if (n.kind === "lounge") {
      return prefs.categories.hostedMatches || prefs.categories.liveLobbies;
    }
    return notificationAllowed(n, prefs);
  });
  const unreadCount = visible.filter((n) => n.read_at === null).length;

  return {
    notifications: visible,
    loading,
    unreadCount,
    markAsRead,
    markAllAsRead,
  };
}
