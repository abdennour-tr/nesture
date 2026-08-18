-- ============================================================
-- Migration: Add specialist_id and status to prescriptions
-- Alters constraints to cascadingly delete on exercise removal
-- Enables real-time replication for prescriptions table
-- ============================================================

-- 1. Add specialist_id column referencing public.users
ALTER TABLE public.prescriptions ADD COLUMN IF NOT EXISTS specialist_id UUID REFERENCES public.users(id) ON DELETE CASCADE;

-- 2. Add status column
ALTER TABLE public.prescriptions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

-- 3. Replace exercise_id foreign key constraint to add ON DELETE CASCADE
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'prescriptions_exercise_id_fkey' 
      AND table_name = 'prescriptions'
  ) THEN
    ALTER TABLE public.prescriptions DROP CONSTRAINT prescriptions_exercise_id_fkey;
  END IF;
END $$;

ALTER TABLE public.prescriptions
  ADD CONSTRAINT prescriptions_exercise_id_fkey
  FOREIGN KEY (exercise_id)
  REFERENCES public.exercises(id)
  ON DELETE CASCADE;

-- 4. Enable real-time replication on public.prescriptions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' 
      AND schemaname = 'public' 
      AND tablename = 'prescriptions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.prescriptions;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END $$;
