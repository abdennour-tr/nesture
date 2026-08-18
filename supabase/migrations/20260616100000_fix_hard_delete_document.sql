-- Add file_path column to deletion_audit_logs if it doesn't exist
ALTER TABLE public.deletion_audit_logs ADD COLUMN IF NOT EXISTS file_path TEXT;

-- Migration: Fix public.hard_delete_document function
CREATE OR REPLACE FUNCTION public.hard_delete_document(p_document_id UUID, p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_child_id UUID;
    v_file_path TEXT;
    v_remaining_docs INT;
    v_exists BOOLEAN;
BEGIN
    -- Check if document exists at all
    SELECT EXISTS(SELECT 1 FROM public.documents WHERE id = p_document_id) INTO v_exists;
    
    IF NOT v_exists THEN
        -- Already deleted, return special string to indicate no database action is needed
        RETURN 'ALREADY_DELETED';
    END IF;

    -- Get the document details and verify parent/practitioner permissions
    SELECT d.child_id, d.file_path INTO v_child_id, v_file_path
    FROM public.documents d
    JOIN public.children c ON c.id = d.child_id
    WHERE d.id = p_document_id 
      AND (c.parent_id = p_user_id OR EXISTS (
          SELECT 1 FROM public.practitioner_children pc
          WHERE pc.child_id = c.id AND pc.practitioner_id = p_user_id
      ));

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Access denied';
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
    INSERT INTO public.deletion_audit_logs (report_id, child_id, deleted_by, cleanup_status, file_path)
    VALUES (p_document_id, v_child_id, p_user_id, 'PENDING', v_file_path);

    -- Return the file path so the edge function can delete it from storage
    RETURN v_file_path;
END;
$$;

-- Configure proper RLS policies for public.documents
DROP POLICY IF EXISTS "Users associated with the child can view documents" ON public.documents;
CREATE POLICY "Users associated with the child can view documents"
ON public.documents
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

DROP POLICY IF EXISTS "Users associated with the child can insert documents" ON public.documents;
CREATE POLICY "Users associated with the child can insert documents"
ON public.documents
FOR INSERT
TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.children c
        WHERE c.id = child_id
        AND (c.parent_id = auth.uid() OR EXISTS (
            SELECT 1 FROM public.practitioner_children pc
            WHERE pc.child_id = c.id AND pc.practitioner_id = auth.uid()
        ))
    )
);

DROP POLICY IF EXISTS "Users associated with the child can delete documents" ON public.documents;
CREATE POLICY "Users associated with the child can delete documents"
ON public.documents
FOR DELETE
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
