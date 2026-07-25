import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ChatMessage, ChatScope } from "@/hooks/useLoungeChat";

/**
 * Merge a message into the list:
 *  - dedupe by id
 *  - reconcile a matching optimistic (pending_*) entry from the same user+body
 *  - keep the list sorted by created_at asc
 *  - cap history so long sessions don't grow unbounded
 */
function mergeMessage(prev: ChatMessage[], incoming: ChatMessage): ChatMessage[] {
  // If we already have this id, keep the newer/authoritative row.
  const existingIdx = prev.findIndex((m) => m.id === incoming.id);
  let next: ChatMessage[];
  if (existingIdx >= 0) {
    next = prev.slice();
    next[existingIdx] = incoming;
  } else {
    // Try to replace a matching optimistic placeholder for the same user+body.
    const optimisticIdx = prev.findIndex(
      (m) =>
        m.id.startsWith("pending_") &&
        m.user_id === incoming.user_id &&
        m.body === incoming.body,
    );
    if (optimisticIdx >= 0) {
      next = prev.slice();
      next[optimisticIdx] = incoming;
    } else {
      next = [...prev, incoming];
    }
  }
  next.sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  return next.slice(-200);
}

/**
 * Subscribes to per-match chat messages in realtime with dedupe + ordering
 * and optimistic sends.
 */
export function useMatchChat(matchId: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!matchId) {
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
        .eq("match_id", matchId)
        .order("created_at", { ascending: true })
        .limit(100);
      if (!mounted) return;
      if (error) setError(error.message);
      else {
        const rows = (data ?? []) as ChatMessage[];
        // Ensure deterministic ordering + dedupe on initial load too.
        const seen = new Set<string>();
        const clean = rows.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
        clean.sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        );
        setMessages(clean);
      }
      setLoading(false);
    })();

    const channel = supabase
      .channel(`match-chat:${matchId}:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
          filter: `match_id=eq.${matchId}`,
        },
        (payload) => {
          const msg = payload.new as ChatMessage;
          setMessages((prev) => mergeMessage(prev, msg));
        },
      )
      .subscribe();

    return () => {
      mounted = false;
      void supabase.removeChannel(channel);
    };
  }, [matchId]);

  const send = useCallback(
    async (body: string, scope: ChatScope = "all") => {
      if (!matchId) return;
      const trimmed = body.trim();
      if (!trimmed) return;
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      if (!uid) throw new Error("Not signed in");

      // Optimistic entry — replaced when the authoritative row arrives
      // (either via insert().select() or the realtime INSERT echo).
      const tempId = `pending_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const optimistic: ChatMessage = {
        id: tempId,
        match_id: matchId,
        lounge_id: null,
        user_id: uid,
        body: trimmed,
        scope,
        created_at: new Date().toISOString(),
      } as ChatMessage;
      setMessages((prev) => mergeMessage(prev, optimistic));

      const { data, error } = await supabase
        .from("chat_messages")
        .insert({
          match_id: matchId,
          lounge_id: null,
          scope,
          user_id: uid,
          body: trimmed,
        })
        .select("*")
        .single();

      if (error) {
        // Roll back the optimistic entry so the user sees the send failed.
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        throw error;
      }
      if (data) {
        setMessages((prev) => mergeMessage(prev, data as ChatMessage));
      }
    },
    [matchId],
  );

  return { messages, loading, error, send };
}
