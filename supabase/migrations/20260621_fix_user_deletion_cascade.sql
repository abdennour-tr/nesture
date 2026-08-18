-- ============================================================
-- Migration: Fix user deletion and release email lock
-- Defines a security definer function to allow auth deletion
-- ============================================================

CREATE OR REPLACE FUNCTION public.delete_auth_user(target_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER -- executes with owner/postgres privileges
AS $$
BEGIN
  -- 1. Dissocier le praticien (ot_id) des enfants pour ne pas bloquer par foreign key
  UPDATE public.children SET ot_id = NULL WHERE ot_id = target_user_id;

  -- 2. Supprimer les sessions pour éviter tout blocage lié à learner_id (qui n'a pas toujours ON DELETE CASCADE)
  -- Cas parent : supprimer les sessions de tous ses enfants
  DELETE FROM public.sessions 
  WHERE child_id IN (SELECT id FROM public.children WHERE parent_id = target_user_id)
     OR learner_id IN (SELECT id FROM public.children WHERE parent_id = target_user_id);

  -- Cas enfant/learner : supprimer ses sessions
  DELETE FROM public.sessions 
  WHERE child_id IN (SELECT id FROM public.children WHERE auth_user_id = target_user_id)
     OR learner_id IN (SELECT id FROM public.children WHERE auth_user_id = target_user_id);

  -- 3. Supprimer les feedbacks
  DELETE FROM public.feedback WHERE user_id = target_user_id;

  -- 4. Supprimer le profil dans public.users si existant
  DELETE FROM public.users WHERE id = target_user_id;

  -- 5. Supprimer de auth.users (les cascades internes de Supabase nettoient les sessions, refresh_tokens, identités, libérant l'email immédiatement)
  DELETE FROM auth.users WHERE id = target_user_id;
END;
$$;
