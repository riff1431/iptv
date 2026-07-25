-- Gating fields on matches (default 0 fee, 120s preview so existing matches keep their behavior).
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS entry_fee_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS free_preview_seconds integer NOT NULL DEFAULT 120;

-- Match sessions mirror lounge_sessions.
CREATE TABLE IF NOT EXISTS public.match_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  entered_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  expires_at timestamptz NOT NULL,
  amount_cents integer NOT NULL DEFAULT 0,
  status public.session_status NOT NULL DEFAULT 'preview',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS match_sessions_user_match_idx
  ON public.match_sessions (user_id, match_id, entered_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.match_sessions TO authenticated;
GRANT ALL ON public.match_sessions TO service_role;

ALTER TABLE public.match_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own match sessions" ON public.match_sessions;
CREATE POLICY "Users view own match sessions"
  ON public.match_sessions FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users insert own match sessions" ON public.match_sessions;
CREATE POLICY "Users insert own match sessions"
  ON public.match_sessions FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users update own match sessions" ON public.match_sessions;
CREATE POLICY "Users update own match sessions"
  ON public.match_sessions FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Link wallet transactions to a match session (parallel to lounge_session_id).
ALTER TABLE public.wallet_transactions
  ADD COLUMN IF NOT EXISTS match_session_id uuid
  REFERENCES public.match_sessions(id) ON DELETE SET NULL;

-- Balance must include match-entry debits.
CREATE OR REPLACE FUNCTION public.wallet_balance_cents(_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(SUM(
    CASE
      WHEN type IN ('debit_lounge_entry', 'debit_match_entry', 'debit_tip') THEN -amount_cents
      ELSE amount_cents
    END
  ), 0)::int
  FROM public.wallet_transactions
  WHERE user_id = _user_id
$function$;