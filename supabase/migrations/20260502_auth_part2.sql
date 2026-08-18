-- ============================================================
-- NestureAI Auth Migration — PARTIE 2 of 2
-- À exécuter APRÈS la Partie 1 (colonnes déjà ajoutées)
-- ============================================================

-- ── 1. Index unique sur auth_id ───────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS users_auth_id_idx ON public.users(auth_id);

-- ── 2. Trigger auto-insert dans public.users à chaque signup ──
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

-- ── 3. RLS policies pour consent & feedback ───────────────────
ALTER TABLE public.consent  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "consent_own"    ON public.consent;
DROP POLICY IF EXISTS "feedback_insert" ON public.feedback;
DROP POLICY IF EXISTS "feedback_read"  ON public.feedback;

CREATE POLICY "consent_own"     ON public.consent  FOR ALL    USING (auth.uid() = auth_id);
CREATE POLICY "feedback_insert" ON public.feedback FOR INSERT WITH CHECK (auth.uid() = auth_id);
CREATE POLICY "feedback_read"   ON public.feedback FOR SELECT USING (auth.uid() = auth_id);

-- ── 4. Lier les comptes démo dans public.users ────────────────
-- Insère ou met à jour les 3 comptes démo (jennifer, sarah, akhil)
-- en les liant à leurs UUID Supabase Auth

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
  is_demo          = TRUE,
  beta_participant  = TRUE,
  first_name        = EXCLUDED.first_name,
  last_name         = EXCLUDED.last_name,
  role              = EXCLUDED.role;

-- ── 5. Seeder les 4 enfants sous Jennifer ─────────────────────

-- Lily (age 8, ASD, Easy)
INSERT INTO public.children (id, parent_id, first_name, age, diagnosis, letterquest_level, completeness_percentage)
SELECT gen_random_uuid(), u.id, 'Lily', 8, 'ASD', 'easy', 28
FROM public.users u
WHERE u.auth_id = (SELECT id FROM auth.users WHERE email = 'jennifer@example.com')
  AND NOT EXISTS (
    SELECT 1 FROM public.children c WHERE c.parent_id = u.id AND c.first_name = 'Lily'
  );

-- Marcus (age 12, ASD, Medium)
INSERT INTO public.children (id, parent_id, first_name, age, diagnosis, letterquest_level, completeness_percentage)
SELECT gen_random_uuid(), u.id, 'Marcus', 12, 'ASD', 'medium', 72
FROM public.users u
WHERE u.auth_id = (SELECT id FROM auth.users WHERE email = 'jennifer@example.com')
  AND NOT EXISTS (
    SELECT 1 FROM public.children c WHERE c.parent_id = u.id AND c.first_name = 'Marcus'
  );

-- Akhil (age 22, complex — reuse existing child_id)
INSERT INTO public.children (id, parent_id, first_name, last_name, age, diagnosis, letterquest_level, completeness_percentage)
SELECT
  '00000000-0000-0000-0000-000000000002'::uuid,
  u.id, 'Akhil', 'M.', 22,
  'ASD, CAPD, Mitochondrial Disease, Generalised Dyspraxia',
  'complex_sentences', 95
FROM public.users u
WHERE u.auth_id = (SELECT id FROM auth.users WHERE email = 'jennifer@example.com')
ON CONFLICT (id) DO UPDATE SET
  parent_id             = EXCLUDED.parent_id,
  letterquest_level     = 'complex_sentences',
  completeness_percentage = 95;

-- Alex (age 10, ASD, Medium, adaptive demo flag)
INSERT INTO public.children (id, parent_id, first_name, age, diagnosis, letterquest_level, completeness_percentage, adaptive_demo)
SELECT gen_random_uuid(), u.id, 'Alex', 10, 'ASD', 'medium', 60, TRUE
FROM public.users u
WHERE u.auth_id = (SELECT id FROM auth.users WHERE email = 'jennifer@example.com')
  AND NOT EXISTS (
    SELECT 1 FROM public.children c WHERE c.parent_id = u.id AND c.first_name = 'Alex'
  );

-- ── Vérification ──────────────────────────────────────────────
SELECT 'public.users demo accounts:' AS check_name, count(*) AS count
FROM public.users WHERE is_demo = TRUE
UNION ALL
SELECT 'children under Jennifer:', count(*)
FROM public.children c
JOIN public.users u ON u.id = c.parent_id
WHERE u.auth_id = (SELECT id FROM auth.users WHERE email = 'jennifer@example.com');
