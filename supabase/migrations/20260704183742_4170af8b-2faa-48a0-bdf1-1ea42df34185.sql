
ALTER TABLE public.direct_messages
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.direct_messages
  DROP CONSTRAINT IF EXISTS direct_messages_body_or_attachment_chk;

ALTER TABLE public.direct_messages
  ADD CONSTRAINT direct_messages_body_or_attachment_chk
  CHECK (length(btrim(body)) > 0 OR jsonb_array_length(attachments) > 0);
