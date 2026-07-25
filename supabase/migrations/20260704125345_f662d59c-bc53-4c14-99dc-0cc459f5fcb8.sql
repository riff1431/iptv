-- Attach the existing handle_new_user() function as a trigger on auth.users
-- so first sign-up becomes admin and allowlisted emails auto-get admin.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Also handle the case where a user was created before the trigger existed
-- and later verifies / signs in: allowlisted emails should still be able to
-- claim admin. Trigger claim on email verification too.
CREATE OR REPLACE FUNCTION public.grant_admin_from_allowlist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  allowlist text[];
  normalized_email text := lower(coalesce(NEW.email, ''));
BEGIN
  IF NEW.email_confirmed_at IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT admin_bootstrap_emails INTO allowlist FROM public.app_settings WHERE id = true;
  IF allowlist IS NOT NULL
     AND normalized_email = ANY (SELECT lower(unnest(allowlist))) THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_confirmed_grant_admin ON auth.users;
CREATE TRIGGER on_auth_user_confirmed_grant_admin
AFTER UPDATE OF email_confirmed_at ON auth.users
FOR EACH ROW
WHEN (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL)
EXECUTE FUNCTION public.grant_admin_from_allowlist();