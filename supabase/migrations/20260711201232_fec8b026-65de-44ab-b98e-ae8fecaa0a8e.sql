
CREATE OR REPLACE FUNCTION public.validate_wallet_tx_tip_host()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  owner uuid;
  is_tip_credit boolean := (NEW.type = 'credit' AND NEW.external_ref LIKE 'tip:%');
  is_tip_debit  boolean := (NEW.type = 'debit_tip');
BEGIN
  -- Only tip-related rows are checked; other wallet_transactions types
  -- (top-ups, entry fees, refunds, etc.) may legitimately reference a
  -- match without paying the host.
  IF NEW.match_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT (is_tip_credit OR is_tip_debit) THEN
    RETURN NEW;
  END IF;

  SELECT owner_id INTO owner FROM public.matches WHERE id = NEW.match_id;
  -- Missing owner: skip (FK already enforces the match exists; owner may
  -- be null for placeholder matches, in which case tips can't be host-scoped).
  IF owner IS NULL THEN
    RETURN NEW;
  END IF;

  IF is_tip_debit THEN
    -- Sender debit must credit the host as recipient.
    IF NEW.recipient_user_id IS NULL OR NEW.recipient_user_id <> owner THEN
      RAISE EXCEPTION
        'wallet_transactions: debit_tip.recipient_user_id (%) must equal matches.owner_id (%) for match %',
        NEW.recipient_user_id, owner, NEW.match_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF is_tip_credit THEN
    -- Host credit row: user_id (the wallet being credited) must be the host.
    IF NEW.user_id <> owner THEN
      RAISE EXCEPTION
        'wallet_transactions: tip credit.user_id (%) must equal matches.owner_id (%) for match %',
        NEW.user_id, owner, NEW.match_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS wallet_tx_validate_tip_host ON public.wallet_transactions;
CREATE TRIGGER wallet_tx_validate_tip_host
BEFORE INSERT OR UPDATE OF match_id, recipient_user_id, user_id, type, external_ref
ON public.wallet_transactions
FOR EACH ROW EXECUTE FUNCTION public.validate_wallet_tx_tip_host();
