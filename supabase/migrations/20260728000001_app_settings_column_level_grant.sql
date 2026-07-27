-- Phase-1 security fix: restrict app_settings to a safe column projection for
-- the authenticated role. The base migration granted table-wide SELECT to
-- authenticated with a USING(true) policy; columns added later
-- (admin_bootstrap_emails, iptv_m3u_url, iptv_xtream_username,
-- iptv_xtream_password_encrypted, iptv_xtream_server_url, iptv_epg_url,
-- iptv_provider_type, pgx_wallet_api_base_url) were therefore readable by every
-- signed-in user — leaking the admin allowlist and upstream IPTV credentials.
--
-- After this migration, authenticated can SELECT only the non-secret columns.
-- Secret columns are readable only via the service_role (server functions) and
-- the SECURITY DEFINER get_public_iptv_provider() helper (which runs as the
-- table owner and intentionally returns a public subset).

BEGIN;

REVOKE SELECT ON public.app_settings FROM authenticated;

GRANT SELECT (
  id,
  default_entry_fee_cents,
  default_free_preview_seconds,
  allowed_iframe_parent_origins,
  updated_at
) ON public.app_settings TO authenticated;

-- The row policy stays permissive (there is a single row, id = true); the
-- column-level grant above is what now enforces the secret/non-secret split.
DROP POLICY IF EXISTS "Signed-in reads app_settings" ON public.app_settings;
CREATE POLICY "Signed-in reads app_settings (safe columns)"
  ON public.app_settings FOR SELECT TO authenticated
  USING (true);

-- The "Admins update app_settings" (FOR ALL) policy is retained; admin writes
-- continue to go through the service_role client in server functions.

COMMIT;
