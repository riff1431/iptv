
CREATE TABLE public.user_match_slot_prefs (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  slot smallint NOT NULL CHECK (slot BETWEEN 1 AND 4),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, match_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_match_slot_prefs TO authenticated;
GRANT ALL ON public.user_match_slot_prefs TO service_role;

ALTER TABLE public.user_match_slot_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own match slot prefs"
ON public.user_match_slot_prefs
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER user_match_slot_prefs_set_updated_at
BEFORE UPDATE ON public.user_match_slot_prefs
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
