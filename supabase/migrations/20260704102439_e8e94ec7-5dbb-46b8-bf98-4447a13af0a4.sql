
REVOKE EXECUTE ON FUNCTION public.tg_set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
-- has_role() and get_lounge_tvs() intentionally remain callable: has_role is invoked
-- from RLS policies (needs authenticated EXECUTE) and get_lounge_tvs is the public,
-- safe-column projection used by the lounge viewer.
