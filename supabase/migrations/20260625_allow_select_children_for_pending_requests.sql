-- ============================================================
-- Migration: Allow select on children for pending connection requests
-- Allows practitioners and parents to view child details (first_name, last_name, etc.)
-- for pending connection requests before they are approved/rejected.
-- ============================================================

DROP POLICY IF EXISTS "children_pending_request_select" ON public.children;

CREATE POLICY "children_pending_request_select"
  ON public.children FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.connection_requests
      WHERE (practitioner_id = auth.uid() OR parent_id = auth.uid())
        AND child_id = public.children.id
        AND status = 'pending'
    )
  );
