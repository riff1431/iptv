
-- 1. Extend enum
ALTER TYPE public.wallet_tx_type ADD VALUE IF NOT EXISTS 'debit_tip';
