-- ============================================================
-- QUICK FIX — Trigger robuste pour NestureAI
-- À coller dans Supabase SQL Editor et exécuter EN PREMIER
-- ============================================================

-- Étape 1 : S'assurer que les colonnes existent
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_demo         BOOLEAN DEFAULT FALSE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS beta_participant BOOLEAN DEFAULT FALSE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS converted_at    TIMESTAMPTZ DEFAULT NULL;

-- Étape 2 : Recréer le trigger avec gestion d'erreur
-- (EXCEPTION WHEN OTHERS empêche le trigger de bloquer la création du compte Auth)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.users (id, role, first_name, last_name, is_demo, beta_participant)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'role', 'parent')::user_role,
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    FALSE,
    TRUE
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Ne jamais bloquer la création du compte Supabase Auth
  RAISE WARNING 'handle_new_user error: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Vérification
SELECT 'Trigger OK' AS status, proname FROM pg_proc WHERE proname = 'handle_new_user';
