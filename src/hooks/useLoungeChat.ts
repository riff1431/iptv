import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type ChatMessage = Database["public"]["Tables"]["chat_messages"]["Row"];
export type ChatScope = Database["public"]["Enums"]["chat_scope"];

/**
 * Subscribes to lounge chat messages in realtime.
 * Fetches the most recent 100 messages on mount and appends inserts as they arrive.
 */
export function useLoungeChat(loungeId: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loungeId) {
      setMessages([]);
      setLoading(false);
      return;
    }

    let mounted = true;
    setLoading(true);

    (async () => {
      const { data, error } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("lounge_id", loungeId)
        .order("created_at", { ascending: true })
        .limit(100);
      if (!mounted) return;
      if (error) setError(error.message);
      else setMessages(data ?? []);
      setLoading(false);
    })();

    const channel = supabase
      .channel(`chat:${loungeId}:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
          filter: `lounge_id=eq.${loungeId}`,
        },
        (payload) => {
          const msg = payload.new as ChatMessage;
          setMessages((prev) =>
            prev.some((m) => m.id === msg.id) ? prev : [...prev, msg].slice(-200),
          );
        },
      )
      .subscribe();

    return () => {
      mounted = false;
      void supabase.removeChannel(channel);
    };
  }, [loungeId]);

  const send = useCallback(
    async (body: string, scope: ChatScope = "all") => {
      if (!loungeId) return;
      const trimmed = body.trim();
      if (!trimmed) return;
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      if (!uid) throw new Error("Not signed in");
      const { error } = await supabase.from("chat_messages").insert({
        lounge_id: loungeId,
        scope,
        user_id: uid,
        body: trimmed,
      });
      if (error) throw error;
    },
    [loungeId],
  );

  return { messages, loading, error, send };
}
