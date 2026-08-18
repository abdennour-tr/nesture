-- ============================================================
-- Ajout des colonnes manquantes pour le profil complet du Praticien
-- ============================================================

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS practice_name TEXT DEFAULT NULL;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS registration_number TEXT DEFAULT NULL;

-- Note : Supabase met parfois son cache à jour avec quelques minutes de délai.
-- Si vous avez toujours l'erreur "schema cache", vous pouvez aller dans 
-- Project Settings > API > et cliquer sur "Reload Schema Cache".
