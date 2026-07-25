
CREATE TABLE public.payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  label text NOT NULL,
  description text,
  instructions text,
  kind public.topup_method NOT NULL DEFAULT 'other',
  icon text,
  reference_placeholder text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_methods TO authenticated;
GRANT ALL ON public.payment_methods TO service_role;

ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone signed in can view enabled payment methods"
  ON public.payment_methods FOR SELECT
  TO authenticated
  USING (enabled OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert payment methods"
  ON public.payment_methods FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update payment methods"
  ON public.payment_methods FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete payment methods"
  ON public.payment_methods FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_payment_methods_updated_at
  BEFORE UPDATE ON public.payment_methods
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE INDEX idx_payment_methods_enabled_sort
  ON public.payment_methods (enabled, sort_order);

-- Link topup_requests to a configured method (optional; legacy method enum kept for compat)
ALTER TABLE public.topup_requests
  ADD COLUMN payment_method_id uuid REFERENCES public.payment_methods(id) ON DELETE SET NULL;

CREATE INDEX idx_topup_requests_payment_method ON public.topup_requests (payment_method_id);

-- Seed the four legacy methods
INSERT INTO public.payment_methods (code, label, description, instructions, kind, icon, reference_placeholder, sort_order)
VALUES
  ('bank_transfer', 'Bank transfer',
   'Wire or ACH to the operator''s bank account. Include the reference so we can match it.',
   'Transfer to the operator bank account and paste the wire reference. A reviewer will credit your wallet once the funds arrive.',
   'bank_transfer', 'Landmark', 'Transfer / wire reference', 10),
  ('mobile_money', 'Mobile money',
   'bKash / Nagad / similar. Paste the transaction ID from the confirmation SMS.',
   'Send from your mobile wallet and paste the Transaction ID from the confirmation SMS.',
   'mobile_money', 'Smartphone', 'Transaction ID', 20),
  ('cash', 'Cash',
   'In-person cash drop. A reviewer will confirm receipt.',
   'Hand cash to a staff member. Include a receipt # or handler name if you have one.',
   'cash', 'Coins', 'Receipt # or handler name (optional)', 30),
  ('other', 'Other',
   'Describe how the funds were sent in the note below.',
   'Describe the payment channel and provide any reference in the note field.',
   'other', 'MoreHorizontal', 'Reference (optional)', 40)
ON CONFLICT (code) DO NOTHING;
