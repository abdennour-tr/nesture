-- Create the deletion audit log table
CREATE TABLE IF NOT EXISTS public.deletion_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id UUID NOT NULL,
    child_id UUID NOT NULL,
    deleted_by UUID NOT NULL,
    deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    cleanup_status TEXT NOT NULL DEFAULT 'PENDING'
);

-- Enable RLS for the audit logs
ALTER TABLE public.deletion_audit_logs ENABLE ROW LEVEL SECURITY;

-- Allow users to insert logs and view their own logs
CREATE POLICY "Users can insert their own deletion logs" 
ON public.deletion_audit_logs 
FOR INSERT 
TO authenticated 
WITH CHECK (auth.uid() = deleted_by);

CREATE POLICY "Users can view their own deletion logs" 
ON public.deletion_audit_logs 
FOR SELECT 
TO authenticated 
USING (auth.uid() = deleted_by);

-- Create the RPC for transactionally deleting a document and related records
CREATE OR REPLACE FUNCTION public.hard_delete_document(p_document_id UUID, p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_child_id UUID;
    v_file_path TEXT;
    v_remaining_docs INT;
BEGIN
    -- Get the document details
    SELECT child_id, file_path INTO v_child_id, v_file_path
    FROM public.documents
    WHERE id = p_document_id AND parent_id = p_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Document not found or access denied';
    END IF;

    -- Delete the document
    DELETE FROM public.documents WHERE id = p_document_id;

    -- Check if any other documents exist for this child
    SELECT COUNT(*) INTO v_remaining_docs
    FROM public.documents
    WHERE child_id = v_child_id;

    -- Delete the atlas profile to prevent ghost data
    -- If documents remain, the background re-analysis will rebuild it
    -- If no documents remain, it stays deleted
    DELETE FROM public.atlas_profiles WHERE child_id = v_child_id;

    -- Log the deletion
    INSERT INTO public.deletion_audit_logs (report_id, child_id, deleted_by, cleanup_status)
    VALUES (p_document_id, v_child_id, p_user_id, 'PENDING');

    -- Return the file path so the edge function can delete it from storage
    RETURN v_file_path;
END;
$$;
