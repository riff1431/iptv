
-- 1. Link columns on wallet_transactions
ALTER TABLE public.wallet_transactions
  ADD COLUMN IF NOT EXISTS recipient_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS lounge_id uuid REFERENCES public.lounges(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS chat_message_id uuid REFERENCES public.chat_messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS direct_message_id uuid REFERENCES public.direct_messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_wallet_tx_recipient
  ON public.wallet_transactions(recipient_user_id, created_at DESC)
  WHERE recipient_user_id IS NOT NULL;

-- 2. Update balance function to also subtract tips
CREATE OR REPLACE FUNCTION public.wallet_balance_cents(_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(
    CASE
      WHEN type IN ('debit_lounge_entry', 'debit_tip') THEN -amount_cents
      ELSE amount_cents
    END
  ), 0)::int
  FROM public.wallet_transactions
  WHERE user_id = _user_id
$$;

-- 3. Recipient can read their incoming tip rows
CREATE POLICY "Recipients read incoming tips"
  ON public.wallet_transactions FOR SELECT TO authenticated
  USING (recipient_user_id = auth.uid() AND type = 'credit');

-- 4. send_tip RPC (atomic debit + credit)
CREATE OR REPLACE FUNCTION public.send_tip(
  _recipient_user_id uuid,
  _amount_cents integer,
  _memo text DEFAULT NULL,
  _lounge_id uuid DEFAULT NULL,
  _chat_message_id uuid DEFAULT NULL,
  _direct_message_id uuid DEFAULT NULL
)
RETURNS TABLE(debit_id uuid, credit_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    (user_id, type, amount_cents, memo, recipient_user_id, lounge_id, chat_message_id, direct_message_id)
  VALUES
    (sender_id, 'debit_tip', _amount_cents, clean_memo, _recipient_user_id, _lounge_id, _chat_message_id, _direct_message_id)
  RETURNING id INTO d_id;

  INSERT INTO public.wallet_transactions
    (user_id, type, amount_cents, memo, recipient_user_id, lounge_id, chat_message_id, direct_message_id, external_ref)
  VALUES
    (_recipient_user_id, 'credit', _amount_cents, clean_memo, _recipient_user_id, _lounge_id, _chat_message_id, _direct_message_id, 'tip:' || d_id::text)
  RETURNING id INTO c_id;

  RETURN QUERY SELECT d_id, c_id;
END;
$$;

REVOKE ALL ON FUNCTION public.send_tip(uuid, integer, text, uuid, uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.send_tip(uuid, integer, text, uuid, uuid, uuid) TO authenticated;
