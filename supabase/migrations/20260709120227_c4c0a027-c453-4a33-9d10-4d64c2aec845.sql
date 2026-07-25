
CREATE TABLE public.iptv_proxy_ip_blocks (
  ip TEXT NOT NULL PRIMARY KEY,
  blocked_until TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.iptv_proxy_ip_blocks TO authenticated;
GRANT ALL ON public.iptv_proxy_ip_blocks TO service_role;

ALTER TABLE public.iptv_proxy_ip_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view ip blocks"
  ON public.iptv_proxy_ip_blocks
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX iptv_proxy_ip_blocks_blocked_until_idx
  ON public.iptv_proxy_ip_blocks (blocked_until DESC);
