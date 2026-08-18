-- ============================================================
-- Script pour supprimer et recréer Emily Carter avec un vrai mot de passe
-- Mot de passe qui sera défini : password123
-- ============================================================

-- 1. Supprimer le profil public d'Emily (ce qui lève la contrainte de clé étrangère)
DELETE FROM public.users 
WHERE id = 'a0000000-0000-0000-0000-000000000001';

-- 2. Supprimer le compte d'authentification d'Emily
DELETE FROM auth.users 
WHERE id = 'a0000000-0000-0000-0000-000000000001' OR email = 'emily.carter@demo.nestureai.com';

-- 3. Activer l'extension pgcrypto (si ce n'est pas déjà fait) pour hasher le mot de passe
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 4. Recréer le compte d'authentification avec un "vrai" hash généré par Supabase pour "password123"
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
  is_super_admin
)
VALUES (
  'a0000000-0000-0000-0000-000000000001', 
  '00000000-0000-0000-0000-000000000000', 
  'authenticated', 
  'authenticated', 
  'emily.carter@demo.nestureai.com', 
  crypt('password123', gen_salt('bf')), -- Génère un VRAI hash valide pour GoTrue
  now(), 
  now(), 
  now(), 
  '{"provider": "email", "providers": ["email"]}', 
  '{"first_name": "Emily", "last_name": "Carter", "role": "practitioner"}', 
  false
);

-- 5. Mettre à jour son profil public avec ses informations de spécialiste
-- (Le trigger a probablement déjà créé la ligne de base, on utilise donc ON CONFLICT DO UPDATE)
INSERT INTO public.users (
  id, 
  role, 
  first_name, 
  last_name, 
  specialty, 
  location, 
  bio, 
  is_featured, 
  is_demo, 
  beta_participant, 
  avatar_url,
  connection_code
)
VALUES (
  'a0000000-0000-0000-0000-000000000001', 
  'practitioner', 
  'Emily', 
  'Carter', 
  'Occupational Therapist', 
  'London, UK',
  'Pediatric OT with 12 years of experience in sensory integration and fine motor development. Specializes in children with ASD and ADHD.',
  TRUE, 
  TRUE, 
  FALSE, 
  'https://api.dicebear.com/7.x/avataaars/svg?seed=Emily&backgroundColor=b6e3f4',
  'OT-EMCRT'
)
ON CONFLICT (id) DO UPDATE SET
  specialty = EXCLUDED.specialty,
  location = EXCLUDED.location,
  bio = EXCLUDED.bio,
  is_featured = EXCLUDED.is_featured,
  avatar_url = EXCLUDED.avatar_url,
  connection_code = EXCLUDED.connection_code;

-- Note: Le mot de passe pour emily.carter@demo.nestureai.com est maintenant : password123
