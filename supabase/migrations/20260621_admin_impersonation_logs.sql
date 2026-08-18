-- ==============================================================================
-- Migration: Admin Portal Specialist Management, Status, and Audit Logs
-- ==============================================================================

-- 1. Add email and is_active columns to public.users
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email TEXT DEFAULT NULL;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

-- 2. Update trigger function to automatically populate email in public.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.users (id, role, first_name, last_name, email, is_demo, beta_participant)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'role', 'parent')::user_role,
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    NEW.email,
    FALSE,
    TRUE
  )
  ON CONFLICT (id) DO UPDATE SET 
    email = COALESCE(EXCLUDED.email, public.users.email),
    first_name = COALESCE(EXCLUDED.first_name, public.users.first_name),
    last_name = COALESCE(EXCLUDED.last_name, public.users.last_name);
  RETURN NEW;
END;
$$;

-- 3. One-time backfill of emails from auth.users to public.users
UPDATE public.users u
SET email = au.email
FROM auth.users au
WHERE u.id = au.id;

-- 4. Create admin_audit_logs table
CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  target_user_id UUID NOT NULL,
  details TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Enable RLS on admin_audit_logs
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

-- 6. Create RLS Policies for admin_audit_logs (Only Admin has access)
DROP POLICY IF EXISTS "admin_all_audit_logs" ON public.admin_audit_logs;
CREATE POLICY "admin_all_audit_logs" ON public.admin_audit_logs FOR ALL TO authenticated
  USING (auth.jwt() ->> 'email' = 'admin@gmail.com')
  WITH CHECK (auth.jwt() ->> 'email' = 'admin@gmail.com');
