
-- Widen slot check to 1..8 and enforce per-match slot_count
ALTER TABLE public.match_slots DROP CONSTRAINT IF EXISTS match_slots_slot_check;
ALTER TABLE public.match_slots ADD CONSTRAINT match_slots_slot_range CHECK (slot >= 1 AND slot <= 8);

-- Trigger: reject slots that exceed the parent match's slot_count
CREATE OR REPLACE FUNCTION public.enforce_match_slot_within_count()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  max_slot smallint;
BEGIN
  SELECT slot_count INTO max_slot FROM public.matches WHERE id = NEW.match_id;
  IF max_slot IS NULL THEN
    RAISE EXCEPTION 'Match % does not exist', NEW.match_id;
  END IF;
  IF NEW.slot < 1 OR NEW.slot > max_slot THEN
    RAISE EXCEPTION 'Slot % is out of range for match (allowed 1..%)', NEW.slot, max_slot;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_match_slots_within_count ON public.match_slots;
CREATE TRIGGER trg_match_slots_within_count
BEFORE INSERT OR UPDATE ON public.match_slots
FOR EACH ROW EXECUTE FUNCTION public.enforce_match_slot_within_count();

-- Trigger: when slot_count decreases, delete orphaned slots above the new limit
CREATE OR REPLACE FUNCTION public.cleanup_match_slots_on_count_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.slot_count < OLD.slot_count THEN
    DELETE FROM public.match_slots
    WHERE match_id = NEW.id AND slot > NEW.slot_count;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_matches_slot_count_cleanup ON public.matches;
CREATE TRIGGER trg_matches_slot_count_cleanup
AFTER UPDATE OF slot_count ON public.matches
FOR EACH ROW
WHEN (NEW.slot_count IS DISTINCT FROM OLD.slot_count)
EXECUTE FUNCTION public.cleanup_match_slots_on_count_change();
