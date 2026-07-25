CREATE OR REPLACE FUNCTION public.send_tip(_recipient_user_id uuid, _amount_cents integer, _memo text DEFAULT NULL::text, _lounge_id uuid DEFAULT NULL::uuid, _chat_message_id uuid DEFAULT NULL::uuid, _direct_message_id uuid DEFAULT NULL::uuid, _match_id uuid DEFAULT NULL::uuid)
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
  match_owner uuid;
  msg_match uuid;
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

  -- Server-side validation: a match-linked tip must go to that match's host.
  IF _match_id IS NOT NULL THEN
    SELECT owner_id INTO match_owner FROM public.matches WHERE id = _match_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Match not found';
    END IF;
    IF match_owner IS NULL THEN
      RAISE EXCEPTION 'This match has no host to tip';
    END IF;
    IF match_owner <> _recipient_user_id THEN
      RAISE EXCEPTION 'Recipient does not match the host of this match';
    END IF;

    IF _chat_message_id IS NOT NULL THEN
      SELECT match_id INTO msg_match FROM public.chat_messages WHERE id = _chat_message_id;
      IF FOUND AND msg_match IS NOT NULL AND msg_match <> _match_id THEN
        RAISE EXCEPTION 'Chat message does not belong to this match';
      END IF;
    END IF;
  END IF;

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