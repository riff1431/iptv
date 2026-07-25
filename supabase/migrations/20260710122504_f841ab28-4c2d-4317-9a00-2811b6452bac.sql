
CREATE OR REPLACE FUNCTION public.swap_tv_slots(_lounge_id uuid, _slot_a smallint, _slot_b smallint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
BEGIN
  IF uid IS NULL OR NOT public.has_role(uid, 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _slot_a = _slot_b THEN RETURN; END IF;
  IF _slot_a < 1 OR _slot_a > 8 OR _slot_b < 1 OR _slot_b > 8 THEN
    RAISE EXCEPTION 'Invalid slot number';
  END IF;

  -- Park slot A at a temp value, move B into A, then park A into B.
  UPDATE public.tvs SET slot = 99 WHERE lounge_id = _lounge_id AND slot = _slot_a;
  UPDATE public.tvs SET slot = _slot_a WHERE lounge_id = _lounge_id AND slot = _slot_b;
  UPDATE public.tvs SET slot = _slot_b WHERE lounge_id = _lounge_id AND slot = 99;
END;
$$;

-- Temporarily relax check for the parking value; use a wider range.
ALTER TABLE public.tvs DROP CONSTRAINT IF EXISTS tvs_slot_check;
ALTER TABLE public.tvs ADD CONSTRAINT tvs_slot_check CHECK (slot >= 1 AND slot <= 99);

GRANT EXECUTE ON FUNCTION public.swap_tv_slots(uuid, smallint, smallint) TO authenticated;
