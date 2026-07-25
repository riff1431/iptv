
-- Helper (create if missing) — used for updated_at bookkeeping.
CREATE OR REPLACE FUNCTION public.set_updated_at_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 1) Table
CREATE TABLE public.quick_dares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 120),
  icon TEXT NOT NULL DEFAULT 'shield' CHECK (char_length(icon) BETWEEN 1 AND 40),
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0 AND price_cents <= 10000000),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX quick_dares_active_sort_idx
  ON public.quick_dares (is_active, sort_order, created_at);

-- 2) Grants
GRANT SELECT ON public.quick_dares TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quick_dares TO authenticated;
GRANT ALL ON public.quick_dares TO service_role;

-- 3) RLS
ALTER TABLE public.quick_dares ENABLE ROW LEVEL SECURITY;

CREATE POLICY "quick_dares_public_read_active"
  ON public.quick_dares FOR SELECT
  TO anon, authenticated
  USING (is_active = true);

CREATE POLICY "quick_dares_admin_read_all"
  ON public.quick_dares FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "quick_dares_admin_insert"
  ON public.quick_dares FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "quick_dares_admin_update"
  ON public.quick_dares FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "quick_dares_admin_delete"
  ON public.quick_dares FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 4) updated_at trigger
CREATE TRIGGER quick_dares_set_updated_at
  BEFORE UPDATE ON public.quick_dares
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at_timestamp();

-- 5) Seed with current homepage dares.
INSERT INTO public.quick_dares (label, icon, price_cents, sort_order) VALUES
  ('Blow a kiss to the camera', 'shield',   500,  10),
  ('Show your team spirit',    'shield',   700,  20),
  ('Do a sexy stretch',        'scissors', 1000, 30),
  ('Remove 1 accessory',       'shield',   1500, 40),
  ('Let chat pick your pose',  'star',     2000, 50);
