-- Allow users to pay for a preview session even if it just expired.
-- This fixes the bug where clicking "Pay to stay" right after the timer hits 0
-- throws "No active session — enter the lounge first".

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

  -- Find the latest preview session, even if it just expired.
  SELECT * INTO v_sess FROM public.lounge_sessions
    WHERE lounge_id = _lounge_id AND user_id = v_user AND status = 'preview'
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

  -- Find the latest preview session, even if it just expired.
  SELECT * INTO v_sess FROM public.match_sessions
    WHERE match_id = _match_id AND user_id = v_user AND status = 'preview'
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
