-- ============================================================
-- NestureConnect — Migration: Specialist Directory
-- Run in Supabase SQL Editor
-- ============================================================

-- ── 1. Add specialist profile columns to public.users ────────
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS specialty    TEXT DEFAULT NULL;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS location     TEXT DEFAULT NULL;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS avatar_url   TEXT DEFAULT NULL;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS bio          TEXT DEFAULT NULL;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_featured  BOOLEAN DEFAULT FALSE;

-- ── 2. Seed 6 demo practitioners ─────────────────────────────
-- We must first insert into auth.users to satisfy the foreign key constraint.

-- ▸ FEATURED #1 — Dr. Emily Carter (Occupational Therapist)
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'emily.carter@demo.nestureai.com', '$2a$10$PznXR5VSgzjnAp7T2MoMse5moTf0WsEe5JbPDQh1KIbPXLfGR7GEm', now(), now(), now(), '{"provider": "email", "providers": ["email"]}', '{"first_name": "Emily", "last_name": "Carter", "role": "practitioner"}', false, '', '', '', '') ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, role, first_name, last_name, specialty, location, bio, is_featured, is_demo, beta_participant, avatar_url)
VALUES (
  'a0000000-0000-0000-0000-000000000001', 'practitioner', 'Emily', 'Carter', 'Occupational Therapist', 'London, UK',
  'Pediatric OT with 12 years of experience in sensory integration and fine motor development. Specializes in children with ASD and ADHD.',
  TRUE, TRUE, FALSE, 'https://api.dicebear.com/7.x/avataaars/svg?seed=Emily&backgroundColor=b6e3f4'
) ON CONFLICT (id) DO UPDATE SET specialty = EXCLUDED.specialty, location = EXCLUDED.location, bio = EXCLUDED.bio, is_featured = EXCLUDED.is_featured, avatar_url = EXCLUDED.avatar_url;

-- ▸ FEATURED #2 — Dr. James Okonkwo (Speech-Language Pathologist)
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'james.okonkwo@demo.nestureai.com', '$2a$10$PznXR5VSgzjnAp7T2MoMse5moTf0WsEe5JbPDQh1KIbPXLfGR7GEm', now(), now(), now(), '{"provider": "email", "providers": ["email"]}', '{"first_name": "James", "last_name": "Okonkwo", "role": "practitioner"}', false, '', '', '', '') ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, role, first_name, last_name, specialty, location, bio, is_featured, is_demo, beta_participant, avatar_url)
VALUES (
  'a0000000-0000-0000-0000-000000000002', 'practitioner', 'James', 'Okonkwo', 'Speech-Language Pathologist', 'Dublin, Ireland',
  'SLP focused on augmentative communication and language delays in neurodivergent children. ASHA certified with bilingual expertise.',
  TRUE, TRUE, FALSE, 'https://api.dicebear.com/7.x/avataaars/svg?seed=James&backgroundColor=c0aede'
) ON CONFLICT (id) DO UPDATE SET specialty = EXCLUDED.specialty, location = EXCLUDED.location, bio = EXCLUDED.bio, is_featured = EXCLUDED.is_featured, avatar_url = EXCLUDED.avatar_url;

-- ▸ STANDARD #3 — Sofia Martinez (Reflex Integration Specialist)
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sofia.martinez@demo.nestureai.com', '$2a$10$PznXR5VSgzjnAp7T2MoMse5moTf0WsEe5JbPDQh1KIbPXLfGR7GEm', now(), now(), now(), '{"provider": "email", "providers": ["email"]}', '{"first_name": "Sofia", "last_name": "Martinez", "role": "practitioner"}', false, '', '', '', '') ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, role, first_name, last_name, specialty, location, bio, is_featured, is_demo, beta_participant, avatar_url)
VALUES (
  'a0000000-0000-0000-0000-000000000003', 'practitioner', 'Sofia', 'Martinez', 'Reflex Integration Specialist', 'Barcelona, Spain',
  'Trained in Masgutova MNRI and rhythmic movement therapy. Helps children overcome retained primitive reflexes affecting learning and coordination.',
  FALSE, TRUE, FALSE, 'https://api.dicebear.com/7.x/avataaars/svg?seed=Sofia&backgroundColor=ffd5dc'
) ON CONFLICT (id) DO UPDATE SET specialty = EXCLUDED.specialty, location = EXCLUDED.location, bio = EXCLUDED.bio, is_featured = EXCLUDED.is_featured, avatar_url = EXCLUDED.avatar_url;

-- ▸ STANDARD #4 — Liam Chen (ABA Therapist)
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'liam.chen@demo.nestureai.com', '$2a$10$PznXR5VSgzjnAp7T2MoMse5moTf0WsEe5JbPDQh1KIbPXLfGR7GEm', now(), now(), now(), '{"provider": "email", "providers": ["email"]}', '{"first_name": "Liam", "last_name": "Chen", "role": "practitioner"}', false, '', '', '', '') ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, role, first_name, last_name, specialty, location, bio, is_featured, is_demo, beta_participant, avatar_url)
VALUES (
  'a0000000-0000-0000-0000-000000000004', 'practitioner', 'Liam', 'Chen', 'ABA Therapist', 'Toronto, Canada',
  'Board Certified Behavior Analyst (BCBA) specializing in early intervention and naturalistic teaching strategies for children on the autism spectrum.',
  FALSE, TRUE, FALSE, 'https://api.dicebear.com/7.x/avataaars/svg?seed=Liam&backgroundColor=d1d4f9'
) ON CONFLICT (id) DO UPDATE SET specialty = EXCLUDED.specialty, location = EXCLUDED.location, bio = EXCLUDED.bio, is_featured = EXCLUDED.is_featured, avatar_url = EXCLUDED.avatar_url;

-- ▸ STANDARD #5 — Amira Nasser (Occupational Therapist)
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'amira.nasser@demo.nestureai.com', '$2a$10$PznXR5VSgzjnAp7T2MoMse5moTf0WsEe5JbPDQh1KIbPXLfGR7GEm', now(), now(), now(), '{"provider": "email", "providers": ["email"]}', '{"first_name": "Amira", "last_name": "Nasser", "role": "practitioner"}', false, '', '', '', '') ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, role, first_name, last_name, specialty, location, bio, is_featured, is_demo, beta_participant, avatar_url)
VALUES (
  'a0000000-0000-0000-0000-000000000005', 'practitioner', 'Amira', 'Nasser', 'Occupational Therapist', 'Dubai, UAE',
  'Specialized in sensory processing disorders and handwriting development. Works with international schools to support inclusive education programmes.',
  FALSE, TRUE, FALSE, 'https://api.dicebear.com/7.x/avataaars/svg?seed=Amira&backgroundColor=ffdfbf'
) ON CONFLICT (id) DO UPDATE SET specialty = EXCLUDED.specialty, location = EXCLUDED.location, bio = EXCLUDED.bio, is_featured = EXCLUDED.is_featured, avatar_url = EXCLUDED.avatar_url;

-- ▸ STANDARD #6 — Kenji Tanaka (Speech-Language Pathologist)
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES ('a0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kenji.tanaka@demo.nestureai.com', '$2a$10$PznXR5VSgzjnAp7T2MoMse5moTf0WsEe5JbPDQh1KIbPXLfGR7GEm', now(), now(), now(), '{"provider": "email", "providers": ["email"]}', '{"first_name": "Kenji", "last_name": "Tanaka", "role": "practitioner"}', false, '', '', '', '') ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, role, first_name, last_name, specialty, location, bio, is_featured, is_demo, beta_participant, avatar_url)
VALUES (
  'a0000000-0000-0000-0000-000000000006', 'practitioner', 'Kenji', 'Tanaka', 'Speech-Language Pathologist', 'Sydney, Australia',
  'Expert in articulation therapy, social pragmatics, and feeding difficulties. Passionate about using technology to enhance therapeutic outcomes.',
  FALSE, TRUE, FALSE, 'https://api.dicebear.com/7.x/avataaars/svg?seed=Kenji&backgroundColor=c1f0c1'
) ON CONFLICT (id) DO UPDATE SET specialty = EXCLUDED.specialty, location = EXCLUDED.location, bio = EXCLUDED.bio, is_featured = EXCLUDED.is_featured, avatar_url = EXCLUDED.avatar_url;

-- ── 3. Generate connection codes for demo practitioners ───────
-- (so parents can also find them via the existing ConnectionModal)
UPDATE public.users SET connection_code = 'OT-EMCRT' WHERE id = 'a0000000-0000-0000-0000-000000000001' AND connection_code IS NULL;
UPDATE public.users SET connection_code = 'OT-JMOKW' WHERE id = 'a0000000-0000-0000-0000-000000000002' AND connection_code IS NULL;
UPDATE public.users SET connection_code = 'OT-SFMRT' WHERE id = 'a0000000-0000-0000-0000-000000000003' AND connection_code IS NULL;
UPDATE public.users SET connection_code = 'OT-LMCHN' WHERE id = 'a0000000-0000-0000-0000-000000000004' AND connection_code IS NULL;
UPDATE public.users SET connection_code = 'OT-AMNSR' WHERE id = 'a0000000-0000-0000-0000-000000000005' AND connection_code IS NULL;
UPDATE public.users SET connection_code = 'OT-KJTNK' WHERE id = 'a0000000-0000-0000-0000-000000000006' AND connection_code IS NULL;

-- ── 4. RLS policy: allow all authenticated users to read practitioner profiles ──
-- (so the NestureConnect directory is visible to parents)
DROP POLICY IF EXISTS "specialists_read" ON public.users;
CREATE POLICY "specialists_read" ON public.users
  FOR SELECT
  USING (role = 'practitioner');

-- ── Done! ────────────────────────────────────────────────────
