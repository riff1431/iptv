-- tv_stream_sessions: authoritative per-TV upstream session for shared fan-out.
-- One row per TV. Admins control lifecycle; authenticated viewers can read
-- status so the player can show "offline" when the admin has stopped it.
CREATE TABLE public.tv_stream_sessions (
  tv_id uuid PRIMARY KEY REFERENCES public.tvs(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'stopped'
    CHECK (status IN ('starting','live','stopped','error')),
  channel_id text,
  started_at timestamptz,
  stopped_at timestamptz,
  last_playlist_fetch_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.tv_stream_sessions TO authenticated;
GRANT ALL   ON public.tv_stream_sessions TO service_role;

ALTER TABLE public.tv_stream_sessions ENABLE ROW LEVEL SECURITY;

-- Any signed-in user can read session status (needed for the player's
-- "stream offline" state); only admins can write.
CREATE POLICY "auth read stream sessions"
  ON public.tv_stream_sessions FOR SELECT TO authenticated USING (true);

CREATE POLICY "admin write stream sessions"
  ON public.tv_stream_sessions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_tv_stream_sessions_updated
  BEFORE UPDATE ON public.tv_stream_sessions
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Health log lookups are always "latest N for this TV".
CREATE INDEX IF NOT EXISTS idx_stream_health_log_tv_time
  ON public.stream_health_log (tv_id, checked_at DESC);

-- Enable realtime so admins see status flips instantly.
ALTER PUBLICATION supabase_realtime ADD TABLE public.tv_stream_sessions;