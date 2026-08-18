-- ============================================================
-- Script pour supprimer un utilisateur en cascade proprement
-- Remplacez l'email ci-dessous par l'email que vous voulez supprimer
-- ============================================================

DO $$
DECLARE
  target_email TEXT := 'emily.carter@demo.nestureai.com';
  target_id UUID;
BEGIN
  -- 1. Trouver l'ID de l'utilisateur à partir de son email
  SELECT id INTO target_id FROM auth.users WHERE email = target_email;
  
  IF target_id IS NOT NULL THEN
    -- 2. Supprimer d'abord son profil public.
    -- (Grâce au "ON DELETE CASCADE" sur les autres tables comme practitioner_children 
    -- ou connection_requests, tout le reste sera supprimé automatiquement !)
    DELETE FROM public.users WHERE id = target_id;
    
    -- 3. Supprimer finalement le compte d'authentification principal
    DELETE FROM auth.users WHERE id = target_id;
    
    RAISE NOTICE 'Utilisateur % supprimé avec succès en cascade.', target_email;
  ELSE
    RAISE NOTICE 'Utilisateur % introuvable.', target_email;
  END IF;
END $$;
