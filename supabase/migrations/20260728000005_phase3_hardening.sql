-- Phase 3: privacy + defense-in-depth hardening.
--
-- NOTE: FORCE ROW LEVEL SECURITY is intentionally NOT added here. All writes to
-- wallet_transactions / topup_requests / withdrawal_requests / admin_audit_log
-- happen via SECURITY DEFINER RPCs that run as the table OWNER, and there are
-- no owner-scoped INSERT/UPDATE policies on those tables. Forcing RLS would
-- make the owner subject to deny-by-default and break every money/audit RPC.
-- (Would require first adding explicit owner-context policies — deferred.)

-- 1. wallet_balance_cents: own-or-admin guard.
--    Previously any authenticated user could pass an arbitrary _user_id and read
--    anyone's wallet balance. Now: a logged-in caller may only read their own
--    balance (or any, if admin). service_role (auth.uid() IS NULL) still passes,
--    so server-side admin functions that call it via supabaseAdmin keep working.
CREATE OR REPLACE FUNCTION public.wallet_balance_cents(_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _balance integer;
BEGIN
  IF auth.uid() IS NOT NULL
     AND _user_id <> auth.uid()
     AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT COALESCE(SUM(
    CASE
      WHEN type IN (
        'debit_lounge_entry',
        'debit_match_entry',
        'debit_tip',
        'debit_vip_upgrade',
        'debit_withdrawal'
      ) THEN -amount_cents
      ELSE amount_cents
    END
  ), 0)::int
  INTO _balance
  FROM public.wallet_transactions
  WHERE user_id = _user_id;

  RETURN _balance;
END;
$function$;
-- Grants retained from 20260728000003 (EXECUTE to authenticated, service_role).


-- 2. auto_confirm_new_user() is the one SECURITY DEFINER function created after
--    the 20260712104715 hardening pass that still defaults to PUBLIC EXECUTE.
--    It's an auth.users trigger (executes via trigger regardless of EXECUTE
--    grants), so revoke direct EXECUTE from client roles; keep service_role.
REVOKE ALL ON FUNCTION public.auto_confirm_new_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auto_confirm_new_user() FROM anon;
REVOKE ALL ON FUNCTION public.auto_confirm_new_user() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.auto_confirm_new_user() TO service_role;


-- 3. topup_requests: drop the free-form admin UPDATE policy (mirror
--    withdrawal_requests from 20260728000003). Admin status changes go through
--    approve_topup_request / reject_topup_request (SECURITY DEFINER). This
--    stops an admin (or compromised admin) from bumping amount_cents / user_id
--    on a pending request before approving. The user's own pending->cancelled
--    path ("Users cancel own pending topups") is retained.
DROP POLICY IF EXISTS "Admins manage topups" ON public.topup_requests;
