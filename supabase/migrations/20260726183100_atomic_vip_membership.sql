ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_vip boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS vip_expires_at timestamptz;

COMMENT ON COLUMN public.profiles.is_vip IS
  'Canonical VIP entitlement flag. A membership is active only while vip_expires_at is in the future.';
COMMENT ON COLUMN public.profiles.vip_expires_at IS
  'Exclusive end timestamp for the current VIP membership.';

-- Preserve VIP grants that predate the canonical profile fields.
UPDATE public.profiles AS p
SET
  is_vip = true,
  vip_expires_at = COALESCE(
    CASE
      WHEN (u.raw_user_meta_data ->> 'vip_expires_at')
        ~ '^\d{4}-\d{2}-\d{2}T'
      THEN (u.raw_user_meta_data ->> 'vip_expires_at')::timestamptz
      ELSE NULL
    END,
    now() + interval '1 year'
  )
FROM auth.users AS u
WHERE u.id = p.id
  AND COALESCE((u.raw_user_meta_data ->> 'is_vip')::boolean, false)
  AND NOT (
    p.is_vip
    AND p.vip_expires_at IS NOT NULL
    AND p.vip_expires_at > now()
  );

CREATE OR REPLACE FUNCTION public.upgrade_user_vip(_user_id uuid)
RETURNS TABLE (
  is_vip boolean,
  vip_expires_at timestamptz,
  charged boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  profile_row public.profiles%ROWTYPE;
  balance_cents bigint;
  next_expiry timestamptz;
BEGIN
  SELECT *
  INTO profile_row
  FROM public.profiles
  WHERE id = _user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  IF profile_row.is_vip
     AND profile_row.vip_expires_at IS NOT NULL
     AND profile_row.vip_expires_at > now() THEN
    RETURN QUERY
    SELECT true, profile_row.vip_expires_at, false;
    RETURN;
  END IF;

  SELECT public.wallet_balance_cents(_user_id)
  INTO balance_cents;

  IF COALESCE(balance_cents, 0) < 1999 THEN
    RAISE EXCEPTION 'Insufficient wallet balance. Please add credits first.';
  END IF;

  next_expiry := greatest(COALESCE(profile_row.vip_expires_at, now()), now())
    + interval '1 year';

  INSERT INTO public.wallet_transactions (
    user_id,
    type,
    amount_cents,
    memo,
    external_ref
  )
  VALUES (
    _user_id,
    'debit_vip_upgrade',
    1999,
    'VIP Membership Upgrade (1 Year)',
    'vip-membership:' || _user_id::text || ':' ||
      floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint::text
  );

  UPDATE public.profiles
  SET
    is_vip = true,
    vip_expires_at = next_expiry,
    updated_at = now()
  WHERE id = _user_id;

  RETURN QUERY
  SELECT true, next_expiry, true;
END;
$$;

REVOKE ALL ON FUNCTION public.upgrade_user_vip(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upgrade_user_vip(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.upgrade_user_vip(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.upgrade_user_vip(uuid) TO service_role;
