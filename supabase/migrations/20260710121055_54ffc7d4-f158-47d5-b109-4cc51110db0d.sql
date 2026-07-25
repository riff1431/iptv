
ALTER TABLE public.lounges
  ADD COLUMN IF NOT EXISTS match_title text,
  ADD COLUMN IF NOT EXISTS match_sport text,
  ADD COLUMN IF NOT EXISTS match_home_label text,
  ADD COLUMN IF NOT EXISTS match_away_label text,
  ADD COLUMN IF NOT EXISTS match_home_score integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS match_away_score integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS match_period_label text,
  ADD COLUMN IF NOT EXISTS match_clock_label text,
  ADD COLUMN IF NOT EXISTS match_thumbnail_url text,
  ADD COLUMN IF NOT EXISTS match_status text NOT NULL DEFAULT 'off',
  ADD COLUMN IF NOT EXISTS match_starts_at timestamptz,
  ADD COLUMN IF NOT EXISTS match_accent_home text,
  ADD COLUMN IF NOT EXISTS match_accent_away text;

ALTER TABLE public.lounges
  DROP CONSTRAINT IF EXISTS lounges_match_status_check;
ALTER TABLE public.lounges
  ADD CONSTRAINT lounges_match_status_check
  CHECK (match_status IN ('off','scheduled','live','halftime','final'));
