-- Phase-2: serialize every wallet mutation behind a per-user advisory lock so
-- concurrent operations (parallel tips, parallel entries, parallel withdrawals)
-- cannot pass the same balance check and overdraw / double-spend.
--
-- The lock key is hashtext('wallet:' || user_id::text), shared by ALL money
-- RPCs (send_tip, pay_for_lounge_entry, pay_for_match_entry,
-- create_withdrawal_request, approve_withdrawal_request), so any two mutations
-- for the same user serialize. Locks are transaction-scoped
-- (pg_advisory_xact_lock), released at commit.

-- 1. send_tip: add the per-sender advisory lock before the balance read.
--    Signature is unchanged (CREATE OR REPLACE keeps existing grants).
CREATE OR REPLACE FUNCTION public.send_tip(
  _recipient_user_id uuid,
  _amount_cents integer,
  _memo text DEFAULT NULL,
  _lounge_id uuid DEFAULT NULL,
  _chat_message_id uuid DEFAULT NULL,
  _direct_message_id uuid DEFAULT NULL,
  _match_id uuid DEFAULT NULL
)
RETURNS TABLE(debit_id uuid, credit_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  sender_id uuid := auth.uid();
  balance int;
  d_id uuid;
  c_id uuid;
  clean_memo text := NULLIF(btrim(COALESCE(_memo, '')), '');
BEGIN
  IF sender_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF _recipient_user_id IS NULL OR _recipient_user_id = sender_id THEN
    RAISE EXCEPTION 'Invalid recipient';
  END IF;
  IF _amount_cents IS NULL OR _amount_cents < 100 THEN
    RAISE EXCEPTION 'Minimum tip is $1.00';
  END IF;
  IF _amount_cents > 50000 THEN
    RAISE EXCEPTION 'Maximum tip is $500.00';
  END IF;
  IF clean_memo IS NOT NULL AND char_length(clean_memo) > 200 THEN
    RAISE EXCEPTION 'Note is too long (max 200 characters)';
  END IF;

  -- Serialize per-sender wallet mutations.
  PERFORM pg_advisory_xact_lock(hashtext('wallet:' || sender_id::text));

  SELECT public.wallet_balance_cents(sender_id) INTO balance;
  IF balance < _amount_cents THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  INSERT INTO public.wallet_transactions
    (user_id, type, amount_cents, memo, recipient_user_id, lounge_id, chat_message_id, direct_message_id, match_id)
  VALUES
    (sender_id, 'debit_tip', _amount_cents, clean_memo, _recipient_user_id, _lounge_id, _chat_message_id, _direct_message_id, _match_id)
  RETURNING id INTO d_id;

  INSERT INTO public.wallet_transactions
    (user_id, type, amount_cents, memo, recipient_user_id, lounge_id, chat_message_id, direct_message_id, match_id, external_ref)
  VALUES
    (_recipient_user_id, 'credit', _amount_cents, clean_memo, _recipient_user_id, _lounge_id, _chat_message_id, _direct_message_id, _match_id, 'tip:' || d_id::text)
  RETURNING id INTO c_id;

  RETURN QUERY SELECT d_id, c_id;
END;
$function$;


-- 2. pay_for_lounge_entry: atomically debit + flip an active preview session to
--    paid. Replaces the free-form TS service-role debit (which had a TOCTOU).
CREATE OR REPLACE FUNCTION public.pay_for_lounge_entry(_lounge_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_fee int;
  v_sess record;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('wallet:' || v_user::text));

  -- Already paid an active session? Nothing to do (idempotent).
  PERFORM 1 FROM public.lounge_sessions
    WHERE lounge_id = _lounge_id AND user_id = v_user AND status = 'paid' AND expires_at > now();
  IF FOUND THEN
    RETURN;
  END IF;

  SELECT * INTO v_sess FROM public.lounge_sessions
    WHERE lounge_id = _lounge_id AND user_id = v_user AND status = 'preview' AND expires_at > now()
    ORDER BY entered_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No active session — enter the lounge first';
  END IF;

  SELECT entry_fee_cents INTO v_fee FROM public.lounges WHERE id = _lounge_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lounge not found';
  END IF;

  IF public.wallet_balance_cents(v_user) < v_fee THEN
    RAISE EXCEPTION 'Insufficient wallet balance';
  END IF;

  INSERT INTO public.wallet_transactions (user_id, type, amount_cents, lounge_session_id, memo)
    VALUES (v_user, 'debit_lounge_entry', v_fee, v_sess.id, 'Lounge entry ' || _lounge_id::text);

  UPDATE public.lounge_sessions
    SET status = 'paid', expires_at = now() + interval '1 hour', paid_at = now(), amount_cents = v_fee
    WHERE id = v_sess.id;
END;
$function$;


-- 3. pay_for_match_entry: same as lounge, for match rooms.
CREATE OR REPLACE FUNCTION public.pay_for_match_entry(_match_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_fee int;
  v_sess record;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('wallet:' || v_user::text));

  PERFORM 1 FROM public.match_sessions
    WHERE match_id = _match_id AND user_id = v_user AND status = 'paid' AND expires_at > now();
  IF FOUND THEN
    RETURN;
  END IF;

  SELECT * INTO v_sess FROM public.match_sessions
    WHERE match_id = _match_id AND user_id = v_user AND status = 'preview' AND expires_at > now()
    ORDER BY entered_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No active session — enter the match first';
  END IF;

  SELECT entry_fee_cents INTO v_fee FROM public.matches WHERE id = _match_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Match not found';
  END IF;

  IF public.wallet_balance_cents(v_user) < v_fee THEN
    RAISE EXCEPTION 'Insufficient wallet balance';
  END IF;

  INSERT INTO public.wallet_transactions (user_id, type, amount_cents, match_session_id, memo)
    VALUES (v_user, 'debit_match_entry', v_fee, v_sess.id, 'Match entry ' || _match_id::text);

  UPDATE public.match_sessions
    SET status = 'paid', expires_at = now() + interval '1 hour', paid_at = now(), amount_cents = v_fee
    WHERE id = v_sess.id;
END;
$function$;


-- 4. create_withdrawal_request: atomic available-balance check + insert under
--    the user lock. Replaces the TOCTOU in the TS createWithdrawal.
CREATE OR REPLACE FUNCTION public.create_withdrawal_request(
  _amount_cents integer,
  _method public.withdrawal_method,
  _destination text,
  _user_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_balance int;
  v_pending int;
  v_count bigint;
  v_id uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('wallet:' || v_user::text));

  v_balance := public.wallet_balance_cents(v_user);
  SELECT COALESCE(SUM(amount_cents), 0), COUNT(*)
    INTO v_pending, v_count
    FROM public.withdrawal_requests
    WHERE user_id = v_user AND status IN ('pending', 'approved');

  IF v_count >= 3 THEN
    RAISE EXCEPTION 'You already have 3 unresolved withdrawal requests. Please wait for review.';
  END IF;

  IF _amount_cents > (v_balance - v_pending) THEN
    RAISE EXCEPTION 'Insufficient available balance';
  END IF;

  INSERT INTO public.withdrawal_requests (user_id, amount_cents, method, destination, user_note)
    VALUES (v_user, _amount_cents, _method, _destination, _user_note)
    RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;


-- 5. EXECUTE grants for the three new functions (authenticated + service_role).
REVOKE ALL ON FUNCTION public.pay_for_lounge_entry(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pay_for_lounge_entry(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.pay_for_lounge_entry(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.pay_for_match_entry(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pay_for_match_entry(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.pay_for_match_entry(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_withdrawal_request(integer, public.withdrawal_method, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_withdrawal_request(integer, public.withdrawal_method, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_withdrawal_request(integer, public.withdrawal_method, text, text) TO authenticated, service_role;
