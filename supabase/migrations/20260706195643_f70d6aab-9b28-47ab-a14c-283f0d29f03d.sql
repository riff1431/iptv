
CREATE OR REPLACE FUNCTION public.approve_topup_request(_id uuid, _admin_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  admin_id uuid := auth.uid();
  req record;
  clean_note text := NULLIF(btrim(COALESCE(_admin_note, '')), '');
  credit_id uuid;
BEGIN
  IF admin_id IS NULL OR NOT public.has_role(admin_id, 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT * INTO req FROM public.topup_requests WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Top-up request not found';
  END IF;
  IF req.status <> 'pending' THEN
    RAISE EXCEPTION 'Top-up request is not pending';
  END IF;

  INSERT INTO public.wallet_transactions (user_id, type, amount_cents, memo, external_ref)
  VALUES (
    req.user_id,
    'credit',
    req.amount_cents,
    COALESCE(clean_note, 'Manual top-up'),
    'topup:' || req.id::text
  )
  RETURNING id INTO credit_id;

  UPDATE public.topup_requests
    SET status = 'approved',
        admin_note = clean_note,
        processed_at = now(),
        processed_by = admin_id
    WHERE id = _id;

  INSERT INTO public.notifications (user_id, kind, title, body, link)
  VALUES (
    req.user_id,
    'wallet',
    'Top-up approved',
    'Your top-up of $' || to_char(req.amount_cents::numeric / 100, 'FM999,999,990.00') || ' has been approved and credited to your wallet.'
      || CASE WHEN clean_note IS NOT NULL THEN E'\n\nNote from admin: ' || clean_note ELSE '' END,
    '/wallet?topup=' || req.id::text
  );

  RETURN credit_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reject_topup_request(_id uuid, _admin_note text DEFAULT NULL::text)
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

  SELECT * INTO req FROM public.topup_requests WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Top-up request not found';
  END IF;
  IF req.status <> 'pending' THEN
    RAISE EXCEPTION 'Top-up request is not pending or not found';
  END IF;

  UPDATE public.topup_requests
    SET status = 'rejected',
        admin_note = clean_note,
        processed_at = now(),
        processed_by = admin_id
    WHERE id = _id;

  INSERT INTO public.notifications (user_id, kind, title, body, link)
  VALUES (
    req.user_id,
    'wallet',
    'Top-up rejected',
    'Your top-up request for $' || to_char(req.amount_cents::numeric / 100, 'FM999,999,990.00') || ' was rejected.'
      || CASE WHEN clean_note IS NOT NULL THEN E'\n\nReason: ' || clean_note ELSE '' END,
    '/wallet?topup=' || req.id::text
  );
END;
$function$;
