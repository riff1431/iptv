
CREATE TYPE public.withdrawal_status AS ENUM ('pending','approved','rejected','paid','cancelled');
CREATE TYPE public.withdrawal_method AS ENUM ('paypal','bank_transfer','crypto');

CREATE TABLE public.withdrawal_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount_cents integer NOT NULL,
  method public.withdrawal_method NOT NULL,
  destination text NOT NULL,
  user_note text,
  status public.withdrawal_status NOT NULL DEFAULT 'pending',
  admin_note text,
  processed_at timestamptz,
  processed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT withdrawal_amount_positive CHECK (amount_cents > 0),
  CONSTRAINT withdrawal_destination_len CHECK (char_length(destination) BETWEEN 3 AND 500)
);

CREATE INDEX idx_withdrawal_user ON public.withdrawal_requests(user_id, created_at DESC);
CREATE INDEX idx_withdrawal_status ON public.withdrawal_requests(status, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.withdrawal_requests TO authenticated;
GRANT ALL ON public.withdrawal_requests TO service_role;

ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own withdrawals"
  ON public.withdrawal_requests FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users create own withdrawals"
  ON public.withdrawal_requests FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND status = 'pending');

CREATE POLICY "Users cancel own pending withdrawals"
  ON public.withdrawal_requests FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND status = 'pending')
  WITH CHECK (user_id = auth.uid() AND status IN ('pending','cancelled'));

CREATE POLICY "Admins manage withdrawals"
  ON public.withdrawal_requests FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_withdrawal_updated_at
  BEFORE UPDATE ON public.withdrawal_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER PUBLICATION supabase_realtime ADD TABLE public.withdrawal_requests;
ALTER TABLE public.withdrawal_requests REPLICA IDENTITY FULL;
