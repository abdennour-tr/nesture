-- ============================================================
-- INSTALLATION OBLIGATOIRE POUR LE FONCTIONNEMENT DU PROJET
-- ============================================================
-- Ce trigger crée automatiquement une ligne dans public.users
-- à chaque fois qu'un utilisateur s'inscrit via Supabase Auth.
-- Sans cela, getUserProfile() échoue systématiquement.
-- ============================================================

-- 1. S'assurer que les colonnes existent
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_demo BOOLEAN DEFAULT FALSE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS beta_participant BOOLEAN DEFAULT FALSE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS converted_at TIMESTAMPTZ DEFAULT NULL;

-- 2. Créer la fonction du trigger
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
  RAISE WARNING 'handle_new_user error: %', SQLERRM;
  RETURN NEW;
END;
$$;

-- 3. Attacher le trigger à auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 4. Vérification
SELECT '✅ Trigger installé avec succès !' AS status;
