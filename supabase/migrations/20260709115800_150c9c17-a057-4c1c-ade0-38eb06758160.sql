
CREATE TABLE public.iptv_proxy_rejections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  request_id TEXT NOT NULL,
  status INTEGER NOT NULL,
  reason TEXT NOT NULL,
  host TEXT,
  raw_url_length INTEGER NOT NULL DEFAULT 0,
  method TEXT NOT NULL DEFAULT 'GET',
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.iptv_proxy_rejections TO authenticated;
GRANT ALL ON public.iptv_proxy_rejections TO service_role;

ALTER TABLE public.iptv_proxy_rejections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view rejections"
  ON public.iptv_proxy_rejections
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX iptv_proxy_rejections_created_at_idx
  ON public.iptv_proxy_rejections (created_at DESC);
CREATE INDEX iptv_proxy_rejections_request_id_idx
  ON public.iptv_proxy_rejections (request_id);
CREATE INDEX iptv_proxy_rejections_host_idx
  ON public.iptv_proxy_rejections (host);
CREATE INDEX iptv_proxy_rejections_reason_idx
  ON public.iptv_proxy_rejections (reason);
