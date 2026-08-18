-- ==============================================================================
-- Migration: Fix handle_new_user Trigger Robustness
-- Prevents "Database error saving new user" by adding an EXCEPTION block
-- and explicitly casting to public.user_role to handle search path issues.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.users (id, role, first_name, last_name, email, is_demo, beta_participant)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'role', 'parent')::public.user_role,
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    NEW.email,
    FALSE,
    TRUE
  )
  ON CONFLICT (id) DO UPDATE SET 
    email = COALESCE(EXCLUDED.email, public.users.email),
    first_name = COALESCE(EXCLUDED.first_name, public.users.first_name),
    last_name = COALESCE(EXCLUDED.last_name, public.users.last_name);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block user signup in auth.users
  RAISE WARNING 'handle_new_user error: %', SQLERRM;
  RETURN NEW;
END;
$$;

-- Drop and recreate the trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
