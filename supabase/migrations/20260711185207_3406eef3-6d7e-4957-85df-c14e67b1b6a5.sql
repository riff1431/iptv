
ALTER TABLE public.chat_messages ALTER COLUMN lounge_id DROP NOT NULL;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS match_id uuid REFERENCES public.matches(id) ON DELETE CASCADE;
ALTER TABLE public.chat_messages DROP CONSTRAINT IF EXISTS chat_messages_room_xor;
ALTER TABLE public.chat_messages ADD CONSTRAINT chat_messages_room_xor CHECK ((lounge_id IS NOT NULL) <> (match_id IS NOT NULL));
CREATE INDEX IF NOT EXISTS chat_messages_match_id_idx ON public.chat_messages(match_id, created_at);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chat_messages'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages';
  END IF;
END $$;
