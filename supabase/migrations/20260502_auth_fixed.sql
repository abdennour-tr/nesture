-- ============================================================
-- NestureAI Auth Migration — VERSION CORRIGÉE (tout en un)
-- La table public.users utilise déjà id = auth.users.id
-- Pas besoin d'une colonne auth_id séparée
-- ============================================================

-- ── 1. Ajouter les colonnes manquantes à public.users ─────────
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_demo         BOOLEAN   DEFAULT FALSE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS beta_participant BOOLEAN   DEFAULT FALSE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS converted_at    TIMESTAMPTZ DEFAULT NULL;

-- ── 2. Ajouter les colonnes à children ───────────────────────
ALTER TABLE public.children ADD COLUMN IF NOT EXISTS letterquest_level       TEXT    DEFAULT 'medium';
ALTER TABLE public.children ADD COLUMN IF NOT EXISTS completeness_percentage INTEGER DEFAULT 0;
ALTER TABLE public.children ADD COLUMN IF NOT EXISTS adaptive_demo           BOOLEAN DEFAULT FALSE;

-- ── 3. Créer la table consent ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.consent (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id               UUID REFERENCES public.users(id) ON DELETE CASCADE,
  agreement_version       VARCHAR(10) DEFAULT 'v1.0',
  accepted_at             TIMESTAMPTZ DEFAULT NOW(),
  ip_address              TEXT,
  sections_consented      JSONB DEFAULT '["strengths","challenges","communication_profile","sensory_profile","functional_wellness","primitive_motor_reflex"]'::jsonb,
  practitioner_sharing    BOOLEAN DEFAULT FALSE,
  beta_participation      BOOLEAN DEFAULT TRUE,
  withdrawal_at           TIMESTAMPTZ DEFAULT NULL,
  withdrawn_practitioners JSONB DEFAULT NULL
);

-- ── 4. Créer la table feedback ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.feedback (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID REFERENCES public.users(id),
  feature        TEXT NOT NULL,
  comment        TEXT,
  rating         INTEGER CHECK (rating >= 1 AND rating <= 5),
  session_number INTEGER DEFAULT NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── 5. Trigger: auto-insert dans public.users à chaque signup ─
-- NOTE: id = auth.users.id (pattern standard Supabase)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.users (id, role, first_name, last_name, is_demo, beta_participant)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'role', 'parent')::user_role,
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    FALSE,
    TRUE
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── 6. RLS policies ───────────────────────────────────────────
ALTER TABLE public.consent  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "consent_own"     ON public.consent;
DROP POLICY IF EXISTS "feedback_insert" ON public.feedback;
DROP POLICY IF EXISTS "feedback_read"   ON public.feedback;

CREATE POLICY "consent_own"     ON public.consent  FOR ALL    USING (auth.uid() = parent_id);
CREATE POLICY "feedback_insert" ON public.feedback FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "feedback_read"   ON public.feedback FOR SELECT USING (auth.uid() = user_id);

-- ── 7. Lier les comptes démo (id = auth.users.id) ─────────────
INSERT INTO public.users (id, role, first_name, last_name, is_demo, beta_participant)
SELECT
  au.id,
  CASE au.email
    WHEN 'jennifer@example.com' THEN 'parent'
    WHEN 'sarah@example.com'    THEN 'practitioner'
    WHEN 'akhil@example.com'    THEN 'learner'
  END::user_role,
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
  TRUE, TRUE
FROM auth.users au
WHERE au.email IN ('jennifer@example.com', 'sarah@example.com', 'akhil@example.com')
ON CONFLICT (id) DO UPDATE SET
  is_demo          = TRUE,
  beta_participant  = TRUE,
  first_name        = EXCLUDED.first_name,
  last_name         = EXCLUDED.last_name,
  role              = EXCLUDED.role;

-- ── 8. Seeder les 4 enfants sous Jennifer ─────────────────────
-- Lily (age 8, ASD, Easy)
INSERT INTO public.children (id, parent_id, first_name, age, diagnosis, letterquest_level, completeness_percentage)
SELECT gen_random_uuid(), au.id, 'Lily', 8, 'ASD', 'easy', 28
FROM auth.users au WHERE au.email = 'jennifer@example.com'
  AND NOT EXISTS (SELECT 1 FROM public.children c WHERE c.parent_id = au.id AND c.first_name = 'Lily');

-- Marcus (age 12, ASD, Medium)
INSERT INTO public.children (id, parent_id, first_name, age, diagnosis, letterquest_level, completeness_percentage)
SELECT gen_random_uuid(), au.id, 'Marcus', 12, 'ASD', 'medium', 72
FROM auth.users au WHERE au.email = 'jennifer@example.com'
  AND NOT EXISTS (SELECT 1 FROM public.children c WHERE c.parent_id = au.id AND c.first_name = 'Marcus');

-- Akhil (age 22, reuse existing child_id)
INSERT INTO public.children (id, parent_id, first_name, last_name, age, diagnosis, letterquest_level, completeness_percentage)
SELECT '00000000-0000-0000-0000-000000000002'::uuid, au.id, 'Akhil', 'M.', 22,
  'ASD, CAPD, Mitochondrial Disease, Generalised Dyspraxia', 'complex_sentences', 95
FROM auth.users au WHERE au.email = 'jennifer@example.com'
ON CONFLICT (id) DO UPDATE SET
  parent_id = EXCLUDED.parent_id,
  letterquest_level = 'complex_sentences',
  completeness_percentage = 95;

-- Alex (age 10, ASD, Medium, adaptive demo)
INSERT INTO public.children (id, parent_id, first_name, age, diagnosis, letterquest_level, completeness_percentage, adaptive_demo)
SELECT gen_random_uuid(), au.id, 'Alex', 10, 'ASD', 'medium', 60, TRUE
FROM auth.users au WHERE au.email = 'jennifer@example.com'
  AND NOT EXISTS (SELECT 1 FROM public.children c WHERE c.parent_id = au.id AND c.first_name = 'Alex');

-- ── Vérification finale ───────────────────────────────────────
SELECT 'Demo users' AS check_name, count(*)::text AS result FROM public.users WHERE is_demo = TRUE
UNION ALL
SELECT 'Children under Jennifer', count(*)::text
FROM public.children c JOIN auth.users au ON au.id = c.parent_id WHERE au.email = 'jennifer@example.com';
