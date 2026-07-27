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
        'debit_vip_upgrade'
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
