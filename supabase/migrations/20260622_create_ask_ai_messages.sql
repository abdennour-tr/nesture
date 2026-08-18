-- ============================================================
-- Migration: Create public.ask_ai_messages table with RLS
-- Isolates Ask AI conversations by user_id, user_role, and child_id
-- ============================================================

DROP TABLE IF EXISTS public.ask_ai_messages;

CREATE TABLE IF NOT EXISTS public.ask_ai_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  user_role TEXT NOT NULL,
  child_id UUID NOT NULL REFERENCES public.children(id) ON DELETE CASCADE,
  sender TEXT NOT NULL CHECK (sender IN ('user', 'ai')),
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexing for quick lookups and isolation constraints
CREATE INDEX IF NOT EXISTS idx_ask_ai_messages_lookup ON public.ask_ai_messages (user_id, user_role, child_id, created_at);

-- Enable Row Level Security
ALTER TABLE public.ask_ai_messages ENABLE ROW LEVEL SECURITY;

-- Add RLS Policies

-- 1. Standard authenticated users can select their own chat history
DROP POLICY IF EXISTS "Users can view their own ask_ai_messages" ON public.ask_ai_messages;
CREATE POLICY "Users can view their own ask_ai_messages" ON public.ask_ai_messages
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- 2. Standard authenticated users can insert their own messages
DROP POLICY IF EXISTS "Users can insert their own ask_ai_messages" ON public.ask_ai_messages;
CREATE POLICY "Users can insert their own ask_ai_messages" ON public.ask_ai_messages
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- 3. Standard authenticated users can reset/delete their own conversation history
DROP POLICY IF EXISTS "Users can delete their own ask_ai_messages" ON public.ask_ai_messages;
CREATE POLICY "Users can delete their own ask_ai_messages" ON public.ask_ai_messages
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- 4. Administrators can manage all ask_ai_messages (matching other system tables)
DROP POLICY IF EXISTS "admin_all_ask_ai_messages" ON public.ask_ai_messages;
CREATE POLICY "admin_all_ask_ai_messages" ON public.ask_ai_messages
  FOR ALL TO authenticated
  USING (auth.jwt() ->> 'email' = 'admin@gmail.com')
  WITH CHECK (auth.jwt() ->> 'email' = 'admin@gmail.com');
