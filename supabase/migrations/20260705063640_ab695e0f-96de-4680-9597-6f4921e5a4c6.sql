
-- 1. Add match/score columns to tvs
ALTER TABLE public.tvs
  ADD COLUMN IF NOT EXISTS sport TEXT,
  ADD COLUMN IF NOT EXISTS matchup TEXT,
  ADD COLUMN IF NOT EXISTS home_label TEXT,
  ADD COLUMN IF NOT EXISTS away_label TEXT,
  ADD COLUMN IF NOT EXISTS home_score INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS away_score INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS period_label TEXT,
  ADD COLUMN IF NOT EXISTS clock_label TEXT,
  ADD COLUMN IF NOT EXISTS accent_home TEXT,
  ADD COLUMN IF NOT EXISTS accent_away TEXT;

-- 2. Add cover + featured to lounges
ALTER TABLE public.lounges
  ADD COLUMN IF NOT EXISTS cover_image_url TEXT,
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT false;

-- 3. GRANTs (Data API access — previously missing)
GRANT SELECT ON public.lounges TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lounges TO authenticated;
GRANT ALL ON public.lounges TO service_role;

GRANT SELECT ON public.tvs TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tvs TO authenticated;
GRANT ALL ON public.tvs TO service_role;

-- 4. Public SELECT for TVs whose lounge is public+active
DROP POLICY IF EXISTS "Public TVs viewable by anyone" ON public.tvs;
CREATE POLICY "Public TVs viewable by anyone"
  ON public.tvs FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.lounges l
      WHERE l.id = tvs.lounge_id
        AND l.is_active = true
        AND l.is_private = false
    )
  );

-- Owner of a private lounge can see its TVs
DROP POLICY IF EXISTS "Owner TVs viewable" ON public.tvs;
CREATE POLICY "Owner TVs viewable"
  ON public.tvs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.lounges l
      WHERE l.id = tvs.lounge_id AND l.owner_user_id = auth.uid()
    )
  );

-- Add anon SELECT to lounges (existing policy is TO public which already covers anon,
-- but ensure it's explicit)
DROP POLICY IF EXISTS "Public lounges viewable by anyone" ON public.lounges;
CREATE POLICY "Public lounges viewable by anyone"
  ON public.lounges FOR SELECT
  TO anon, authenticated
  USING (is_active = true AND is_private = false);

-- Owners can update/delete their own private lounge
DROP POLICY IF EXISTS "Owners manage own lounges" ON public.lounges;
CREATE POLICY "Owners manage own lounges"
  ON public.lounges FOR ALL
  TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

-- 5. Realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.tvs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.lounges;

-- 6. Seed additional lounges + TVs (idempotent by slug)
INSERT INTO public.lounges (slug, name, tagline, vibe, entry_fee_cents, free_preview_seconds, is_active, is_private, is_featured, sort_order)
VALUES
  ('primetime', 'Primetime Arena', 'Every major game, one room.', 'Flagship', 500, 120, true, false, true, 1),
  ('combat',    'Combat Room',     'Fights only. All night.',    'Themed',   500, 120, true, false, false, 2),
  ('worldcup',  'Global Pitch',    'Football from every continent.', 'Free',   0,   0, true, false, false, 3)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  tagline = EXCLUDED.tagline,
  vibe = EXCLUDED.vibe,
  entry_fee_cents = EXCLUDED.entry_fee_cents,
  free_preview_seconds = EXCLUDED.free_preview_seconds,
  is_active = true,
  is_private = false;

-- Seed TVs for each lounge (idempotent by lounge_id + slot)
DO $$
DECLARE
  primetime_id UUID;
  combat_id UUID;
  worldcup_id UUID;
BEGIN
  SELECT id INTO primetime_id FROM public.lounges WHERE slug = 'primetime';
  SELECT id INTO combat_id    FROM public.lounges WHERE slug = 'combat';
  SELECT id INTO worldcup_id  FROM public.lounges WHERE slug = 'worldcup';

  -- Primetime
  INSERT INTO public.tvs (lounge_id, slot, display_name, sport, matchup, home_label, away_label, home_score, away_score, period_label, clock_label, enabled)
  VALUES
    (primetime_id, 1, 'TV 1', 'NBA',    'Lakers vs Celtics',           'LAL', 'BOS', 98, 95, '4TH', '6:32', true),
    (primetime_id, 2, 'TV 2', 'Soccer', 'Man City vs Arsenal',          'MCI', 'ARS', 2,  1, '78''', '',    true),
    (primetime_id, 3, 'TV 3', 'UFC',    'Main Card — UFC 312',          NULL, NULL,   0,  0, 'ROUND 2', '2:45', true),
    (primetime_id, 4, 'TV 4', 'NHL',    'Avalanche vs Golden Knights',  'COL', 'VGK', 1,  0, '2ND', '11:47', true)
  ON CONFLICT DO NOTHING;

  -- Combat
  INSERT INTO public.tvs (lounge_id, slot, display_name, sport, matchup, enabled)
  VALUES
    (combat_id, 1, 'TV 1', 'UFC',        'Prelims',           true),
    (combat_id, 2, 'TV 2', 'Boxing',     'PBC Fight Night',   true),
    (combat_id, 3, 'TV 3', 'MMA',        'Bellator Live',     true),
    (combat_id, 4, 'TV 4', 'Kickboxing', 'GLORY Grand Prix',  true)
  ON CONFLICT DO NOTHING;

  -- World Cup / Global Pitch
  INSERT INTO public.tvs (lounge_id, slot, display_name, sport, matchup, home_label, away_label, home_score, away_score, period_label, enabled)
  VALUES
    (worldcup_id, 1, 'TV 1', 'EPL',     'Liverpool vs Chelsea',    'LIV', 'CHE', 1, 1, '55''', true),
    (worldcup_id, 2, 'TV 2', 'La Liga', 'Real Madrid vs Sevilla',  'RMA', 'SEV', 2, 0, '62''', true),
    (worldcup_id, 3, 'TV 3', 'Serie A', 'Inter vs Juventus',       'INT', 'JUV', 0, 0, '30''', true),
    (worldcup_id, 4, 'TV 4', 'MLS',     'Inter Miami vs LAFC',     'MIA', 'LAFC', 3, 2, '80''', true)
  ON CONFLICT DO NOTHING;
END $$;
