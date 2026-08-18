-- ============================================================
-- NestureAI — Création de 3 comptes de test (OT, Parent, Enfant)
-- À exécuter dans le SQL Editor de Supabase
-- ============================================================

-- Activer l'extension pgcrypto si nécessaire (requis pour crypt/gen_salt)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── DÉFINITION DES CONSTANTES & SÉCURITÉ DE RÉ-EXÉCUTION ──────
-- Supprime les anciennes données de test si elles existent pour éviter les conflits de clés
DO $$
DECLARE
  v_ot_email TEXT := 'ot.test@nestureai.com';
  v_parent_email TEXT := 'parent.test@nestureai.com';
  v_enfant_email TEXT := 'enfant_test@learner.nestureai.com';
  
  v_ot_id UUID := 'b0000000-0000-0000-0000-000000000001';
  v_parent_id UUID := 'c0000000-0000-0000-0000-000000000001';
  v_enfant_auth_id UUID := 'd0000000-0000-0000-0000-000000000001';
  v_enfant_profile_id UUID := 'e0000000-0000-0000-0000-000000000001';
BEGIN
  -- 1. Nettoyage des sessions et prescriptions liées
  DELETE FROM public.prescriptions WHERE learner_id = v_enfant_profile_id;
  DELETE FROM public.reflex_scores WHERE learner_id = v_enfant_profile_id;
  DELETE FROM public.sessions WHERE learner_id = v_enfant_profile_id OR child_id = v_enfant_profile_id;

  -- 2. Nettoyage des tables de relations et profils liés
  DELETE FROM public.practitioner_children WHERE practitioner_id = v_ot_id OR child_id = v_enfant_profile_id;
  DELETE FROM public.atlas_profiles WHERE child_id = v_enfant_profile_id;
  DELETE FROM public.consent WHERE parent_id = v_parent_id;
  DELETE FROM public.feedback WHERE user_id IN (v_ot_id, v_parent_id, v_enfant_auth_id);
  DELETE FROM public.children WHERE id = v_enfant_profile_id OR parent_id = v_parent_id;

  -- 3. Nettoyage dans public.users (profils publics)
  DELETE FROM public.users WHERE id IN (v_ot_id, v_parent_id, v_enfant_auth_id) OR email IN (v_ot_email, v_parent_email, v_enfant_email);
  
  -- 4. Nettoyage dans auth.identities (les identités de connexion de Supabase Auth)
  DELETE FROM auth.identities WHERE user_id IN (v_ot_id, v_parent_id, v_enfant_auth_id);

  -- 5. Nettoyage dans auth.users (comptes d'authentification)
  DELETE FROM auth.users WHERE id IN (v_ot_id, v_parent_id, v_enfant_auth_id) OR email IN (v_ot_email, v_parent_email, v_enfant_email);
END $$;


-- ── 1. CRÉATION DU COMPTE PRATICIEN (OT) ─────────────────────
INSERT INTO auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change
)
VALUES (
  'b0000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000', -- Instance ID par défaut pour GoTrue
  'authenticated',
  'authenticated',
  'ot.test@nestureai.com',
  '$2a$10$ArYjGwuaLGlqxIq2IkqBweiWhuoQJ4VLIqqQXzxloXfAO4SEkDM.e', -- Hash bcrypt pour 'password123'
  now(),
  now(),
  now(),
  '{"provider": "email", "providers": ["email"]}',
  '{"first_name": "Jean", "last_name": "Dupont", "role": "practitioner"}',
  false,
  '',
  '',
  '',
  ''
)
ON CONFLICT (id) DO NOTHING;

-- Insérer l'identité de connexion pour l'OT dans auth.identities (Requis par Supabase Auth)
INSERT INTO auth.identities (
  id,
  user_id,
  identity_data,
  provider,
  provider_id,
  last_sign_in_at,
  created_at,
  updated_at
)
VALUES (
  'b0000000-0000-0000-0000-000000000001',
  'b0000000-0000-0000-0000-000000000001',
  '{"sub": "b0000000-0000-0000-0000-000000000001", "email": "ot.test@nestureai.com", "email_verified": true}'::jsonb,
  'email',
  'b0000000-0000-0000-0000-000000000001', -- Pour email, provider_id est l'ID de l'utilisateur
  now(),
  now(),
  now()
)
ON CONFLICT DO NOTHING;

-- Compléter / Enrichir le profil public du Praticien (OT)
INSERT INTO public.users (
  id,
  role,
  first_name,
  last_name,
  email,
  specialty,
  location,
  bio,
  is_featured,
  is_demo,
  beta_participant,
  is_active,
  avatar_url,
  connection_code
)
VALUES (
  'b0000000-0000-0000-0000-000000000001',
  'practitioner',
  'Jean',
  'Dupont',
  'ot.test@nestureai.com',
  'Occupational Therapist',
  'Paris, France',
  'Ergothérapeute spécialisé dans l''intégration des réflexes primitifs et le développement de la motricité fine chez l''enfant.',
  TRUE,
  TRUE,
  TRUE,
  TRUE,
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Jean&backgroundColor=b6e3f4',
  'OT-TEST01' -- Code de connexion que le parent utilisera pour lier son enfant
)
ON CONFLICT (id) DO UPDATE SET
  specialty = EXCLUDED.specialty,
  location = EXCLUDED.location,
  bio = EXCLUDED.bio,
  connection_code = EXCLUDED.connection_code;


-- ── 2. CRÉATION DU COMPTE PARENT ─────────────────────────────
-- Insertion dans auth.users
INSERT INTO auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change
)
VALUES (
  'c0000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000', -- Instance ID par défaut pour GoTrue
  'authenticated',
  'authenticated',
  'parent.test@nestureai.com',
  '$2a$10$ArYjGwuaLGlqxIq2IkqBweiWhuoQJ4VLIqqQXzxloXfAO4SEkDM.e', -- Hash bcrypt pour 'password123'
  now(),
  now(),
  now(),
  '{"provider": "email", "providers": ["email"]}',
  '{"first_name": "Marie", "last_name": "Dupont", "role": "parent"}',
  false,
  '',
  '',
  '',
  ''
)
ON CONFLICT (id) DO NOTHING;

-- Insérer l'identité de connexion pour le Parent dans auth.identities (Requis par Supabase Auth)
INSERT INTO auth.identities (
  id,
  user_id,
  identity_data,
  provider,
  provider_id,
  last_sign_in_at,
  created_at,
  updated_at
)
VALUES (
  'c0000000-0000-0000-0000-000000000001',
  'c0000000-0000-0000-0000-000000000001',
  '{"sub": "c0000000-0000-0000-0000-000000000001", "email": "parent.test@nestureai.com", "email_verified": true}'::jsonb,
  'email',
  'c0000000-0000-0000-0000-000000000001', -- Pour email, provider_id est l'ID de l'utilisateur
  now(),
  now(),
  now()
)
ON CONFLICT DO NOTHING;

-- Compléter le profil public du Parent
INSERT INTO public.users (
  id,
  role,
  first_name,
  last_name,
  email,
  is_demo,
  beta_participant,
  is_active
)
VALUES (
  'c0000000-0000-0000-0000-000000000001',
  'parent',
  'Marie',
  'Dupont',
  'parent.test@nestureai.com',
  TRUE,
  TRUE,
  TRUE
)
ON CONFLICT (id) DO NOTHING;


-- ── 3. CRÉATION DU COMPTE ENFANT / APPRENANT (LEARNER) ────────
-- Insertion dans auth.users (pour que l'enfant ait aussi son propre compte de connexion si besoin)
INSERT INTO auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change
)
VALUES (
  'd0000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000', -- Instance ID par défaut pour GoTrue
  'authenticated',
  'authenticated',
  'enfant_test@learner.nestureai.com',
  '$2a$10$/bWz4ylo2xSq9ge7lwmgCOuS84ta6SBuRvIV5Nt9A1s4BKaYHkTAe', -- Hash bcrypt pour 'password123_learner_suffix'
  now(),
  now(),
  now(),
  '{"provider": "email", "providers": ["email"]}',
  '{"first_name": "Lucas", "last_name": "Dupont", "role": "learner"}',
  false,
  '',
  '',
  '',
  ''
)
ON CONFLICT (id) DO NOTHING;

-- Insérer l'identité de connexion pour l'Enfant dans auth.identities (Requis par Supabase Auth)
INSERT INTO auth.identities (
  id,
  user_id,
  identity_data,
  provider,
  provider_id,
  last_sign_in_at,
  created_at,
  updated_at
)
VALUES (
  'd0000000-0000-0000-0000-000000000001',
  'd0000000-0000-0000-0000-000000000001',
  '{"sub": "d0000000-0000-0000-0000-000000000001", "email": "enfant_test@learner.nestureai.com", "email_verified": true}'::jsonb,
  'email',
  'd0000000-0000-0000-0000-000000000001', -- Pour email, provider_id est l'ID de l'utilisateur
  now(),
  now(),
  now()
)
ON CONFLICT DO NOTHING;

-- Compléter le profil public de l'Enfant (en tant qu'utilisateur de la plateforme)
INSERT INTO public.users (
  id,
  role,
  first_name,
  last_name,
  email,
  is_demo,
  beta_participant,
  is_active
)
VALUES (
  'd0000000-0000-0000-0000-000000000001',
  'learner',
  'Lucas',
  'Dupont',
  'enfant_test@learner.nestureai.com',
  TRUE,
  TRUE,
  TRUE
)
ON CONFLICT (id) DO NOTHING;

-- ── 4. CRÉATION DU PROFIL DE L'ENFANT & ASSOCIATION ───────────
-- Insérer dans public.children pour enregistrer l'enfant sous la garde du parent et lié à l'OT
INSERT INTO public.children (
  id,
  parent_id,
  auth_user_id,
  ot_id,
  first_name,
  last_name,
  age,
  diagnosis,
  letterquest_level,
  completeness_percentage,
  avatar_color
)
VALUES (
  'e0000000-0000-0000-0000-000000000001',
  'c0000000-0000-0000-0000-000000000001', -- ID de Marie Dupont (Parent)
  'd0000000-0000-0000-0000-000000000001', -- ID d'authentification de Lucas (Enfant/Learner)
  'b0000000-0000-0000-0000-000000000001', -- ID de Jean Dupont (Praticien/OT)
  'Lucas',
  'Dupont',
  10,
  'Troubles de l''intégration sensorielle & Dyspraxie légère',
  'medium',
  80,
  '#3b82f6' -- Couleur d'avatar personnalisée
)
ON CONFLICT (id) DO UPDATE SET
  parent_id = EXCLUDED.parent_id,
  auth_user_id = EXCLUDED.auth_user_id,
  ot_id = EXCLUDED.ot_id,
  age = EXCLUDED.age,
  diagnosis = EXCLUDED.diagnosis;

-- Lier l'OT et l'enfant dans la table de relation practitioner_children
INSERT INTO public.practitioner_children (practitioner_id, child_id)
VALUES (
  'b0000000-0000-0000-0000-000000000001', -- Jean Dupont (OT)
  'e0000000-0000-0000-0000-000000000001'  -- Lucas Dupont (Enfant)
)
ON CONFLICT DO NOTHING;

-- ── 5. DEVISE & PARAMÈTRES POUR LE PROFIL ATLAS DE L'ENFANT ───
-- Créer la base du profil Atlas pour le nouveau compte de test
INSERT INTO public.atlas_profiles (
  child_id,
  completeness_percentage,
  strengths,
  challenges,
  communication_profile,
  sensory_profile,
  calibration_parameters
)
VALUES (
  'e0000000-0000-0000-0000-000000000001',
  80,
  '[
    {"label": "Grande curiosité intellectuelle", "source": "Rapport Initial"},
    {"label": "Bonnes capacités de communication verbale", "source": "Rapport Initial"}
  ]'::jsonb,
  '[
    {"label": "Planification motrice et coordination des mouvements", "source": "Rapport Initial"},
    {"label": "Sensibilité aux stimuli sonores intenses", "source": "Rapport Initial"}
  ]'::jsonb,
  '{"method": "Communication verbale directe", "notes": "Lucas s''exprime bien mais a besoin de temps pour exécuter des consignes motrices."}'::jsonb,
  '{"processing": "Hypersensibilité auditive", "environments": "Préfère travailler dans un environnement calme et structuré"}'::jsonb,
  '{"keyboard_size": "Medium keys", "difficulty_mode": "Medium"}'::jsonb
)
ON CONFLICT (child_id) DO NOTHING;


-- ── 6. DONNÉES SIMULÉES / HISTORIQUE DE TEST POUR LUCAS ───────
-- Ces données permettent de tester les graphiques, l'historique et les fonctionnalités de suivi OT

-- a. Insertion d'un document d'évaluation (PDF) pour Lucas
INSERT INTO public.documents (id, child_id, file_name, file_path, file_type, status, uploaded_at)
VALUES (
  'f0000000-0000-0000-0000-000000000001',
  'e0000000-0000-0000-0000-000000000001', -- Lucas
  'OT_Report_Lucas_2026.pdf',
  'demo/OT_Report_Lucas_2026.pdf',
  'OT_Evaluation',
  'definitive',
  now() - INTERVAL '15 days'
)
ON CONFLICT (id) DO NOTHING;

-- b. Insertion de 4 sessions de jeu (LetterQuest) simulées avec progression
INSERT INTO public.sessions (
  id,
  child_id,
  learner_id,
  session_date,
  start_time,
  end_time,
  duration_seconds,
  difficulty_mode,
  keyboard_size,
  accuracy,
  accuracy_score,
  words_completed,
  sentences_completed,
  average_response_time_ms,
  avg_response_time_ms,
  difficulty,
  scenario,
  total_attempts,
  perfect_grabs,
  failed_grabs,
  skipped,
  trajectory_smoothness,
  fatigue_index,
  midline_crossings,
  lpi_score
)
VALUES
  -- Session 1 (Il y a 10 jours) - Prise en main difficile
  ('e0000000-0000-0000-0000-000000000101',
   'e0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001',
   now() - INTERVAL '10 days', now() - INTERVAL '10 days', now() - INTERVAL '10 days' + INTERVAL '15 min',
   900, 'Easy', 'Medium keys', 60, 0.600, 4, 0, 4800, 4800, 'easy', 'happy_path', 30, 15, 12, 3, 0.450, 0.450, 4, 42),
   
  -- Session 2 (Il y a 7 jours) - Amélioration du temps de réponse
  ('e0000000-0000-0000-0000-000000000102',
   'e0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001',
   now() - INTERVAL '7 days', now() - INTERVAL '7 days', now() - INTERVAL '7 days' + INTERVAL '18 min',
   1080, 'Easy', 'Medium keys', 65, 0.650, 5, 0, 4200, 4200, 'easy', 'happy_path', 32, 18, 10, 4, 0.480, 0.400, 5, 48),

  -- Session 3 (Il y a 4 jours) - Passage au niveau Medium
  ('e0000000-0000-0000-0000-000000000103',
   'e0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001',
   now() - INTERVAL '4 days', now() - INTERVAL '4 days', now() - INTERVAL '4 days' + INTERVAL '20 min',
   1200, 'Medium', 'Medium keys', 70, 0.700, 6, 0, 3900, 3900, 'medium', 'happy_path', 35, 22, 9, 4, 0.520, 0.350, 6, 55),

  -- Session 4 (Il y a 1 jour) - Excellente progression
  ('e0000000-0000-0000-0000-000000000104',
   'e0000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001',
   now() - INTERVAL '1 day', now() - INTERVAL '1 day', now() - INTERVAL '1 day' + INTERVAL '22 min',
   1320, 'Medium', 'Medium keys', 78, 0.780, 8, 0, 3400, 3400, 'medium', 'happy_path', 38, 28, 7, 3, 0.600, 0.280, 8, 68)
ON CONFLICT (id) DO NOTHING;

-- c. Scores de réflexes pour Lucas (calculés à partir des sessions 1 et 4)
INSERT INTO public.reflex_scores (id, session_id, learner_id, reflex_name, confidence_level, score, indicators_found, created_at)
VALUES
  (gen_random_uuid(), 'e0000000-0000-0000-0000-000000000101', 'e0000000-0000-0000-0000-000000000001', 'Moro', 'High', 4, 3, now() - INTERVAL '10 days'),
  (gen_random_uuid(), 'e0000000-0000-0000-0000-000000000101', 'e0000000-0000-0000-0000-000000000001', 'ATNR', 'Medium', 3, 2, now() - INTERVAL '10 days'),
  (gen_random_uuid(), 'e0000000-0000-0000-0000-000000000104', 'e0000000-0000-0000-0000-000000000001', 'Moro', 'High', 2, 1, now() - INTERVAL '1 day'),
  (gen_random_uuid(), 'e0000000-0000-0000-0000-000000000104', 'e0000000-0000-0000-0000-000000000001', 'ATNR', 'Low', 1, 0, now() - INTERVAL '1 day')
ON CONFLICT (id) DO NOTHING;

-- d. Prescriptions d'exercices recommandées par l'OT (Jean Dupont) pour Lucas
INSERT INTO public.prescriptions (id, learner_id, exercise_id, session_id, notes, prescribed_at)
VALUES
  (gen_random_uuid(), 'e0000000-0000-0000-0000-000000000001', 'ex-001', 'e0000000-0000-0000-0000-000000000101', 'Faire l''étirement Starfish 3 fois par jour, particulièrement le matin.', now() - INTERVAL '10 days'),
  (gen_random_uuid(), 'e0000000-0000-0000-0000-000000000001', 'ex-004', 'e0000000-0000-0000-0000-000000000104', 'Exercice de Cross-Crawl pour améliorer la coordination bilatérale.', now() - INTERVAL '1 day')
ON CONFLICT (id) DO NOTHING;
