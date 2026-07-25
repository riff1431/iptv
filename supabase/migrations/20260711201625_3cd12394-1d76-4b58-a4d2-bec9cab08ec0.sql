
CREATE UNIQUE INDEX IF NOT EXISTS wallet_tx_tip_credit_external_ref_uniq
ON public.wallet_transactions (external_ref)
WHERE type = 'credit' AND external_ref LIKE 'tip:%';
