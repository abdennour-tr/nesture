-- Migration: Create user_feature_flags Table and Policies
-- Enable feature flagging capabilities for authenticated users.

-- 1. Drop existing table if exists
DROP TABLE IF EXISTS public.user_feature_flags CASCADE;

-- 2. Create table referencing public.users instead of auth.users to avoid permission issues
CREATE TABLE public.user_feature_flags (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  feature_name TEXT NOT NULL,
  enabled BOOLEAN DEFAULT FALSE NOT NULL,
  enabled_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  enabled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE(user_id, feature_name)
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.user_feature_flags ENABLE ROW LEVEL SECURITY;

-- Policy 1: Users can read their own feature flags
CREATE POLICY "Users can read own feature flags"
  ON public.user_feature_flags FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Policy 2: Admins can manage (ALL operations) all user feature flags
CREATE POLICY "Admins can manage feature flags"
  ON public.user_feature_flags FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE users.id = auth.uid() AND users.role = 'admin'
    )
  );
