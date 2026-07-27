ALTER TABLE public.iptv_global_catalog_cache
  ADD COLUMN IF NOT EXISTS refresh_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error TEXT;

CREATE OR REPLACE FUNCTION public.claim_iptv_global_catalog_refresh(
  _provider_fingerprint TEXT,
  _force BOOLEAN DEFAULT FALSE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed BOOLEAN;
BEGIN
  UPDATE public.iptv_global_catalog_cache
  SET refresh_started_at = now(),
      last_error = NULL
  WHERE id = TRUE
    AND provider_fingerprint = _provider_fingerprint
    AND (refresh_started_at IS NULL OR refresh_started_at < now() - INTERVAL '10 minutes')
    AND (_force OR fetched_at < now() - INTERVAL '1 hour')
  RETURNING TRUE INTO claimed;

  RETURN COALESCE(claimed, FALSE);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_iptv_global_catalog_refresh(TEXT, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_iptv_global_catalog_refresh(TEXT, BOOLEAN)
  TO service_role;
