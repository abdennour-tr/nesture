-- Add a unique connection code to children
ALTER TABLE public.children ADD COLUMN IF NOT EXISTS connection_code TEXT UNIQUE;

-- Create connection_requests table
CREATE TABLE IF NOT EXISTS public.connection_requests (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    practitioner_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    child_id UUID REFERENCES public.children(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE public.connection_requests ENABLE ROW LEVEL SECURITY;

-- Create policies for connection_requests
CREATE POLICY "Practitioners can view their own requests"
    ON public.connection_requests FOR SELECT
    USING (auth.uid() = practitioner_id);

CREATE POLICY "Practitioners can create requests"
    ON public.connection_requests FOR INSERT
    WITH CHECK (auth.uid() = practitioner_id);

CREATE POLICY "Parents can view requests sent to them"
    ON public.connection_requests FOR SELECT
    USING (auth.uid() = parent_id);

CREATE POLICY "Parents can update requests sent to them"
    ON public.connection_requests FOR UPDATE
    USING (auth.uid() = parent_id);

-- Create a function to handle connection request approval
CREATE OR REPLACE FUNCTION approve_connection_request(request_id UUID)
RETURNS void AS $$
DECLARE
    req RECORD;
BEGIN
    -- Get the request
    SELECT * INTO req FROM public.connection_requests WHERE id = request_id AND status = 'pending';
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Request not found or already processed';
    END IF;

    -- Update request status
    UPDATE public.connection_requests SET status = 'approved', updated_at = now() WHERE id = request_id;

    -- Insert into practitioner_children
    INSERT INTO public.practitioner_children (practitioner_id, child_id)
    VALUES (req.practitioner_id, req.child_id)
    ON CONFLICT DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
