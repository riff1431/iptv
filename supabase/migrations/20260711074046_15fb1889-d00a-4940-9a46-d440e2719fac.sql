-- Add configurable slot count (1-8) per match, default 4
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS slot_count smallint NOT NULL DEFAULT 4;

ALTER TABLE public.matches
  DROP CONSTRAINT IF EXISTS matches_slot_count_range;

ALTER TABLE public.matches
  ADD CONSTRAINT matches_slot_count_range CHECK (slot_count BETWEEN 1 AND 8);

-- Widen the swap helper to accept 1..8
CREATE OR REPLACE FUNCTION public.swap_match_slots(_match_id uuid, _slot_a smallint, _slot_b smallint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  UPDATE public.match_slots SET slot = 99 WHERE match_id = _match_id AND slot = _slot_a;
  UPDATE public.match_slots SET slot = _slot_a WHERE match_id = _match_id AND slot = _slot_b;
  UPDATE public.match_slots SET slot = _slot_b WHERE match_id = _match_id AND slot = 99;
END;
$function$;
