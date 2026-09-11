-- ============================================================================
-- Touch-mode upper-body (MediaPipe Pose) recording
-- ----------------------------------------------------------------------------
-- One row per game session, following the shape raw_hand_tracking already
-- established rather than introducing a second convention for the same kind of
-- data.
--
-- `frames` holds the whole recording in the compact self-describing format
-- written by hooks/useUpperBodyTracking.js:
--     { schema, sampleHz, landmarks: [...indices], fields: [x,y,z,visibility],
--       frames: [[tMs, x0,y0,z0,v0, x1,...], ...] }
-- At 15Hz a ten-minute round is roughly 9,000 rows of 85 numbers — a few MB,
-- which Postgres stores out-of-line via TOAST without trouble.
--
-- `features` and `indicators` hold what was DERIVED from those frames, so a
-- later model can be compared against what v1 concluded from the same input.
-- `model_version` records which indicator model produced them; without it, a
-- mixed dataset becomes uninterpretable the day the model is refitted.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.raw_pose_tracking (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      UUID NOT NULL,
    child_id        UUID NOT NULL,
    game_id         TEXT,
    schema_version  TEXT NOT NULL,
    model_version   TEXT,
    sample_hz       INTEGER,
    frame_count     INTEGER,
    duration_ms     INTEGER,
    -- Which consent wording this recording was gathered under. An ethics review
    -- asks this first, and it cannot be reconstructed after the fact.
    consent         JSONB,
    frames          JSONB NOT NULL,
    features        JSONB,
    indicators      JSONB,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pose_child   ON public.raw_pose_tracking(child_id);
CREATE INDEX IF NOT EXISTS idx_pose_session ON public.raw_pose_tracking(session_id);
CREATE INDEX IF NOT EXISTS idx_pose_game    ON public.raw_pose_tracking(game_id);

ALTER TABLE public.raw_pose_tracking ENABLE ROW LEVEL SECURITY;

-- Insert: a signed-in learner records their own session.
CREATE POLICY "Authenticated users can insert pose tracking"
    ON public.raw_pose_tracking FOR INSERT TO authenticated WITH CHECK (true);

-- Read: parents of the child, practitioners linked to the child, and admins.
-- Deliberately NOT the blanket `USING (true)` that raw_hand_tracking uses —
-- that policy lets any signed-in account read every child's raw tracking, and
-- this table should not repeat it.
CREATE POLICY "Parents read their own child's pose data"
    ON public.raw_pose_tracking FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.children c
        WHERE c.id = raw_pose_tracking.child_id AND c.parent_id = auth.uid()
    ));

CREATE POLICY "Linked practitioners read pose data"
    ON public.raw_pose_tracking FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.practitioner_children pc
        WHERE pc.child_id = raw_pose_tracking.child_id
          AND pc.practitioner_id = auth.uid()
    ));

CREATE POLICY "Admins read all pose data"
    ON public.raw_pose_tracking FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = auth.uid() AND u.role = 'admin'
    ));

COMMENT ON TABLE public.raw_pose_tracking IS
    'Upper-body MediaPipe Pose recordings from touch-mode sessions, gathered '
    'under per-session consent. Research data: indicators derived from it are '
    'provisional and are not clinical findings.';
