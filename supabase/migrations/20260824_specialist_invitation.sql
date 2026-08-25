-- Add columns to public.users for the specialist invitation workflow
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS must_reset_password BOOLEAN DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS invitation_token TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS invitation_expires_at TIMESTAMPTZ;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS invitation_accepted_at TIMESTAMPTZ;
