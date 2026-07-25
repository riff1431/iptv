
REVOKE EXECUTE ON FUNCTION public.promote_scheduled_matches() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_scheduled_matches() TO service_role, postgres;
