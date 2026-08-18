-- ==============================================================================
-- NestureAI - Add Admin Role, User and RLS Policies
-- ==============================================================================
-- IMPORTANT POSTGRES LIMITATION:
-- You must run this script in TWO separate executions in the Supabase SQL Editor.
-- Copy and run STEP 1 first, click Run. Then copy and run STEP 2, click Run.
-- ==============================================================================

-- ──────────────────────────────────────────────────────────────────────────────
-- >>> EXECUTE THIS FIRST: STEP 1 (Add enum value)
-- ──────────────────────────────────────────────────────────────────────────────

-- Add 'admin' to user_role enum if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t 
    JOIN pg_enum e ON t.oid = e.enumtypid 
    WHERE t.typname = 'user_role' AND e.enumlabel = 'admin'
  ) THEN
    ALTER TYPE user_role ADD VALUE 'admin';
  END IF;
END $$;


-- ──────────────────────────────────────────────────────────────────────────────
-- >>> EXECUTE THIS SECOND: STEP 2 (Seed admin user and set up RLS policies)
-- ──────────────────────────────────────────────────────────────────────────────

-- 1. Seed default admin user into auth.users (if not already existing)
-- Use the bcrypt hash of 'admin123': $2a$10$SyZUJ/wk0BgPH1e.xNyPUeBVhaWxzfLOxwdISDj0JwDD6SgFNSNvC
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
  '00000000-0000-0000-0000-0000000000a0', 
  '00000000-0000-0000-0000-000000000000', 
  'authenticated', 
  'authenticated', 
  'admin@gmail.com', 
  '$2a$10$SyZUJ/wk0BgPH1e.xNyPUeBVhaWxzfLOxwdISDj0JwDD6SgFNSNvC', 
  now(), 
  now(), 
  now(), 
  '{"provider": "email", "providers": ["email"]}', 
  '{"first_name": "System", "last_name": "Admin", "role": "admin"}', 
  true, 
  '', 
  '', 
  '', 
  ''
) ON CONFLICT (id) DO NOTHING;

-- 2. Seed default admin user into public.users (if not already existing)
INSERT INTO public.users (
  id, 
  role, 
  first_name, 
  last_name, 
  is_demo, 
  beta_participant
)
VALUES (
  '00000000-0000-0000-0000-0000000000a0', 
  'admin', 
  'System', 
  'Admin', 
  false, 
  true
) ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

-- 3. Enable Row Level Security on all required tables (just to be sure)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.children ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learn_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.practitioner_children ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connection_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.atlas_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prescriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consent ENABLE ROW LEVEL SECURITY;

-- 4. Add RLS Policies for Admin (auth.jwt() ->> 'email' = 'admin@gmail.com')

-- public.users
DROP POLICY IF EXISTS "admin_all_users" ON public.users;
CREATE POLICY "admin_all_users" ON public.users FOR ALL TO authenticated
  USING (auth.jwt() ->> 'email' = 'admin@gmail.com')
  WITH CHECK (auth.jwt() ->> 'email' = 'admin@gmail.com');

-- public.children
DROP POLICY IF EXISTS "admin_all_children" ON public.children;
CREATE POLICY "admin_all_children" ON public.children FOR ALL TO authenticated
  USING (auth.jwt() ->> 'email' = 'admin@gmail.com')
  WITH CHECK (auth.jwt() ->> 'email' = 'admin@gmail.com');

-- public.sessions
DROP POLICY IF EXISTS "admin_all_sessions" ON public.sessions;
CREATE POLICY "admin_all_sessions" ON public.sessions FOR ALL TO authenticated
  USING (auth.jwt() ->> 'email' = 'admin@gmail.com')
  WITH CHECK (auth.jwt() ->> 'email' = 'admin@gmail.com');

-- public.learn_content
DROP POLICY IF EXISTS "admin_all_learn_content" ON public.learn_content;
CREATE POLICY "admin_all_learn_content" ON public.learn_content FOR ALL TO authenticated
  USING (auth.jwt() ->> 'email' = 'admin@gmail.com')
  WITH CHECK (auth.jwt() ->> 'email' = 'admin@gmail.com');

-- public.practitioner_children
DROP POLICY IF EXISTS "admin_all_practitioner_children" ON public.practitioner_children;
CREATE POLICY "admin_all_practitioner_children" ON public.practitioner_children FOR ALL TO authenticated
  USING (auth.jwt() ->> 'email' = 'admin@gmail.com')
  WITH CHECK (auth.jwt() ->> 'email' = 'admin@gmail.com');

-- public.connection_requests
DROP POLICY IF EXISTS "admin_all_connection_requests" ON public.connection_requests;
CREATE POLICY "admin_all_connection_requests" ON public.connection_requests FOR ALL TO authenticated
  USING (auth.jwt() ->> 'email' = 'admin@gmail.com')
  WITH CHECK (auth.jwt() ->> 'email' = 'admin@gmail.com');

-- public.atlas_profiles
DROP POLICY IF EXISTS "admin_all_atlas_profiles" ON public.atlas_profiles;
CREATE POLICY "admin_all_atlas_profiles" ON public.atlas_profiles FOR ALL TO authenticated
  USING (auth.jwt() ->> 'email' = 'admin@gmail.com')
  WITH CHECK (auth.jwt() ->> 'email' = 'admin@gmail.com');

-- public.documents
DROP POLICY IF EXISTS "admin_all_documents" ON public.documents;
CREATE POLICY "admin_all_documents" ON public.documents FOR ALL TO authenticated
  USING (auth.jwt() ->> 'email' = 'admin@gmail.com')
  WITH CHECK (auth.jwt() ->> 'email' = 'admin@gmail.com');

-- public.prescriptions
DROP POLICY IF EXISTS "admin_all_prescriptions" ON public.prescriptions;
CREATE POLICY "admin_all_prescriptions" ON public.prescriptions FOR ALL TO authenticated
  USING (auth.jwt() ->> 'email' = 'admin@gmail.com')
  WITH CHECK (auth.jwt() ->> 'email' = 'admin@gmail.com');

-- public.consent
DROP POLICY IF EXISTS "admin_all_consent" ON public.consent;
CREATE POLICY "admin_all_consent" ON public.consent FOR ALL TO authenticated
  USING (auth.jwt() ->> 'email' = 'admin@gmail.com')
  WITH CHECK (auth.jwt() ->> 'email' = 'admin@gmail.com');

-- public.reflex_scores (if it exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'reflex_scores' AND table_schema = 'public') THEN
    ALTER TABLE public.reflex_scores ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "admin_all_reflex_scores" ON public.reflex_scores;
    CREATE POLICY "admin_all_reflex_scores" ON public.reflex_scores FOR ALL TO authenticated
      USING (auth.jwt() ->> 'email' = 'admin@gmail.com')
      WITH CHECK (auth.jwt() ->> 'email' = 'admin@gmail.com');
  END IF;
END $$;
