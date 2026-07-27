-- Phase-1 security fix: route every withdrawal state change and balance debit
-- through SECURITY DEFINER RPCs that mirror approve_topup_request /
-- reject_topup_request. Removes free-form admin UPDATE on withdrawal_requests.
--
-- Before this change, withdrawals never debited wallet_transactions: the "hold"
-- was a client-side computation, so marking a withdrawal paid restored
-- spendable balance and the same funds could be withdrawn again (double-spend).
--
-- Depends on 20260728000002_add_debit_withdrawal_enum.sql (the enum value must
-- already be committed in its own transaction).

-- 1. wallet_balance_cents now subtracts debit_withdrawal too
--    (mirrors 20260727003000_include_vip_in_wallet_balance.sql).
CREATE OR REPLACE FUNCTION public.wallet_balance_cents(_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
  FROM public.wallet_transactions
  WHERE user_id = _user_id
$$;

REVOKE ALL ON FUNCTION public.wallet_balance_cents(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wallet_balance_cents(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.wallet_balance_cents(uuid) TO authenticated, service_role;


-- 2. Approve: atomically debit the wallet and flip pending -> approved.
CREATE OR REPLACE FUNCTION public.approve_withdrawal_request(_id uuid, _admin_note text DEFAULT NULL::text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  admin_id uuid := auth.uid();
  req record;
  clean_note text := NULLIF(btrim(COALESCE(_admin_note, '')), '');
  debit_id uuid;
BEGIN
  IF admin_id IS NULL OR NOT public.has_role(admin_id, 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO req FROM public.withdrawal_requests WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Withdrawal request not found';
  END IF;
  IF req.status <> 'pending' THEN
    RAISE EXCEPTION 'Withdrawal request is not pending';
  END IF;

  -- Re-check funds under the row lock so concurrent approvals or other debits
  -- cannot overdraw the wallet.
  IF public.wallet_balance_cents(req.user_id) < req.amount_cents THEN
    RAISE EXCEPTION 'Insufficient wallet balance for withdrawal %', _id;
  END IF;

  INSERT INTO public.wallet_transactions (user_id, type, amount_cents, memo, external_ref)
  VALUES (
    req.user_id,
    'debit_withdrawal',
    req.amount_cents,
    COALESCE(clean_note, 'Withdrawal'),
    'withdrawal:' || req.id::text
  )
  RETURNING id INTO debit_id;

  UPDATE public.withdrawal_requests
    SET status = 'approved',
        admin_note = clean_note,
        processed_at = now(),
        processed_by = admin_id
    WHERE id = _id;

  INSERT INTO public.notifications (user_id, kind, title, body, link)
  VALUES (
    req.user_id,
    'wallet',
    'Withdrawal approved',
    'Your withdrawal of $' || to_char(req.amount_cents::numeric / 100, 'FM999,999,990.00') || ' has been approved and deducted from your wallet.'
      || CASE WHEN clean_note IS NOT NULL THEN E'\n\nNote from admin: ' || clean_note ELSE '' END,
    '/wallet?withdrawal=' || req.id::text
  );

  RETURN debit_id;
END;
$function$;


-- 3. Reject: pending -> rejected, no balance impact.
CREATE OR REPLACE FUNCTION public.reject_withdrawal_request(_id uuid, _admin_note text DEFAULT NULL::text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  admin_id uuid := auth.uid();
  clean_note text := NULLIF(btrim(COALESCE(_admin_note, '')), '');
  req record;
BEGIN
  IF admin_id IS NULL OR NOT public.has_role(admin_id, 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO req FROM public.withdrawal_requests WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Withdrawal request not found';
  END IF;
  IF req.status <> 'pending' THEN
    RAISE EXCEPTION 'Withdrawal request is not pending';
  END IF;

  UPDATE public.withdrawal_requests
    SET status = 'rejected',
        admin_note = clean_note,
        processed_at = now(),
        processed_by = admin_id
    WHERE id = _id;

  INSERT INTO public.notifications (user_id, kind, title, body, link)
  VALUES (
    req.user_id,
    'wallet',
    'Withdrawal rejected',
    'Your withdrawal request for $' || to_char(req.amount_cents::numeric / 100, 'FM999,999,990.00') || ' was rejected.'
      || CASE WHEN clean_note IS NOT NULL THEN E'\n\nReason: ' || clean_note ELSE '' END,
    '/wallet?withdrawal=' || req.id::text
  );
END;
$function$;


-- 4. Mark an approved withdrawal as paid (no balance effect). Required because
--    free-form admin UPDATE is revoked below, leaving no other path to 'paid'.
CREATE OR REPLACE FUNCTION public.mark_withdrawal_paid(_id uuid, _admin_note text DEFAULT NULL::text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  admin_id uuid := auth.uid();
  clean_note text := NULLIF(btrim(COALESCE(_admin_note, '')), '');
  req record;
BEGIN
  IF admin_id IS NULL OR NOT public.has_role(admin_id, 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO req FROM public.withdrawal_requests WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Withdrawal request not found';
  END IF;
  IF req.status <> 'approved' THEN
    RAISE EXCEPTION 'Only approved withdrawals can be marked paid';
  END IF;

  UPDATE public.withdrawal_requests
    SET status = 'paid',
        admin_note = COALESCE(clean_note, req.admin_note),
        processed_at = now(),
        processed_by = admin_id
    WHERE id = _id;

  INSERT INTO public.notifications (user_id, kind, title, body, link)
  VALUES (
    req.user_id,
    'wallet',
    'Withdrawal sent',
    'Your withdrawal of $' || to_char(req.amount_cents::numeric / 100, 'FM999,999,990.00') || ' has been sent.',
    '/wallet?withdrawal=' || req.id::text
  );
END;
$function$;


-- 5. EXECUTE grants — authenticated (admin calls via the user client, like topup) + service_role.
REVOKE ALL ON FUNCTION public.approve_withdrawal_request(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_withdrawal_request(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.approve_withdrawal_request(uuid, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.reject_withdrawal_request(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_withdrawal_request(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.reject_withdrawal_request(uuid, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.mark_withdrawal_paid(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_withdrawal_paid(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_withdrawal_paid(uuid, text) TO authenticated, service_role;


-- 6. RLS: remove free-form admin UPDATE; the user's own pending->cancelled path
--    survives ("Users cancel own pending withdrawals"). service_role bypasses
--    RLS, so the RPCs above still UPDATE freely.
DROP POLICY IF EXISTS "Admins manage withdrawals" ON public.withdrawal_requests;
