import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { AccessToken } from "livekit-server-sdk";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Voice chat (LiveKit) token minter.
 *
 * LiveKit is an external WebRTC SFU. Rooms are created on demand when the first
 * participant connects; we name them by lounge/match id so each viewing room
 * gets its own voice space.
 *
 * Required env: LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET. If any is
 * unset we fail fast with a clear message instead of silently handing the
 * client a useless token. (Moderation — mute-all — lives in
 * voice-moderation.functions.ts and uses the same key/secret via RoomService.)
 */
export const getVoiceToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) =>
    z
      .object({
        /** LiveKit room name. We use the lounge or match id (UUIDs are valid). */
        room: z.string().trim().min(1).max(128),
        /** Optional display identity; defaults to the authenticated user id. */
        identity: z.string().trim().min(1).max(64).optional(),
      })
      .parse(d),
  )
  .handler(
    async ({ data, context }): Promise<{ url: string; token: string }> => {
      const url = process.env.LIVEKIT_URL;
      const apiKey = process.env.LIVEKIT_API_KEY;
      const apiSecret = process.env.LIVEKIT_API_SECRET;
      if (!url || !apiKey || !apiSecret) {
        throw new Error(
          "Voice chat is not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET.",
        );
      }

      const identity = data.identity ?? context.userId;

      const at = new AccessToken(apiKey, apiSecret, {
        identity,
        // 2 hours covers a viewing session; clients auto-reconnect if it lapses.
        ttl: 60 * 60 * 2,
      });
      at.addGrant({
        room: data.room,
        roomJoin: true,
        canPublish: true, // microphone
        canSubscribe: true, // hear others
        canPublishData: false,
        canUpdateOwnMetadata: false,
      });

      const token = await at.toJwt();
      return { url, token };
    },
  );
