-- ============================================================
-- Migration: Update Admin Credentials & RLS Policies
-- ============================================================

-- 1. Update the default admin user credentials in auth.users
UPDATE auth.users
SET 
  email = 'nesture.admin.secure.2026@gmail.com',
  encrypted_password = extensions.crypt('NestureAdmin2026!Secure', extensions.gen_salt('bf')),
  email_confirmed_at = now(),
  updated_at = now()
WHERE id = '00000000-0000-0000-0000-0000000000a0';

-- 2. Update RLS policies to check for the new secure admin email

ALTER POLICY "admin_all_users" ON public.users 
  USING (auth.jwt() ->> 'email' = 'nesture.admin.secure.2026@gmail.com') 
  WITH CHECK (auth.jwt() ->> 'email' = 'nesture.admin.secure.2026@gmail.com');

ALTER POLICY "admin_all_children" ON public.children 
  USING (auth.jwt() ->> 'email' = 'nesture.admin.secure.2026@gmail.com') 
  WITH CHECK (auth.jwt() ->> 'email' = 'nesture.admin.secure.2026@gmail.com');

ALTER POLICY "admin_all_sessions" ON public.sessions 
  USING (auth.jwt() ->> 'email' = 'nesture.admin.secure.2026@gmail.com') 
  WITH CHECK (auth.jwt() ->> 'email' = 'nesture.admin.secure.2026@gmail.com');

ALTER POLICY "admin_all_learn_content" ON public.learn_content 
  USING (auth.jwt() ->> 'email' = 'nesture.admin.secure.2026@gmail.com') 
  WITH CHECK (auth.jwt() ->> 'email' = 'nesture.admin.secure.2026@gmail.com');

ALTER POLICY "admin_all_practitioner_children" ON public.practitioner_children 
  USING (auth.jwt() ->> 'email' = 'nesture.admin.secure.2026@gmail.com') 
  WITH CHECK (auth.jwt() ->> 'email' = 'nesture.admin.secure.2026@gmail.com');

ALTER POLICY "admin_all_connection_requests" ON public.connection_requests 
  USING (auth.jwt() ->> 'email' = 'nesture.admin.secure.2026@gmail.com') 
  WITH CHECK (auth.jwt() ->> 'email' = 'nesture.admin.secure.2026@gmail.com');

ALTER POLICY "admin_all_atlas_profiles" ON public.atlas_profiles 
  USING (auth.jwt() ->> 'email' = 'nesture.admin.secure.2026@gmail.com') 
  WITH CHECK (auth.jwt() ->> 'email' = 'nesture.admin.secure.2026@gmail.com');

ALTER POLICY "admin_all_documents" ON public.documents 
  USING (auth.jwt() ->> 'email' = 'nesture.admin.secure.2026@gmail.com') 
  WITH CHECK (auth.jwt() ->> 'email' = 'nesture.admin.secure.2026@gmail.com');

ALTER POLICY "admin_all_prescriptions" ON public.prescriptions 
  USING (auth.jwt() ->> 'email' = 'nesture.admin.secure.2026@gmail.com') 
  WITH CHECK (auth.jwt() ->> 'email' = 'nesture.admin.secure.2026@gmail.com');

ALTER POLICY "admin_all_consent" ON public.consent 
  USING (auth.jwt() ->> 'email' = 'nesture.admin.secure.2026@gmail.com') 
  WITH CHECK (auth.jwt() ->> 'email' = 'nesture.admin.secure.2026@gmail.com');

-- Dynamic check for newer/optional tables to prevent execution errors if migrations are partially applied
DO $$
BEGIN
  -- 1. admin_impersonation_logs
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'admin_impersonation_logs' AND table_schema = 'public') THEN
    EXECUTE 'ALTER POLICY "admin_all_impersonation_logs" ON public.admin_impersonation_logs USING (auth.jwt() ->> ''email'' = ''nesture.admin.secure.2026@gmail.com'') WITH CHECK (auth.jwt() ->> ''email'' = ''nesture.admin.secure.2026@gmail.com'')';
  END IF;

  -- 2. ask_ai_messages
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ask_ai_messages' AND table_schema = 'public') THEN
    EXECUTE 'ALTER POLICY "admin_all_ask_ai_messages" ON public.ask_ai_messages USING (auth.jwt() ->> ''email'' = ''nesture.admin.secure.2026@gmail.com'') WITH CHECK (auth.jwt() ->> ''email'' = ''nesture.admin.secure.2026@gmail.com'')';
  END IF;

  -- 3. reflex_scores
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'admin_all_reflex_scores' AND tablename = 'reflex_scores') THEN
    EXECUTE 'ALTER POLICY "admin_all_reflex_scores" ON public.reflex_scores USING (auth.jwt() ->> ''email'' = ''nesture.admin.secure.2026@gmail.com'') WITH CHECK (auth.jwt() ->> ''email'' = ''nesture.admin.secure.2026@gmail.com'')';
  END IF;
END $$;
