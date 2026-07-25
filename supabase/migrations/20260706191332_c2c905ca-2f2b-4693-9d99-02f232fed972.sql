
REVOKE EXECUTE ON FUNCTION public.approve_topup_request(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reject_topup_request(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_topup_request(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_topup_request(uuid, text) TO authenticated;
