CREATE TABLE IF NOT EXISTS public.lounge_reminders (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lounge_id uuid NOT NULL REFERENCES public.lounges(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, lounge_id)
);

ALTER TABLE public.lounge_reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own lounge reminders" ON public.lounge_reminders;
CREATE POLICY "Users read own lounge reminders"
ON public.lounge_reminders
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users create own lounge reminders" ON public.lounge_reminders;
CREATE POLICY "Users create own lounge reminders"
ON public.lounge_reminders
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users delete own lounge reminders" ON public.lounge_reminders;
CREATE POLICY "Users delete own lounge reminders"
ON public.lounge_reminders
FOR DELETE
TO authenticated
USING (user_id = auth.uid());

GRANT SELECT, INSERT, DELETE ON public.lounge_reminders TO authenticated;