
CREATE TABLE public.seg_upstream_failures (
  id BIGSERIAL PRIMARY KEY,
  tv_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('playlist', 'segment')),
  reason TEXT NOT NULL CHECK (reason IN ('timeout', 'non_ok', 'network_error', 'exception')),
  status INTEGER,
  upstream_host TEXT,
  duration_ms INTEGER,
  message TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX seg_upstream_failures_tv_time_idx
  ON public.seg_upstream_failures (tv_id, occurred_at DESC);
CREATE INDEX seg_upstream_failures_time_idx
  ON public.seg_upstream_failures (occurred_at DESC);

GRANT ALL ON public.seg_upstream_failures TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.seg_upstream_failures_id_seq TO service_role;
GRANT SELECT ON public.seg_upstream_failures TO authenticated;

ALTER TABLE public.seg_upstream_failures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read seg failures"
  ON public.seg_upstream_failures
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
