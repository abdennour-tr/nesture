-- Create subscriptions table to track parent subscription tier and learner counts
CREATE TABLE IF NOT EXISTS public.subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id UUID NOT NULL,
    stripe_subscription_id TEXT UNIQUE NOT NULL,
    stripe_customer_id TEXT,
    tier TEXT NOT NULL DEFAULT 'starter',
    learner_count INT NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for quick lookup by parent_id
CREATE INDEX IF NOT EXISTS idx_subscriptions_parent_id ON public.subscriptions(parent_id);

-- Enable RLS
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Parents can view their own subscription
CREATE POLICY "Parents can view their own subscription"
    ON public.subscriptions
    FOR SELECT
    USING (auth.uid() = parent_id);

-- RLS Policy: Service role has full access
CREATE POLICY "Service role can manage all subscriptions"
    ON public.subscriptions
    FOR ALL
    USING (true)
    WITH CHECK (true);
