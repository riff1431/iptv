
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS iptv_provider_type text NOT NULL DEFAULT 'm3u',
  ADD COLUMN IF NOT EXISTS iptv_m3u_url text,
  ADD COLUMN IF NOT EXISTS iptv_xtream_server_url text,
  ADD COLUMN IF NOT EXISTS iptv_xtream_username text,
  ADD COLUMN IF NOT EXISTS iptv_xtream_password_encrypted text,
  ADD COLUMN IF NOT EXISTS iptv_epg_url text;

ALTER TABLE public.app_settings
  DROP CONSTRAINT IF EXISTS app_settings_iptv_provider_type_check;
ALTER TABLE public.app_settings
  ADD CONSTRAINT app_settings_iptv_provider_type_check
    CHECK (iptv_provider_type IN ('m3u', 'xtream'));

CREATE OR REPLACE FUNCTION public.get_public_iptv_provider()
RETURNS TABLE(provider_type text, m3u_url text, xtream_server_url text, epg_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT iptv_provider_type, iptv_m3u_url, iptv_xtream_server_url, iptv_epg_url
  FROM public.app_settings
  WHERE id = true
$$;

GRANT EXECUTE ON FUNCTION public.get_public_iptv_provider() TO anon, authenticated;
