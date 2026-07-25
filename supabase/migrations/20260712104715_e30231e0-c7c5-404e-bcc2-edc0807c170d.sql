
-- ============================================================
-- 1. chat_messages: scope reads to lounge/match access
-- ============================================================
DROP POLICY IF EXISTS "Signed-in users read lounge chat" ON public.chat_messages;

CREATE POLICY "auth read scoped lounge chat"
ON public.chat_messages
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR user_id = auth.uid()
  OR (
    lounge_id IS NOT NULL AND (
      EXISTS (SELECT 1 FROM public.lounges l WHERE l.id = chat_messages.lounge_id AND l.owner_user_id = auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.lounge_sessions s
        WHERE s.lounge_id = chat_messages.lounge_id
          AND s.user_id = auth.uid()
          AND (s.expires_at IS NULL OR s.expires_at > now())
      )
    )
  )
  OR (
    match_id IS NOT NULL AND (
      EXISTS (SELECT 1 FROM public.matches m WHERE m.id = chat_messages.match_id AND m.owner_id = auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.match_sessions s
        WHERE s.match_id = chat_messages.match_id
          AND s.user_id = auth.uid()
          AND (s.expires_at IS NULL OR s.expires_at > now())
      )
    )
  )
);

-- ============================================================
-- 2. tv_stream_sessions: admins + lounge owners only
-- ============================================================
DROP POLICY IF EXISTS "auth read stream sessions" ON public.tv_stream_sessions;

CREATE POLICY "auth read scoped stream sessions"
ON public.tv_stream_sessions
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1 FROM public.tvs t
    JOIN public.lounges l ON l.id = t.lounge_id
    WHERE t.id = tv_stream_sessions.tv_id
      AND l.owner_user_id = auth.uid()
  )
);

-- ============================================================
-- 3. ad_schedules: scope reads
-- ============================================================
DROP POLICY IF EXISTS "Signed-in users see active schedules" ON public.ad_schedules;

CREATE POLICY "auth read scoped ad schedules"
ON public.ad_schedules
FOR SELECT
TO authenticated
USING (
  is_active AND (
    public.has_role(auth.uid(), 'admin')
    OR lounge_id IS NULL
    OR EXISTS (SELECT 1 FROM public.lounges l WHERE l.id = ad_schedules.lounge_id AND l.owner_user_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.lounge_sessions s
      WHERE s.lounge_id = ad_schedules.lounge_id
        AND s.user_id = auth.uid()
        AND (s.expires_at IS NULL OR s.expires_at > now())
    )
  )
);

-- ============================================================
-- 4. ads: only ads referenced by an accessible active schedule
-- ============================================================
DROP POLICY IF EXISTS "Signed-in users see active ads" ON public.ads;

CREATE POLICY "auth read scoped active ads"
ON public.ads
FOR SELECT
TO authenticated
USING (
  is_active AND (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.ad_schedules s
      WHERE s.is_active
        AND ads.id = ANY(s.ad_ids)
        AND (
          s.lounge_id IS NULL
          OR EXISTS (SELECT 1 FROM public.lounges l WHERE l.id = s.lounge_id AND l.owner_user_id = auth.uid())
          OR EXISTS (
            SELECT 1 FROM public.lounge_sessions ls
            WHERE ls.lounge_id = s.lounge_id
              AND ls.user_id = auth.uid()
              AND (ls.expires_at IS NULL OR ls.expires_at > now())
          )
        )
    )
  )
);

-- ============================================================
-- 5. tvs: hide credentials + stream URL from public/authenticated
-- ============================================================
-- Column-level SELECT restrictions.
REVOKE SELECT ON public.tvs FROM anon, authenticated;

-- Safe columns (no credentials, no raw stream URL).
GRANT SELECT
  (id, lounge_id, slot, display_name, provider_name, connection_type,
   selected_channel_id, selected_channel_name, selected_channel_logo,
   enabled, status, last_status_message, last_checked_at,
   created_at, updated_at, sport, matchup,
   home_label, away_label, home_score, away_score,
   period_label, clock_label, accent_home, accent_away)
ON public.tvs TO anon, authenticated;

-- Preserve write privileges for authenticated (RLS still restricts writes to admins).
GRANT INSERT, UPDATE, DELETE ON public.tvs TO authenticated;
GRANT ALL ON public.tvs TO service_role;

-- Add an admin-only SELECT policy so admins can still read every column via
-- explicit selects when column-level grants allow them (they do at the table
-- level via authenticated). Column privileges are enforced independently of
-- RLS, so admins reading credentials must go through supabaseAdmin server
-- functions (already the case for iptv-admin, health-check, playlist).
-- The existing "Owner TVs viewable" and "Admins manage TVs" policies remain.

-- Drop the broad public policy that leaked every row of every public lounge.
DROP POLICY IF EXISTS "Public TVs viewable by anyone" ON public.tvs;

-- Replace it with a public-safe policy scoped to the same rows but only
-- effective for the columns anon/authenticated retain SELECT on above.
CREATE POLICY "Public TVs viewable (safe columns)"
ON public.tvs
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.lounges l
    WHERE l.id = tvs.lounge_id
      AND l.is_active = true
      AND l.is_private = false
  )
);

-- ============================================================
-- 6. SECURITY DEFINER function EXECUTE hardening
-- ============================================================
-- Revoke default PUBLIC/anon/authenticated EXECUTE on every SECURITY DEFINER
-- function in the public schema, then re-grant only where required.
DO $$
DECLARE fsig text;
BEGIN
  FOR fsig IN
    SELECT p.oid::regprocedure::text
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef = true
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fsig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fsig);
  END LOOP;
END $$;

-- Re-grant intentional client callers.
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_lounge_tvs(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_iptv_provider() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_balance_cents(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_topup_request(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_topup_request(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.swap_tv_slots(uuid, smallint, smallint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.swap_match_slots(uuid, smallint, smallint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_admin_if_allowed() TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_tip(uuid, integer, text, uuid, uuid, uuid, uuid) TO authenticated;
