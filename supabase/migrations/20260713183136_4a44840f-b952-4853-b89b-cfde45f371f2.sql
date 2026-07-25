
-- Admin-only aggregated KPI stats for the dashboard.
CREATE OR REPLACE FUNCTION public.admin_dashboard_stats()
RETURNS TABLE (
  lobbies_today integer,
  lobbies_yesterday integer,
  live_lobbies_now integer,
  live_lobbies_prev_24h integer,
  users_today integer,
  users_yesterday integer,
  active_users_24h integer,
  active_users_prev_24h integer,
  revenue_today_cents bigint,
  revenue_yesterday_cents bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  today_start   timestamptz := date_trunc('day', now());
  yday_start    timestamptz := today_start - interval '1 day';
  now_24h_ago   timestamptz := now() - interval '24 hours';
  now_48h_ago   timestamptz := now() - interval '48 hours';
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT count(*)::int FROM public.matches WHERE created_at >= today_start
    INTO lobbies_today;
  SELECT count(*)::int FROM public.matches
    WHERE created_at >= yday_start AND created_at < today_start
    INTO lobbies_yesterday;

  SELECT count(*)::int FROM public.matches WHERE status = 'live'
    INTO live_lobbies_now;
  -- Approximation: live matches that were created 24-48h ago (proxy for prior period).
  SELECT count(*)::int FROM public.matches
    WHERE status = 'live'
      AND created_at >= now_48h_ago
      AND created_at < now_24h_ago
    INTO live_lobbies_prev_24h;

  SELECT count(*)::int FROM public.profiles WHERE created_at >= today_start
    INTO users_today;
  SELECT count(*)::int FROM public.profiles
    WHERE created_at >= yday_start AND created_at < today_start
    INTO users_yesterday;

  WITH combined AS (
    SELECT user_id, created_at FROM public.lounge_sessions
      WHERE created_at >= now_48h_ago
    UNION ALL
    SELECT user_id, created_at FROM public.match_sessions
      WHERE created_at >= now_48h_ago
  )
  SELECT
    count(DISTINCT user_id) FILTER (WHERE created_at >= now_24h_ago)::int,
    count(DISTINCT user_id) FILTER
      (WHERE created_at >= now_48h_ago AND created_at < now_24h_ago)::int
  INTO active_users_24h, active_users_prev_24h
  FROM combined;

  SELECT COALESCE(SUM(amount_cents)::bigint, 0) FROM public.wallet_transactions
    WHERE created_at >= today_start
      AND type IN ('debit_lounge_entry', 'debit_match_entry', 'debit_tip')
    INTO revenue_today_cents;
  SELECT COALESCE(SUM(amount_cents)::bigint, 0) FROM public.wallet_transactions
    WHERE created_at >= yday_start AND created_at < today_start
      AND type IN ('debit_lounge_entry', 'debit_match_entry', 'debit_tip')
    INTO revenue_yesterday_cents;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_dashboard_stats() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_dashboard_stats() TO authenticated;

-- Admin-only distinct viewer counts per match over the last 24 hours.
CREATE OR REPLACE FUNCTION public.admin_match_viewer_counts(_match_ids uuid[])
RETURNS TABLE (match_id uuid, viewers_24h integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  since timestamptz := now() - interval '24 hours';
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT ms.match_id, count(DISTINCT ms.user_id)::int AS viewers_24h
  FROM public.match_sessions ms
  WHERE ms.match_id = ANY(_match_ids)
    AND ms.entered_at >= since
  GROUP BY ms.match_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_match_viewer_counts(uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_match_viewer_counts(uuid[]) TO authenticated;
