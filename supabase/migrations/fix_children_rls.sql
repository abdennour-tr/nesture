-- ============================================================
-- NestureAI — Fix RLS policies for all tables
-- Run this in Supabase SQL Editor (once)
-- ============================================================
-- This script fixes the following problems:
--   1. public.children has RLS enabled but NO policies → parents
--      cannot add/read their children, learners can't read their
--      own record.
--   2. public.users read policy is too restrictive → learners
--      can read their own row but not look up OT names, etc.
--   3. Sessions/reflex_scores may be missing open policies.
-- ============================================================

-- ══════════════════════════════════════════════════════════════
-- 1. public.users policies
-- ══════════════════════════════════════════════════════════════

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Drop old narrow policies
DROP POLICY IF EXISTS "users_read_own"              ON public.users;
DROP POLICY IF EXISTS "users_insert_own"             ON public.users;
DROP POLICY IF EXISTS "users_update_own"             ON public.users;
DROP POLICY IF EXISTS "users_read_all_authenticated" ON public.users;

-- Any authenticated user can read any user row (needed for OT lookup, etc.)
CREATE POLICY "users_read_all_authenticated"
  ON public.users FOR SELECT
  USING (auth.role() = 'authenticated');

-- Users can insert their own row (fallback if trigger fails)
CREATE POLICY "users_insert_own"
  ON public.users FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Users can update their own row
CREATE POLICY "users_update_own"
  ON public.users FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- ══════════════════════════════════════════════════════════════
-- 2. public.children policies
-- ══════════════════════════════════════════════════════════════

ALTER TABLE public.children ENABLE ROW LEVEL SECURITY;

-- Drop all existing children policies to start clean
DROP POLICY IF EXISTS "children_parent_select"  ON public.children;
DROP POLICY IF EXISTS "children_parent_insert"  ON public.children;
DROP POLICY IF EXISTS "children_parent_update"  ON public.children;
DROP POLICY IF EXISTS "children_parent_delete"  ON public.children;
DROP POLICY IF EXISTS "children_learner_select" ON public.children;
DROP POLICY IF EXISTS "children_ot_select"      ON public.children;
DROP POLICY IF EXISTS "children_ot_update"      ON public.children;

-- Parents can read their own children
CREATE POLICY "children_parent_select"
  ON public.children FOR SELECT
  USING (auth.uid() = parent_id);

-- Parents can insert children linked to themselves
CREATE POLICY "children_parent_insert"
  ON public.children FOR INSERT
  WITH CHECK (auth.uid() = parent_id);

-- Parents can update their own children
CREATE POLICY "children_parent_update"
  ON public.children FOR UPDATE
  USING (auth.uid() = parent_id)
  WITH CHECK (auth.uid() = parent_id);

-- Parents can delete their own children
CREATE POLICY "children_parent_delete"
  ON public.children FOR DELETE
  USING (auth.uid() = parent_id);

-- Learners can read their own child record (auth_user_id match)
CREATE POLICY "children_learner_select"
  ON public.children FOR SELECT
  USING (auth.uid() = auth_user_id);

-- OTs can read children assigned to them
CREATE POLICY "children_ot_select"
  ON public.children FOR SELECT
  USING (auth.uid() = ot_id);

-- OTs can update children assigned to them
CREATE POLICY "children_ot_update"
  ON public.children FOR UPDATE
  USING (auth.uid() = ot_id);

-- ══════════════════════════════════════════════════════════════
-- 3. Ensure sessions, reflex_scores have open policies
-- ══════════════════════════════════════════════════════════════

ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sessions_read"   ON public.sessions;
DROP POLICY IF EXISTS "sessions_insert" ON public.sessions;
DROP POLICY IF EXISTS "sessions_update" ON public.sessions;
DROP POLICY IF EXISTS "sessions_delete" ON public.sessions;

CREATE POLICY "sessions_read"   ON public.sessions FOR SELECT USING (true);
CREATE POLICY "sessions_insert" ON public.sessions FOR INSERT WITH CHECK (true);
CREATE POLICY "sessions_update" ON public.sessions FOR UPDATE USING (true);
CREATE POLICY "sessions_delete" ON public.sessions FOR DELETE USING (true);

-- Reflex scores
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'reflex_scores' AND table_schema = 'public') THEN
    ALTER TABLE public.reflex_scores ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "reflex_read"   ON public.reflex_scores;
    DROP POLICY IF EXISTS "reflex_insert" ON public.reflex_scores;
    CREATE POLICY "reflex_read"   ON public.reflex_scores FOR SELECT USING (true);
    CREATE POLICY "reflex_insert" ON public.reflex_scores FOR INSERT WITH CHECK (true);
  END IF;
END $$;

-- ══════════════════════════════════════════════════════════════
-- 4. Ensure the auth trigger exists and is robust
-- ══════════════════════════════════════════════════════════════

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
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'handle_new_user error: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ══════════════════════════════════════════════════════════════
-- 5. Verification
-- ══════════════════════════════════════════════════════════════

SELECT 'Users policies' AS check_name,
       count(*)::text || ' policies' AS result
FROM pg_policies WHERE schemaname = 'public' AND tablename = 'users'
UNION ALL
SELECT 'Children policies',
       count(*)::text || ' policies'
FROM pg_policies WHERE schemaname = 'public' AND tablename = 'children'
UNION ALL
SELECT 'Sessions policies',
       count(*)::text || ' policies'
FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sessions'
UNION ALL
SELECT 'Trigger installed',
       CASE WHEN EXISTS (
         SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created'
       ) THEN 'OK ✓' ELSE 'MISSING ✗' END;
