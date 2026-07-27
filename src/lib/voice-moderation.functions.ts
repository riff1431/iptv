import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { RoomServiceClient, TrackSource } from "livekit-server-sdk";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Host-only voice moderation. "Mute All" is a moderation action, so it must be
 * gated: only the lounge/match owner (or an admin) may mute other participants.
 *
 * Muting is performed server-side via LiveKit's RoomService so it affects every
 * participant regardless of their client. Each non-host participant's published
 * microphone track is muted; we never mute the host themselves.
 */

async function isRoomHost(
  userId: string,
  room: string,
  kind: "lounge" | "match",
): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Admins can always moderate.
  const { data: isAdmin } = await supabaseAdmin.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (isAdmin) return true;

  if (kind === "match") {
    const { data } = await supabaseAdmin
      .from("matches")
      .select("owner_id")
      .eq("id", room)
      .maybeSingle();
    return data?.owner_id === userId;
  }
  const { data } = await supabaseAdmin
    .from("lounges")
    .select("owner_user_id")
    .eq("id", room)
    .maybeSingle();
  return data?.owner_user_id === userId;
}

export const muteAllInVoiceRoom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        room: z.string().trim().min(1).max(128),
        kind: z.enum(["lounge", "match"]).optional().default("match"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ muted: number }> => {
    const url = process.env.LIVEKIT_URL;
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!url || !apiKey || !apiSecret) {
      throw new Error("Voice chat is not configured.");
    }

    const host = await isRoomHost(context.userId, data.room, data.kind);
    if (!host) {
      throw new Error("Only the host can mute everyone.");
    }

    const rs = new RoomServiceClient(url, apiKey, apiSecret);

    let participants;
    try {
      participants = await rs.listParticipants(data.room);
    } catch {
      // Room not currently active (no one connected) — nothing to mute.
      return { muted: 0 };
    }

    let muted = 0;
    for (const p of participants) {
      if (p.identity === context.userId) continue; // never mute the host
      for (const t of p.tracks) {
        if (t.source === TrackSource.MICROPHONE) {
          try {
            await rs.mutePublishedTrack(data.room, p.identity, t.sid, true);
            muted += 1;
          } catch {
            // Best-effort per track — keep going so one failure doesn't abort the rest.
          }
        }
      }
    }
    return { muted };
  });
