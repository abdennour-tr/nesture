-- Migration: Update subscriptions table for the new plan system
-- New plans: 7day_pass, premium, family, annual_family (replacing starter/growth/enterprise)

-- Add new columns if they don't exist
DO $$
BEGIN
    -- billing_period: weekly, monthly, yearly
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'subscriptions' AND column_name = 'billing_period'
    ) THEN
        ALTER TABLE public.subscriptions ADD COLUMN billing_period TEXT NOT NULL DEFAULT 'monthly';
    END IF;

    -- current_period_end: when the current billing period ends
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'subscriptions' AND column_name = 'current_period_end'
    ) THEN
        ALTER TABLE public.subscriptions ADD COLUMN current_period_end TIMESTAMPTZ;
    END IF;

    -- trial_end: when the free trial ends (null if no trial)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'subscriptions' AND column_name = 'trial_end'
    ) THEN
        ALTER TABLE public.subscriptions ADD COLUMN trial_end TIMESTAMPTZ;
    END IF;
END $$;

-- Migrate existing tier values to new plan names
UPDATE public.subscriptions SET tier = 'premium' WHERE tier = 'starter';
UPDATE public.subscriptions SET tier = 'family' WHERE tier = 'growth';
UPDATE public.subscriptions SET tier = 'annual_family' WHERE tier = 'enterprise';

-- Add index for quick lookup by status (useful for checking active subscriptions)
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON public.subscriptions(status);

-- Add index for quick lookup by tier
CREATE INDEX IF NOT EXISTS idx_subscriptions_tier ON public.subscriptions(tier);

-- Comment for documentation
COMMENT ON TABLE public.subscriptions IS 'Tracks parent subscription plans: 7day_pass, premium, family, annual_family';
COMMENT ON COLUMN public.subscriptions.tier IS 'Plan type: 7day_pass, premium, family, or annual_family';
COMMENT ON COLUMN public.subscriptions.billing_period IS 'Billing frequency: weekly, monthly, or yearly';
COMMENT ON COLUMN public.subscriptions.current_period_end IS 'When the current billing period ends (from Stripe)';
COMMENT ON COLUMN public.subscriptions.trial_end IS 'When the free trial ends (null if no trial or trial expired)';
