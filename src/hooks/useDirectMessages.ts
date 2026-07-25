import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type DirectMessage = Database["public"]["Tables"]["direct_messages"]["Row"];

/**
 * Subscribes to direct messages for the current user in realtime.
 * If peerId is provided, only messages between the current user and that peer are kept.
 * Otherwise, every DM involving the current user is streamed (inbox mode).
 */
export function useDirectMessages(peerId?: string | null) {
  const [userId, setUserId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [loading, setLoading] = useState(true);

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
    if (!userId) return;
    let mounted = true;
    setLoading(true);

    (async () => {
      let query = supabase
        .from("direct_messages")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (peerId) {
        query = query.or(
          `and(sender_id.eq.${userId},recipient_id.eq.${peerId}),and(sender_id.eq.${peerId},recipient_id.eq.${userId})`,
        );
      } else {
        query = query.or(`sender_id.eq.${userId},recipient_id.eq.${userId}`);
      }
      const { data } = await query;
      if (mounted && data) setMessages([...data].reverse());
      if (mounted) setLoading(false);
    })();

    // Realtime — filter to rows involving me, then narrow to peer in-memory.
    const channel = supabase
      .channel(`dm:${userId}:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "direct_messages",
          filter: `recipient_id=eq.${userId}`,
        },
        (payload) => handleInsert(payload.new as DirectMessage),
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "direct_messages",
          filter: `sender_id=eq.${userId}`,
        },
        (payload) => handleInsert(payload.new as DirectMessage),
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "direct_messages",
          filter: `recipient_id=eq.${userId}`,
        },
        (payload) => handleUpdate(payload.new as DirectMessage),
      )
      .subscribe();

    function handleInsert(m: DirectMessage) {
      if (peerId && m.sender_id !== peerId && m.recipient_id !== peerId) return;
      setMessages((prev) =>
        prev.some((x) => x.id === m.id) ? prev : [...prev, m].slice(-500),
      );
    }

    function handleUpdate(m: DirectMessage) {
      setMessages((prev) => prev.map((x) => (x.id === m.id ? m : x)));
    }

    return () => {
      mounted = false;
      void supabase.removeChannel(channel);
    };
  }, [userId, peerId]);

  const send = useCallback(
    async (recipientId: string, body: string) => {
      if (!userId) throw new Error("Not signed in");
      const trimmed = body.trim();
      if (!trimmed) return;
      const { error } = await supabase.from("direct_messages").insert({
        sender_id: userId,
        recipient_id: recipientId,
        body: trimmed,
      });
      if (error) throw error;
    },
    [userId],
  );

  const unreadCount = messages.filter(
    (m) => m.recipient_id === userId && m.read_at === null,
  ).length;

  return { messages, loading, send, userId, unreadCount };
}
