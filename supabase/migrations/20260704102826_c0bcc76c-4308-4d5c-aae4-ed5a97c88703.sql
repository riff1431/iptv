
-- 1. Admin allowlist column on app_settings
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS admin_bootstrap_emails text[] NOT NULL DEFAULT '{}'::text[];

-- 2. Replace handle_new_user to auto-grant roles
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  allowlist text[];
  is_first_user boolean;
  normalized_email text := lower(coalesce(NEW.email, ''));
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;

  -- Everyone gets the base 'user' role
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user')
  ON CONFLICT (user_id, role) DO NOTHING;

  SELECT admin_bootstrap_emails INTO allowlist FROM public.app_settings WHERE id = true;
  SELECT NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') INTO is_first_user;

  IF is_first_user
     OR (allowlist IS NOT NULL AND normalized_email = ANY (SELECT lower(unnest(allowlist)))) THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- Ensure trigger exists on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3. Self-service "claim admin" for already-signed-up users on the allowlist
CREATE OR REPLACE FUNCTION public.claim_admin_if_allowed()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  email text;
  allowlist text[];
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT lower(u.email) INTO email FROM auth.users u WHERE u.id = uid;
  SELECT admin_bootstrap_emails INTO allowlist FROM public.app_settings WHERE id = true;

  IF allowlist IS NULL OR NOT (email = ANY (SELECT lower(unnest(allowlist)))) THEN
    RETURN false;
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (uid, 'admin')
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_admin_if_allowed() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_admin_if_allowed() TO authenticated;

-- 4. Guard: prevent deleting the last remaining admin
CREATE OR REPLACE FUNCTION public.prevent_last_admin_removal()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.role = 'admin' THEN
    IF (SELECT count(*) FROM public.user_roles WHERE role = 'admin') <= 1 THEN
      RAISE EXCEPTION 'Cannot remove the last admin';
    END IF;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_last_admin_removal ON public.user_roles;
CREATE TRIGGER trg_prevent_last_admin_removal
  BEFORE DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_last_admin_removal();
