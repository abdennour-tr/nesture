-- Fix RLS policies for connection_requests to allow both directions
-- Drop old restrictive policies
DROP POLICY IF EXISTS "Practitioners can create requests" ON public.connection_requests;
DROP POLICY IF EXISTS "Practitioners can view their own requests" ON public.connection_requests;
DROP POLICY IF EXISTS "Parents can view requests sent to them" ON public.connection_requests;
DROP POLICY IF EXISTS "Parents can update requests sent to them" ON public.connection_requests;

-- Allow any authenticated user to insert (both parent and practitioner can initiate)
CREATE POLICY "Authenticated users can create connection requests"
    ON public.connection_requests FOR INSERT
    WITH CHECK (auth.uid() = practitioner_id OR auth.uid() = parent_id);

-- Practitioners see requests they sent
CREATE POLICY "Practitioners can view their requests"
    ON public.connection_requests FOR SELECT
    USING (auth.uid() = practitioner_id);

-- Parents see requests sent to them
CREATE POLICY "Parents can view their requests"
    ON public.connection_requests FOR SELECT
    USING (auth.uid() = parent_id);

-- Both sides can update status (approve/reject)
CREATE POLICY "Involved parties can update request status"
    ON public.connection_requests FOR UPDATE
    USING (auth.uid() = parent_id OR auth.uid() = practitioner_id);

-- Also ensure connection_code column exists on children (in case previous migration didn't run)
ALTER TABLE public.children ADD COLUMN IF NOT EXISTS connection_code TEXT UNIQUE;

-- Ensure practitioner_children table exists
CREATE TABLE IF NOT EXISTS public.practitioner_children (
    practitioner_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    child_id UUID REFERENCES public.children(id) ON DELETE CASCADE,
    granted_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    PRIMARY KEY (practitioner_id, child_id)
);

ALTER TABLE public.practitioner_children ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Practitioners can view their learners" ON public.practitioner_children;
CREATE POLICY "Practitioners can view their learners"
    ON public.practitioner_children FOR SELECT
    USING (auth.uid() = practitioner_id);

DROP POLICY IF EXISTS "Parents can view who accesses their child" ON public.practitioner_children;
CREATE POLICY "Parents can view who accesses their child"
    ON public.practitioner_children FOR SELECT
    USING (
        auth.uid() IN (
            SELECT parent_id FROM public.children WHERE id = child_id
        )
    );

DROP POLICY IF EXISTS "Parents can delete practitioner access" ON public.practitioner_children;
CREATE POLICY "Parents can delete practitioner access"
    ON public.practitioner_children FOR DELETE
    USING (
        auth.uid() IN (
            SELECT parent_id FROM public.children WHERE id = child_id
        )
    );
