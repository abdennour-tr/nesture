-- Migration: Add cancel_at_period_end to subscriptions table
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'subscriptions' 
          AND column_name = 'cancel_at_period_end'
    ) THEN
        ALTER TABLE public.subscriptions ADD COLUMN cancel_at_period_end BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

COMMENT ON COLUMN public.subscriptions.cancel_at_period_end IS 'True if the subscription is set to cancel at the end of the current billing period';
