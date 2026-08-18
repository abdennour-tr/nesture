-- ============================================================
-- NestureAI — Auth Migration
-- Run in Supabase SQL Editor AFTER creating the 3 demo users
-- in Auth Dashboard (jennifer, sarah, akhil @example.com)
-- ============================================================

-- ── 1. Extend public.users table ─────────────────────────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS auth_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_demo    BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS beta_participant BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS converted_at TIMESTAMPTZ DEFAULT NULL;

-- Unique index so the trigger can use ON CONFLICT (auth_id)
CREATE UNIQUE INDEX IF NOT EXISTS users_auth_id_idx ON public.users(auth_id);

-- ── 2. Consent table ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.consent (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id              UUID REFERENCES public.users(id) ON DELETE CASCADE,
  auth_id                UUID REFERENCES auth.users(id),
  agreement_version      VARCHAR(10) DEFAULT 'v1.0',
  accepted_at            TIMESTAMPTZ DEFAULT NOW(),
  ip_address             TEXT,
  sections_consented     JSONB DEFAULT '["strengths","challenges","communication_profile","sensory_profile","functional_wellness","primitive_motor_reflex"]'::jsonb,
  practitioner_sharing   BOOLEAN DEFAULT FALSE,
  beta_participation     BOOLEAN DEFAULT TRUE,
  withdrawal_at          TIMESTAMPTZ DEFAULT NULL,
  withdrawn_practitioners JSONB DEFAULT NULL
);

-- ── 3. Feedback table ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.feedback (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID REFERENCES public.users(id),
  auth_id        UUID REFERENCES auth.users(id),
  feature        TEXT NOT NULL,
  comment        TEXT,
  rating         INTEGER CHECK (rating >= 1 AND rating <= 5),
  session_number INTEGER DEFAULT NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── 4. Add letterquest_level + completeness to children ───────
ALTER TABLE public.children
  ADD COLUMN IF NOT EXISTS letterquest_level   TEXT DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS completeness_percentage INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adaptive_demo       BOOLEAN DEFAULT FALSE;

-- ── 5. Trigger: auto-insert into public.users on signup ──────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.users (auth_id, role, first_name, last_name, is_demo, beta_participant)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'role', 'parent'),
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    FALSE,
    TRUE
  )
  ON CONFLICT (auth_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── 6. RLS Policies ───────────────────────────────────────────
ALTER TABLE public.consent  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

-- consent: only own records
DROP POLICY IF EXISTS "consent_own" ON public.consent;
CREATE POLICY "consent_own" ON public.consent
  FOR ALL USING (auth.uid() = auth_id);

-- feedback: insert own, read own
DROP POLICY IF EXISTS "feedback_insert" ON public.feedback;
CREATE POLICY "feedback_insert" ON public.feedback
  FOR INSERT WITH CHECK (auth.uid() = auth_id);

DROP POLICY IF EXISTS "feedback_read" ON public.feedback;
CREATE POLICY "feedback_read" ON public.feedback
  FOR SELECT USING (auth.uid() = auth_id);

-- ── 7. Link demo accounts (run AFTER creating in Auth Dashboard)
-- Replace the UUIDs below with the real auth.users UUIDs from your dashboard

-- Step 7a: insert public.users rows for demo accounts
-- (The trigger will handle NEW signups, but demo accounts were created
--  before the trigger existed, so we insert manually)

-- Get the auth UUIDs from your Supabase Auth Dashboard and replace below:
-- jennifer@example.com → role: parent
-- sarah@example.com    → role: ot
-- akhil@example.com    → role: learner

-- Insert/update public.users for demo accounts using a subquery on auth.users email
INSERT INTO public.users (auth_id, role, first_name, last_name, is_demo, beta_participant)
SELECT
  au.id,
  CASE au.email
    WHEN 'jennifer@example.com' THEN 'parent'
    WHEN 'sarah@example.com'    THEN 'ot'
    WHEN 'akhil@example.com'    THEN 'learner'
  END,
  CASE au.email
    WHEN 'jennifer@example.com' THEN 'Jennifer'
    WHEN 'sarah@example.com'    THEN 'Sarah'
    WHEN 'akhil@example.com'    THEN 'Akhil'
  END,
  CASE au.email
    WHEN 'jennifer@example.com' THEN 'Chen'
    WHEN 'sarah@example.com'    THEN 'Williams'
    WHEN 'akhil@example.com'    THEN 'M.'
  END,
  TRUE,
  TRUE
FROM auth.users au
WHERE au.email IN ('jennifer@example.com', 'sarah@example.com', 'akhil@example.com')
ON CONFLICT (auth_id) DO UPDATE SET
  is_demo = TRUE,
  beta_participant = TRUE,
  first_name = EXCLUDED.first_name,
  last_name = EXCLUDED.last_name,
  role = EXCLUDED.role;

-- ── 8. Seed 4 children under Jennifer ────────────────────────
-- Insert Lily, Marcus, Akhil, Alex under Jennifer's parent account
-- (parent_id resolved from jennifer@example.com auth_id)

INSERT INTO public.children (id, parent_id, first_name, last_name, age, diagnosis, letterquest_level, completeness_percentage)
SELECT
  gen_random_uuid(),
  u.id,
  'Lily', NULL, 8, 'ASD', 'easy', 28
FROM public.users u
JOIN auth.users au ON au.id = u.auth_id
WHERE au.email = 'jennifer@example.com'
ON CONFLICT DO NOTHING;

INSERT INTO public.children (id, parent_id, first_name, last_name, age, diagnosis, letterquest_level, completeness_percentage)
SELECT
  gen_random_uuid(),
  u.id,
  'Marcus', NULL, 12, 'ASD', 'medium', 72
FROM public.users u
JOIN auth.users au ON au.id = u.auth_id
WHERE au.email = 'jennifer@example.com'
ON CONFLICT DO NOTHING;

-- Akhil — reuse existing child_id '00000000-0000-0000-0000-000000000002'
-- or insert new if not present, linked to Jennifer
INSERT INTO public.children (id, parent_id, first_name, last_name, age, diagnosis, letterquest_level, completeness_percentage)
SELECT
  '00000000-0000-0000-0000-000000000002'::uuid,
  u.id,
  'Akhil', 'M.', 22,
  'ASD, CAPD, Mitochondrial Disease, Generalised Dyspraxia',
  'complex_sentences', 95
FROM public.users u
JOIN auth.users au ON au.id = u.auth_id
WHERE au.email = 'jennifer@example.com'
ON CONFLICT (id) DO UPDATE SET
  parent_id = EXCLUDED.parent_id,
  letterquest_level = 'complex_sentences',
  completeness_percentage = 95;

INSERT INTO public.children (id, parent_id, first_name, last_name, age, diagnosis, letterquest_level, completeness_percentage, adaptive_demo)
SELECT
  gen_random_uuid(),
  u.id,
  'Alex', NULL, 10, 'ASD', 'medium', 60, TRUE
FROM public.users u
JOIN auth.users au ON au.id = u.auth_id
WHERE au.email = 'jennifer@example.com'
ON CONFLICT DO NOTHING;
