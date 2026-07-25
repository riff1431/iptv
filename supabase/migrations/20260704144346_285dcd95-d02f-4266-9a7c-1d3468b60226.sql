-- Balance helper: credits + refunds minus debits, for the given user.
CREATE OR REPLACE FUNCTION public.wallet_balance_cents(_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(
    CASE
      WHEN type = 'debit_lounge_entry' THEN -amount_cents
      ELSE amount_cents
    END
  ), 0)::int
  FROM public.wallet_transactions
  WHERE user_id = _user_id
$$;

GRANT EXECUTE ON FUNCTION public.wallet_balance_cents(uuid) TO authenticated, service_role;

-- Server-only writes to wallet_transactions (service_role already has ALL implicitly,
-- but make it explicit and safe).
GRANT INSERT ON public.wallet_transactions TO service_role;

-- Server-only updates to lounge_sessions (extend expiry, flip status to paid).
GRANT UPDATE ON public.lounge_sessions TO service_role;