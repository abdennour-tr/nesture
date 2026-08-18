-- ============================================================
-- NestureAI — Fix complet pour le Sign-Up
-- À coller dans Supabase SQL Editor et exécuter UNE SEULE FOIS
-- ============================================================
-- Ce script corrige le problème :
--   "No profile found in public.users for auth ID: ..."
-- qui apparaît après avoir cliqué sur "Create Account".
--
-- Il fait 3 choses :
--   1. Ajoute les colonnes manquantes à public.users
--   2. Crée/remplace le trigger qui peuple public.users après signup
--   3. Ajoute les policies RLS pour que chaque user puisse lire/créer
--      sa propre ligne dans public.users (fallback côté client)
-- ============================================================

-- ── 1. Colonnes manquantes ────────────────────────────────────
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_demo          BOOLEAN     DEFAULT FALSE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS beta_participant BOOLEAN     DEFAULT FALSE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS converted_at     TIMESTAMPTZ DEFAULT NULL;

-- ── 2. Trigger robuste (ne bloque jamais la création du compte) ─
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

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── 3. RLS policies sur public.users (fallback côté client) ────
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_read_own"   ON public.users;
DROP POLICY IF EXISTS "users_insert_own" ON public.users;
DROP POLICY IF EXISTS "users_update_own" ON public.users;

-- Chaque user peut lire sa propre ligne
CREATE POLICY "users_read_own"
  ON public.users FOR SELECT
  USING (auth.uid() = id);

-- Chaque user peut insérer sa propre ligne (fallback si trigger échoue)
CREATE POLICY "users_insert_own"
  ON public.users FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Chaque user peut mettre à jour sa propre ligne
CREATE POLICY "users_update_own"
  ON public.users FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- ── Vérification ──────────────────────────────────────────────
SELECT 'Trigger installé' AS check_name,
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created'
       ) THEN 'OK ✓' ELSE 'MISSING ✗' END AS result
UNION ALL
SELECT 'Policies sur public.users',
       count(*)::text || ' policies'
FROM pg_policies WHERE schemaname = 'public' AND tablename = 'users';
