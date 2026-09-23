-- ============================================================================
-- Make raw_hand_tracking rows attributable.
-- ----------------------------------------------------------------------------
-- The table stores only session_id, child_id, positions and created_at. Nothing
-- says which game a row came from, under what consent it was gathered, or what
-- the numbers in `positions` actually mean. The pose table carries all three
-- (game_id, consent, schema_version) and is analysable as a result; this brings
-- the hand table into line.
--
-- schema_version matters more than it looks. Existing rows were written by two
-- separate ad-hoc implementations that recorded the SMOOTHED CURSOR position,
-- with different stopping rules per game. New rows come from one shared hook
-- and record the INDEX FINGERTIP landmark. Those are different measurements and
-- must not be pooled: legacy rows keep schema_version NULL, new ones say
-- 'hand-v2'. Without this column the two silently mix and every comparison
-- across them is wrong.
-- ============================================================================

ALTER TABLE public.raw_hand_tracking
  ADD COLUMN IF NOT EXISTS game_id TEXT;

ALTER TABLE public.raw_hand_tracking
  ADD COLUMN IF NOT EXISTS schema_version TEXT;

ALTER TABLE public.raw_hand_tracking
  ADD COLUMN IF NOT EXISTS consent JSONB;

COMMENT ON COLUMN public.raw_hand_tracking.game_id IS
  'Which game produced this row (letterquest, bubble, ladybug, pinch-coin, '
  'trace-type, finger-copy, path-tracing). NULL on rows written before '
  'attribution existed.';

COMMENT ON COLUMN public.raw_hand_tracking.schema_version IS
  'What the numbers in `positions` mean. NULL = legacy rows: smoothed cursor '
  'position, captured by per-game code with inconsistent stopping rules. '
  '''hand-v2'' = index fingertip landmark, normalised 0..1, captured by the '
  'shared useHandCapture hook. Do not pool the two.';

COMMENT ON COLUMN public.raw_hand_tracking.consent IS
  'The basis this recording was gathered under, mirroring '
  'raw_pose_tracking.consent. NULL on rows predating consent recording.';

CREATE INDEX IF NOT EXISTS idx_hand_game ON public.raw_hand_tracking(game_id);

-- ── Verification ────────────────────────────────────────────────────────────
-- After applying, new sessions should produce rows with game_id set:
--
--   SELECT game_id, schema_version, count(*)
--     FROM public.raw_hand_tracking
--    GROUP BY 1, 2 ORDER BY 3 DESC;
--
-- Legacy rows appear as (NULL, NULL); anything recorded after the rollout
-- should name its game and say 'hand-v2'.
