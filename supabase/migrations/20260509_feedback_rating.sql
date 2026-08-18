-- Add feedback rating column to sessions table
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS feedback_rating INTEGER;
