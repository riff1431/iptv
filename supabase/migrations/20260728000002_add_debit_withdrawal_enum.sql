-- Phase-1: add the debit_withdrawal ledger type for cash-out.
--
-- This MUST live in its own migration file (own transaction). Postgres forbids
-- using a newly-added enum value within the same transaction that added it, so
-- any function/policy that references 'debit_withdrawal' has to be created in a
-- later migration (see 20260728000003_withdrawal_ledger_and_rpcs.sql).

ALTER TYPE public.wallet_tx_type ADD VALUE IF NOT EXISTS 'debit_withdrawal';
