import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type TypingUser = { userId: string; name: string; expiresAt: number };
// TTL must exceed THROTTLE so the previous broadcast keeps the indicator
// alive until the next one lands. Leading-edge send (lastSentRef starts at 0)
// keeps the label responsive on the first keystroke after idle.
const THROTTLE_MS = 2500;
const TTL_MS = 4500;

/**
 * Broadcast-based typing indicator for a chat room (match or lounge).
 * Peers publish {userId, name} on a shared broadcast channel; we hold each
 * entry for TTL_MS and auto-expire on a timer so a user that stops typing
 * (or disconnects) drops off cleanly.
 */
export function useTypingIndicator(roomKey: string | null, selfUserId: string | null) {
  const [typing, setTyping] = useState<TypingUser[]>([]);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastSentRef = useRef<number>(0);

  useEffect(() => {
    if (!roomKey) {
      setTyping([]);
      return;
    }
    const channel = supabase.channel(`typing:${roomKey}`, {
      config: { broadcast: { self: false } },
    });
    channel
      .on("broadcast", { event: "typing" }, (payload) => {
        const p = (payload.payload ?? {}) as { userId?: string; name?: string };
        if (!p.userId || p.userId === selfUserId) return;
        const entry: TypingUser = {
          userId: p.userId,
          name: p.name || "Someone",
          expiresAt: Date.now() + TTL_MS,
        };
        setTyping((prev) => {
          const others = prev.filter((t) => t.userId !== entry.userId);
          return [...others, entry];
        });
      })
      .on("broadcast", { event: "typing_stop" }, (payload) => {
        const p = (payload.payload ?? {}) as { userId?: string };
        if (!p.userId || p.userId === selfUserId) return;
        setTyping((prev) => prev.filter((t) => t.userId !== p.userId));
      })
      .subscribe();
    channelRef.current = channel;

    // Sweep expired entries every second.
    const sweep = window.setInterval(() => {
      const now = Date.now();
      setTyping((prev) => {
        const next = prev.filter((t) => t.expiresAt > now);
        return next.length === prev.length ? prev : next;
      });
    }, 1000);

    return () => {
      window.clearInterval(sweep);
      // Best-effort: tell peers we've stopped typing before disconnecting so
      // no one is left "stuck" as typing when we switch rooms or unmount.
      if (selfUserId) {
        try {
          void channel.send({
            type: "broadcast",
            event: "typing_stop",
            payload: { userId: selfUserId },
          });
        } catch {
          // ignore — channel may already be closing
        }
      }
      void supabase.removeChannel(channel);
      channelRef.current = null;
      lastSentRef.current = 0;
      setTyping([]);
    };
  }, [roomKey, selfUserId]);

  const notifyTyping = useCallback(
    (name: string) => {
      const ch = channelRef.current;
      if (!ch || !roomKey || !selfUserId) return;
      const now = Date.now();
      if (now - lastSentRef.current < THROTTLE_MS) return;
      lastSentRef.current = now;
      void ch.send({
        type: "broadcast",
        event: "typing",
        payload: { userId: selfUserId, name },
      });
    },
    [roomKey, selfUserId],
  );

  return { typing, notifyTyping };
}
