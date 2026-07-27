CREATE TABLE IF NOT EXISTS public.iptv_global_catalog_cache (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  provider_fingerprint TEXT NOT NULL,
  catalog_json TEXT NOT NULL,
  channel_count INTEGER NOT NULL CHECK (channel_count >= 0),
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

REVOKE ALL ON public.iptv_global_catalog_cache FROM anon, authenticated;
GRANT ALL ON public.iptv_global_catalog_cache TO service_role;

ALTER TABLE public.iptv_global_catalog_cache ENABLE ROW LEVEL SECURITY;