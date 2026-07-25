
ALTER TABLE public.seg_upstream_failures
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS succeeded boolean NOT NULL DEFAULT false;

ALTER TABLE public.seg_upstream_failures DROP CONSTRAINT IF EXISTS seg_upstream_failures_reason_check;
ALTER TABLE public.seg_upstream_failures
  ADD CONSTRAINT seg_upstream_failures_reason_check
  CHECK (reason = ANY (ARRAY['timeout','non_ok','network_error','exception','success']));

CREATE INDEX IF NOT EXISTS seg_upstream_failures_occurred_at_idx
  ON public.seg_upstream_failures (occurred_at DESC);
