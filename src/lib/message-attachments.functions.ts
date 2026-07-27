import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const BUCKET = "message-attachments";
const SIGNED_URL_TTL = 60 * 60; // 1 hour

const inputSchema = z.object({
  messageId: z.string().uuid(),
  path: z.string().min(1).max(512),
});

/**
 * Returns a short-lived signed URL for a message attachment.
 * Verifies the caller is either the sender or recipient of the message,
 * and that the requested `path` is actually attached to that message.
 */
export const getMessageAttachmentUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: msg, error } = await supabase
      .from("direct_messages")
      .select("id, sender_id, recipient_id, attachments")
      .eq("id", data.messageId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!msg) throw new Error("Message not found");
    if (msg.sender_id !== userId && msg.recipient_id !== userId) {
      throw new Error("Forbidden");
    }

    const attachments = Array.isArray(msg.attachments) ? msg.attachments : [];
    const match = attachments.find(
      (a: unknown) =>
        typeof a === "object" &&
        a !== null &&
        "path" in a &&
        (a as { path: unknown }).path === data.path,
    );
    if (!match) throw new Error("Attachment not part of this message");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl(data.path, SIGNED_URL_TTL);
    if (signErr || !signed) throw new Error(signErr?.message ?? "Failed to sign URL");

    return { url: signed.signedUrl, expiresAt: Date.now() + SIGNED_URL_TTL * 1000 };
  });
