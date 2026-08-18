-- ============================================================
-- Script pour enrichir le profil d'Emily Carter
-- À exécuter APRÈS avoir créé son compte via le Dashboard Supabase
-- ============================================================

UPDATE public.users 
SET 
  role = 'practitioner',
  first_name = 'Emily',
  last_name = 'Carter',
  specialty = 'Occupational Therapist', 
  location = 'London, UK',
  bio = 'Pediatric OT with 12 years of experience in sensory integration and fine motor development. Specializes in children with ASD and ADHD.',
  is_featured = TRUE,
  is_demo = TRUE,
  avatar_url = 'https://api.dicebear.com/7.x/avataaars/svg?seed=Emily&backgroundColor=b6e3f4',
  connection_code = 'OT-EMCRT'
WHERE id IN (
  SELECT id FROM auth.users WHERE email = 'emily.carter@demo.nestureai.com'
);
