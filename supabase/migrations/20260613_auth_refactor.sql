-- Migration: Refonte de la création des profils utilisateur post-vérification d'email
-- Cette migration modifie le trigger pour s'assurer que le profil public.users n'est créé 
-- qu'après la validation obligatoire de l'adresse e-mail.

-- Étape 1 : Recréer la fonction du trigger
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Vérifier si l'adresse e-mail a été confirmée
  IF NEW.email_confirmed_at IS NOT NULL THEN
    INSERT INTO public.users (id, role, first_name, last_name, is_demo, beta_participant)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'role', 'parent')::public.user_role,
      COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
      COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
      FALSE,
      TRUE
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Ne jamais bloquer la création du compte Supabase Auth
  RAISE WARNING 'handle_new_user error: %', SQLERRM;
  RETURN NEW;
END;
$$;

-- Étape 2 : Mettre à jour le trigger pour s'exécuter sur INSERT et UPDATE de email_confirmed_at
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT OR UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
