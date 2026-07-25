CREATE TABLE public.site_settings (
  id BOOLEAN NOT NULL DEFAULT TRUE PRIMARY KEY CHECK (id = TRUE),
  site_name TEXT NOT NULL DEFAULT 'Sports Lounge — PlayGroundX',
  meta_title TEXT NOT NULL DEFAULT 'Sports Lounge — PlayGroundX',
  meta_description TEXT NOT NULL DEFAULT 'Enter a luxury virtual sports lounge and watch four live sporting events at once. Powered by PlayGroundX.',
  logo_url TEXT,
  favicon_url TEXT,
  og_image_url TEXT,
  twitter_handle TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.site_settings TO anon, authenticated;
GRANT UPDATE, INSERT ON public.site_settings TO authenticated;
GRANT ALL ON public.site_settings TO service_role;

ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read site settings"
  ON public.site_settings FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Admins manage site settings"
  ON public.site_settings FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.site_settings (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.site_settings_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER site_settings_updated_at
  BEFORE UPDATE ON public.site_settings
  FOR EACH ROW EXECUTE FUNCTION public.site_settings_touch_updated_at();