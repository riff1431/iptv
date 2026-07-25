-- Trigger to auto-confirm new users at the database level to bypass remote GoTrue verification requirements.
CREATE OR REPLACE FUNCTION public.auto_confirm_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  NEW.email_confirmed_at = coalesce(NEW.email_confirmed_at, now());
  NEW.confirmed_at = coalesce(NEW.confirmed_at, now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_auto_confirm_new_user ON auth.users;
CREATE TRIGGER tr_auto_confirm_new_user
  BEFORE INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_confirm_new_user();
