-- ── 1. Add game_name and is_archived columns to sessions table ──
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS game_name TEXT DEFAULT 'LetterQuest';
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE;

-- ── 2. Add performance indexes ──
CREATE INDEX IF NOT EXISTS idx_sessions_learner_id ON public.sessions(learner_id);
CREATE INDEX IF NOT EXISTS idx_sessions_start_time ON public.sessions(start_time);
CREATE INDEX IF NOT EXISTS idx_sessions_is_archived ON public.sessions(is_archived);

-- ── 3. Auto-archive any existing sessions older than 30 days ──
UPDATE public.sessions
SET is_archived = TRUE
WHERE (start_time < NOW() - INTERVAL '30 days' OR session_date < NOW() - INTERVAL '30 days')
  AND is_archived = FALSE;
