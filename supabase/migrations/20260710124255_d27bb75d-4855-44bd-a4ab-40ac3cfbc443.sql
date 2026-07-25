-- Create matches table
CREATE TABLE public.matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title text NOT NULL DEFAULT '',
  sport text,
  home_label text,
  away_label text,
  home_score integer NOT NULL DEFAULT 0,
  away_score integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'scheduled',
  starts_at timestamptz,
  clock_label text,
  period_label text,
  accent_home text,
  accent_away text,
  thumbnail_url text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.matches TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.matches TO authenticated;
GRANT ALL ON public.matches TO service_role;

ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public matches viewable by everyone"
  ON public.matches FOR SELECT
  TO anon, authenticated
  USING (is_active = true OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert matches"
  ON public.matches FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update matches"
  ON public.matches FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete matches"
  ON public.matches FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER matches_set_updated_at
  BEFORE UPDATE ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Create match_slots table
CREATE TABLE public.match_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  slot smallint NOT NULL CHECK (slot BETWEEN 1 AND 4),
  channel_id text,
  channel_name text,
  channel_logo text,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, slot)
);

GRANT SELECT ON public.match_slots TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.match_slots TO authenticated;
GRANT ALL ON public.match_slots TO service_role;

ALTER TABLE public.match_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public match slots viewable when match is active"
  ON public.match_slots FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.matches m
      WHERE m.id = match_slots.match_id
        AND (m.is_active = true OR public.has_role(auth.uid(), 'admin'))
    )
  );

CREATE POLICY "Admins can insert match slots"
  ON public.match_slots FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update match slots"
  ON public.match_slots FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete match slots"
  ON public.match_slots FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER match_slots_set_updated_at
  BEFORE UPDATE ON public.match_slots
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE INDEX idx_match_slots_match_id ON public.match_slots(match_id);
CREATE INDEX idx_matches_active_sort ON public.matches(is_active, sort_order);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.matches;
ALTER PUBLICATION supabase_realtime ADD TABLE public.match_slots;

-- Swap RPC for reordering
CREATE OR REPLACE FUNCTION public.swap_match_slots(_match_id uuid, _slot_a smallint, _slot_b smallint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL OR NOT public.has_role(uid, 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _slot_a = _slot_b THEN RETURN; END IF;
  IF _slot_a < 1 OR _slot_a > 4 OR _slot_b < 1 OR _slot_b > 4 THEN
    RAISE EXCEPTION 'Invalid slot number';
  END IF;

  UPDATE public.match_slots SET slot = 99 WHERE match_id = _match_id AND slot = _slot_a;
  UPDATE public.match_slots SET slot = _slot_a WHERE match_id = _match_id AND slot = _slot_b;
  UPDATE public.match_slots SET slot = _slot_b WHERE match_id = _match_id AND slot = 99;
END;
$$;