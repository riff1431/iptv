
ALTER TABLE public.wallet_transactions
  ADD COLUMN IF NOT EXISTS match_id uuid REFERENCES public.matches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_wallet_tx_match ON public.wallet_transactions(match_id) WHERE match_id IS NOT NULL;

-- Recreate send_tip to accept optional _match_id and stamp both debit and credit rows.
DROP FUNCTION IF EXISTS public.send_tip(uuid, integer, text, uuid, uuid, uuid);

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
