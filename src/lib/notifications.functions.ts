import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

type NotificationKind = Database["public"]["Enums"]["notification_kind"];

const TEST_CATEGORIES = [
  "hostedMatches",
  "liveLobbies",
  "walletChanges",
  "tips",
  "friendRequests",
  "system",
] as const;

type TestCategory = (typeof TEST_CATEGORIES)[number];

const inputSchema = z.object({
  category: z.enum(TEST_CATEGORIES),
});

function payloadFor(
  category: TestCategory,
): { kind: NotificationKind; title: string; body: string; link: string | null } {
  switch (category) {
    case "hostedMatches":
      return {
        kind: "lounge",
        title: "Test: hosted match update",
        body: "A new player joined your test lobby.",
        link: "/dashboard",
      };
    case "liveLobbies":
      return {
        kind: "lounge",
        title: "Test: a lobby just went live",
        body: "This is a test alert for the Live lobbies category.",
        link: "/arena",
      };
    case "walletChanges":
      return {
        kind: "wallet",
        title: "Test: wallet change",
        body: "This is a test transaction notification.",
        link: "/wallet",
      };
    case "tips":
      return {
        kind: "wallet",
        title: "Test: you received a tip",
        body: "Someone sent you a test tip of $1.00.",
        link: "/wallet",
      };
    case "friendRequests":
      return {
        kind: "message",
        title: "Test: friend request",
        body: "A test friend request has arrived.",
        link: "/friends",
      };
    case "system":
      return {
        kind: "system",
        title: "Test: system announcement",
        body: "This is a test system notification.",
        link: null,
      };
  }
}

/**
 * Insert a test notification for the current user in the requested
 * category. The row flows through the normal realtime + prefs pipeline,
 * so the in-app toast (and unread badge) will surface only if the user's
 * saved settings allow it.
 */
export const sendTestNotification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => inputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const p = payloadFor(data.category);
    const { error } = await context.supabase.from("notifications").insert({
      user_id: context.userId,
      kind: p.kind,
      title: p.title,
      body: p.body,
      link: p.link,
    });
    if (error) throw new Error(error.message);
    return { ok: true, category: data.category, kind: p.kind };
  });
