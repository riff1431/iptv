GRANT SELECT ON public.matches TO anon, authenticated;
GRANT SELECT ON public.match_slots TO anon, authenticated;
GRANT SELECT ON public.profiles TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.matches TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.match_slots TO authenticated;
GRANT INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.matches TO service_role;
GRANT ALL ON public.match_slots TO service_role;
GRANT ALL ON public.profiles TO service_role;