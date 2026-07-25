
CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.promote_scheduled_matches()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  WITH promoted AS (
    UPDATE public.matches
       SET status = 'live',
           is_active = true,
           updated_at = now()
     WHERE status = 'scheduled'
       AND starts_at IS NOT NULL
       AND starts_at <= now()
    RETURNING id
  )
  SELECT count(*) INTO n FROM promoted;
  RETURN n;
END;
$$;

-- Remove any prior schedule with this name, then (re)schedule every minute.
DO $$
BEGIN
  PERFORM cron.unschedule('promote-scheduled-matches');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'promote-scheduled-matches',
  '* * * * *',
  $$ SELECT public.promote_scheduled_matches(); $$
);
