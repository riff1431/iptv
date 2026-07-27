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
  today_start timestamptz := date_trunc('day', now());
  yday_start timestamptz := today_start - interval '1 day';
  now_24h_ago timestamptz := now() - interval '24 hours';
  now_48h_ago timestamptz := now() - interval '48 hours';
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT count(*)::int
  INTO lobbies_today
  FROM public.matches
  WHERE created_at >= today_start;

  SELECT count(*)::int
  INTO lobbies_yesterday
  FROM public.matches
  WHERE created_at >= yday_start AND created_at < today_start;

  SELECT count(*)::int
  INTO live_lobbies_now
  FROM public.matches
  WHERE status = 'live';

  SELECT count(*)::int
  INTO live_lobbies_prev_24h
  FROM public.matches
  WHERE status = 'live'
    AND created_at >= now_48h_ago
    AND created_at < now_24h_ago;

  SELECT count(*)::int
  INTO users_today
  FROM public.profiles
  WHERE created_at >= today_start;

  SELECT count(*)::int
  INTO users_yesterday
  FROM public.profiles
  WHERE created_at >= yday_start AND created_at < today_start;

  WITH combined AS (
    SELECT user_id, created_at
    FROM public.lounge_sessions
    WHERE created_at >= now_48h_ago
    UNION ALL
    SELECT user_id, created_at
    FROM public.match_sessions
    WHERE created_at >= now_48h_ago
  )
  SELECT
    count(DISTINCT user_id) FILTER (WHERE created_at >= now_24h_ago)::int,
    count(DISTINCT user_id) FILTER (
      WHERE created_at >= now_48h_ago AND created_at < now_24h_ago
    )::int
  INTO active_users_24h, active_users_prev_24h
  FROM combined;

  SELECT COALESCE(SUM(amount_cents)::bigint, 0)
  INTO revenue_today_cents
  FROM public.wallet_transactions
  WHERE created_at >= today_start
    AND type IN (
      'debit_lounge_entry',
      'debit_match_entry',
      'debit_tip',
      'debit_vip_upgrade'
    );

  SELECT COALESCE(SUM(amount_cents)::bigint, 0)
  INTO revenue_yesterday_cents
  FROM public.wallet_transactions
  WHERE created_at >= yday_start
    AND created_at < today_start
    AND type IN (
      'debit_lounge_entry',
      'debit_match_entry',
      'debit_tip',
      'debit_vip_upgrade'
    );

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_dashboard_stats() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_dashboard_stats() TO authenticated;
