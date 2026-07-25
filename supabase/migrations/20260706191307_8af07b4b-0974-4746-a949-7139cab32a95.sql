
-- Enums
CREATE TYPE public.topup_status AS ENUM ('pending', 'approved', 'rejected', 'cancelled');
CREATE TYPE public.topup_method AS ENUM ('bank_transfer', 'mobile_money', 'cash', 'other');

-- Table
CREATE TABLE public.topup_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_cents  integer NOT NULL,
  method        public.topup_method NOT NULL,
  reference     text,
  user_note     text,
  status        public.topup_status NOT NULL DEFAULT 'pending',
  admin_note    text,
  processed_at  timestamptz,
  processed_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT topup_amount_positive CHECK (amount_cents > 0 AND amount_cents <= 1000000),
  CONSTRAINT topup_reference_len   CHECK (reference IS NULL OR char_length(reference) <= 200),
  CONSTRAINT topup_user_note_len   CHECK (user_note IS NULL OR char_length(user_note) <= 500),
  CONSTRAINT topup_admin_note_len  CHECK (admin_note IS NULL OR char_length(admin_note) <= 500)
);

CREATE INDEX idx_topup_user   ON public.topup_requests(user_id, created_at DESC);
CREATE INDEX idx_topup_status ON public.topup_requests(status, created_at DESC);

-- Grants
GRANT SELECT, INSERT, UPDATE ON public.topup_requests TO authenticated;
GRANT ALL ON public.topup_requests TO service_role;

-- RLS
ALTER TABLE public.topup_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own topups"
  ON public.topup_requests FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users create own topups"
  ON public.topup_requests FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND status = 'pending');

CREATE POLICY "Users cancel own pending topups"
  ON public.topup_requests FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND status = 'pending')
  WITH CHECK (user_id = auth.uid() AND status IN ('pending', 'cancelled'));

CREATE POLICY "Admins manage topups"
  ON public.topup_requests FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Updated-at trigger
CREATE TRIGGER trg_topup_updated_at
  BEFORE UPDATE ON public.topup_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Approve RPC: atomically mark approved and credit the wallet
CREATE OR REPLACE FUNCTION public.approve_topup_request(_id uuid, _admin_note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  RETURN credit_id;
END;
$$;

-- Reject RPC
CREATE OR REPLACE FUNCTION public.reject_topup_request(_id uuid, _admin_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  admin_id uuid := auth.uid();
  clean_note text := NULLIF(btrim(COALESCE(_admin_note, '')), '');
BEGIN
  IF admin_id IS NULL OR NOT public.has_role(admin_id, 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.topup_requests
    SET status = 'rejected',
        admin_note = clean_note,
        processed_at = now(),
        processed_by = admin_id
    WHERE id = _id AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Top-up request is not pending or not found';
  END IF;
END;
$$;
