-- Migration: Create public.decision_audit_logs table
CREATE TABLE IF NOT EXISTS public.decision_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID,
    child_id UUID NOT NULL REFERENCES public.children(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    decision TEXT NOT NULL,
    score INTEGER NOT NULL,
    confidence TEXT NOT NULL,
    reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
    evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
    raw_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.decision_audit_logs ENABLE ROW LEVEL SECURITY;

-- Allow select for authenticated parents or connected practitioners of the child
CREATE POLICY "Users associated with the child can view decision logs"
ON public.decision_audit_logs
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.children c
        WHERE c.id = child_id
        AND (c.parent_id = auth.uid() OR EXISTS (
            SELECT 1 FROM public.practitioner_children pc
            WHERE pc.child_id = c.id AND pc.practitioner_id = auth.uid()
        ))
    )
);
