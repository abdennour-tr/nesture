-- ============================================================
-- NestureAI — Migration v2 : Extension du schéma
-- À exécuter EN PREMIER dans Supabase SQL Editor
-- ============================================================

-- ── 1. Extension de la table children ────────────────────────
ALTER TABLE public.children
  ADD COLUMN IF NOT EXISTS ot_id UUID REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS auth_user_id UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS letterquest_level TEXT DEFAULT 'easy',
  ADD COLUMN IF NOT EXISTS completeness_percentage INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avatar_color TEXT DEFAULT '#0D5E6B';

-- ── 2. Extension de la table sessions ────────────────────────
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS learner_id UUID REFERENCES public.children(id),
  ADD COLUMN IF NOT EXISTS start_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS end_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS duration_seconds INTEGER,
  ADD COLUMN IF NOT EXISTS difficulty TEXT,
  ADD COLUMN IF NOT EXISTS scenario TEXT,
  ADD COLUMN IF NOT EXISTS total_attempts INTEGER,
  ADD COLUMN IF NOT EXISTS perfect_grabs INTEGER,
  ADD COLUMN IF NOT EXISTS failed_grabs INTEGER,
  ADD COLUMN IF NOT EXISTS skipped INTEGER,
  ADD COLUMN IF NOT EXISTS accuracy_score DECIMAL(5,3),
  ADD COLUMN IF NOT EXISTS avg_response_time_ms INTEGER,
  ADD COLUMN IF NOT EXISTS trajectory_smoothness DECIMAL(5,3),
  ADD COLUMN IF NOT EXISTS fatigue_index DECIMAL(5,3),
  ADD COLUMN IF NOT EXISTS midline_crossings INTEGER,
  ADD COLUMN IF NOT EXISTS lpi_score INTEGER;

-- ── 3. Table reflex_scores ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reflex_scores (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID REFERENCES public.sessions(id) ON DELETE CASCADE,
  learner_id UUID REFERENCES public.children(id) ON DELETE CASCADE,
  reflex_name TEXT NOT NULL,
  confidence_level TEXT,
  score INTEGER,
  indicators_found INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.reflex_scores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reflex_read"   ON public.reflex_scores;
DROP POLICY IF EXISTS "reflex_insert" ON public.reflex_scores;
CREATE POLICY "reflex_read"   ON public.reflex_scores FOR SELECT USING (true);
CREATE POLICY "reflex_insert" ON public.reflex_scores FOR INSERT WITH CHECK (true);

-- ── 4. Table exercises ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.exercises (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  target_reflex TEXT,
  description TEXT,
  duration_minutes TEXT,
  video_url TEXT,
  difficulty_level TEXT DEFAULT 'easy'
);
ALTER TABLE public.exercises ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "exercises_read"   ON public.exercises;
DROP POLICY IF EXISTS "exercises_insert" ON public.exercises;
CREATE POLICY "exercises_read"   ON public.exercises FOR SELECT USING (true);
CREATE POLICY "exercises_insert" ON public.exercises FOR INSERT WITH CHECK (true);

-- ── 5. Table prescriptions ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.prescriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  learner_id UUID REFERENCES public.children(id) ON DELETE CASCADE,
  exercise_id TEXT REFERENCES public.exercises(id),
  session_id UUID REFERENCES public.sessions(id),
  notes TEXT,
  prescribed_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.prescriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "presc_read"   ON public.prescriptions;
DROP POLICY IF EXISTS "presc_insert" ON public.prescriptions;
DROP POLICY IF EXISTS "presc_delete" ON public.prescriptions;
CREATE POLICY "presc_read"   ON public.prescriptions FOR SELECT USING (true);
CREATE POLICY "presc_insert" ON public.prescriptions FOR INSERT WITH CHECK (true);
CREATE POLICY "presc_delete" ON public.prescriptions FOR DELETE USING (true);

-- ── 6. RLS pour sessions (insert + update) ───────────────────
DROP POLICY IF EXISTS "sessions_insert" ON public.sessions;
DROP POLICY IF EXISTS "sessions_update" ON public.sessions;
DROP POLICY IF EXISTS "sessions_read"   ON public.sessions;
CREATE POLICY "sessions_read"   ON public.sessions FOR SELECT USING (true);
CREATE POLICY "sessions_insert" ON public.sessions FOR INSERT WITH CHECK (true);
CREATE POLICY "sessions_update" ON public.sessions FOR UPDATE USING (true);

-- ── Vérification ──────────────────────────────────────────────
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('children','sessions','reflex_scores','exercises','prescriptions')
ORDER BY table_name;
