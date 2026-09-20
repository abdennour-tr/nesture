-- ============================================================================
-- Close the raw_hand_tracking read hole.
-- ----------------------------------------------------------------------------
-- 20260615164700_create_raw_tracking.sql shipped this policy:
--
--     CREATE POLICY "Users can view raw tracking data"
--       ON public.raw_hand_tracking FOR SELECT TO authenticated USING (true);
--
-- USING (true) means *any* signed-in account — every parent, every specialist,
-- every learner, and anyone who registers — can read every child's raw hand
-- tracking rows. That is per-frame movement data for other people's children.
--
-- It also contradicts what we tell parents at signup: that profile data is not
-- shared, and that only specialists they explicitly link can see their child's
-- information.
--
-- The fix is not new policy design. 20260910_pose_tracking.sql already wrote the
-- correct policies for raw_pose_tracking and explicitly declined to copy this
-- blanket rule. This migration brings raw_hand_tracking into line with its
-- sibling table, so the two behave identically.
--
-- Scope note: INSERT is deliberately left as WITH CHECK (true), matching
-- raw_pose_tracking. The game writes these rows during a session and tightening
-- the write path without tracing every caller risks silently dropping session
-- data. The read hole is the disclosure risk and is fixed here; the write path
-- should be tightened separately, with the game flow under test.
-- ============================================================================

-- Remove the blanket read.
DROP POLICY IF EXISTS "Users can view raw tracking data" ON public.raw_hand_tracking;

-- Defensive: drop the new names too, so this migration is safely re-runnable.
DROP POLICY IF EXISTS "Parents read their own child's hand data" ON public.raw_hand_tracking;
DROP POLICY IF EXISTS "Linked practitioners read hand data"      ON public.raw_hand_tracking;
DROP POLICY IF EXISTS "Admins read all hand data"                ON public.raw_hand_tracking;

-- A parent may read tracking rows for a child that belongs to them.
CREATE POLICY "Parents read their own child's hand data"
    ON public.raw_hand_tracking FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.children c
        WHERE c.id = raw_hand_tracking.child_id
          AND c.parent_id = auth.uid()
    ));

-- A specialist may read only for children they have been explicitly linked to.
CREATE POLICY "Linked practitioners read hand data"
    ON public.raw_hand_tracking FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.practitioner_children pc
        WHERE pc.child_id = raw_hand_tracking.child_id
          AND pc.practitioner_id = auth.uid()
    ));

-- Admins keep full read access; AdminDashboard's session export depends on it.
CREATE POLICY "Admins read all hand data"
    ON public.raw_hand_tracking FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = auth.uid()
          AND u.role = 'admin'
    ));

COMMENT ON TABLE public.raw_hand_tracking IS
    'Per-frame hand landmark coordinates captured during game sessions. '
    'Readable only by the child''s parent, explicitly linked specialists, and '
    'admins. Not de-identified: rows are keyed to child_id.';

-- ── Verification ────────────────────────────────────────────────────────────
-- After applying, confirm the blanket policy is gone and three remain:
--
--   SELECT policyname, cmd, qual
--   FROM pg_policies
--   WHERE tablename = 'raw_hand_tracking'
--   ORDER BY cmd, policyname;
--
-- Expect one INSERT policy and exactly three SELECT policies, none with a
-- qual of "true".
