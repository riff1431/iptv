CREATE TABLE IF NOT EXISTS public.match_reminders (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, match_id)
);

ALTER TABLE public.match_reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own match reminders" ON public.match_reminders;
CREATE POLICY "Users read own match reminders"
ON public.match_reminders
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users create own match reminders" ON public.match_reminders;
CREATE POLICY "Users create own match reminders"
ON public.match_reminders
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users delete own match reminders" ON public.match_reminders;
CREATE POLICY "Users delete own match reminders"
ON public.match_reminders
FOR DELETE
TO authenticated
USING (user_id = auth.uid());

GRANT SELECT, INSERT, DELETE ON public.match_reminders TO authenticated;
