-- ═══════════════════════════════════════════════════════════════════════════
-- Backfill: accuracy_score units, and a real LPI for summary-only sessions
--
-- Two historical problems, both of them data rather than code (the app itself
-- is fixed going forward):
--
--   1. `accuracy_score` is meant to hold a 0-1 fraction, but some rows hold a
--      0-100 percentage. The dashboards multiplied by 100 to display it, which
--      is where "6900%" came from. Those rows are divided by 100 here.
--
--   2. `lpi_score` was hard-coded to 85 for every session that posts a summary
--      instead of raw gestures — that is every game except Letter Quest. This
--      recomputes it from the metrics the games already stored in `notes`,
--      using the same four components and weights as the application:
--        accuracy 40% · speed 25% · smoothness 20% · motor control 15%
--      Components a given game never measured are dropped and the remaining
--      weights renormalised, so a game that reports three of the four is not
--      punished for the missing one.
--
-- Safe to run more than once: step 1 only touches rows still above 1, step 2
-- only rows still sitting at exactly 85.
--
-- Run it in the Supabase SQL editor. Read the two verification queries at the
-- bottom FIRST if you want to see what it will change before committing.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Helper: bring a metric onto 0-1 whatever scale the game wrote it in ────
-- Games disagree: some store smoothness as 0.93, others as 93. A value above 1
-- can only be a percentage; 1 itself means 100% either way.
CREATE OR REPLACE FUNCTION pg_temp.nesture_unit(v numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
           WHEN v IS NULL OR v < 0 THEN NULL
           WHEN v > 1 THEN LEAST(1, v / 100)
           ELSE v
         END;
$$;

-- ── Step 1 — accuracy_score stored as a percentage ────────────────────────
-- NB: in SQL every expression on the right of SET reads the row's OLD values,
-- so `accuracy = ROUND(accuracy_score)` deliberately takes the pre-division
-- number (69 -> 0.69 and 69%). It is not a missing "* 100".
UPDATE public.sessions
SET accuracy_score = accuracy_score / 100,
    accuracy       = ROUND(accuracy_score)          -- integer column, 0-100
WHERE accuracy_score IS NOT NULL
  AND accuracy_score > 1;

-- Keep the integer mirror consistent for every finished row, including the
-- ones that were already correct.
UPDATE public.sessions
SET accuracy = ROUND(accuracy_score * 100)
WHERE accuracy_score IS NOT NULL
  AND accuracy_score <= 1
  AND (accuracy IS DISTINCT FROM ROUND(accuracy_score * 100));

-- ── Step 2 — recompute the placeholder LPI ────────────────────────────────
WITH parsed AS (
  SELECT
    s.id,
    s.accuracy_score,
    -- `notes` is a JSON string written by the games; anything else is ignored.
    CASE
      WHEN s.notes IS NOT NULL AND LEFT(BTRIM(s.notes), 1) = '{'
      THEN s.notes::jsonb
      ELSE '{}'::jsonb
    END AS n
  FROM public.sessions s
  WHERE s.end_time IS NOT NULL
    AND s.lpi_score = 85          -- the placeholder, and only the placeholder
    -- Letter Quest goes through the aiEngine and computes a real LPI, which
    -- could legitimately land on 85. Only the summary-posting games are
    -- touched here.
    AND s.game_name IN (
      'Follow the Ladybug', 'Pop the Bubble', 'Pinch the Coin',
      'Trace Find Type', 'Magic Finger Copy'
    )
),
components AS (
  SELECT
    id,
    -- Accuracy: the session's own score, always present.
    pg_temp.nesture_unit(accuracy_score) AS acc,

    -- Speed: the game's own score, else derived from response time. 10 s is
    -- where the component reaches zero, matching the application's scale.
    COALESCE(
      pg_temp.nesture_unit(NULLIF(n->>'speedScore', '')::numeric),
      CASE
        WHEN NULLIF(n->>'reactionTimeMs', '')::numeric > 0
          THEN GREATEST(0, 1 - (n->>'reactionTimeMs')::numeric / 10000)
        WHEN NULLIF(n->>'reactionMs', '')::numeric > 0
          THEN GREATEST(0, 1 - (n->>'reactionMs')::numeric / 10000)
        WHEN NULLIF(n->>'pinchOnsetMs', '')::numeric > 0
          THEN GREATEST(0, 1 - (n->>'pinchOnsetMs')::numeric / 10000)
      END
    ) AS spd,

    -- Movement quality.
    COALESCE(
      pg_temp.nesture_unit(NULLIF(n->>'trajectorySmoothness', '')::numeric),
      pg_temp.nesture_unit(NULLIF(n->>'smoothness', '')::numeric)
    ) AS smo,

    -- Motor control, under whichever name the game measured it.
    COALESCE(
      pg_temp.nesture_unit(NULLIF(n->>'gripScore', '')::numeric),
      pg_temp.nesture_unit(NULLIF(n->>'pinchStability', '')::numeric),
      pg_temp.nesture_unit(NULLIF(n->>'stability', '')::numeric),
      pg_temp.nesture_unit(NULLIF(n->>'consistency', '')::numeric),
      pg_temp.nesture_unit(NULLIF(n->>'pathEfficiency', '')::numeric)
    ) AS ctl
  FROM parsed
),
scored AS (
  SELECT
    id,
    -- Weighted sum over the components that exist, divided by the weight that
    -- was actually used. This is the renormalisation.
    ROUND(
      100 * (
        COALESCE(acc, 0) * 0.40 + COALESCE(spd, 0) * 0.25 +
        COALESCE(smo, 0) * 0.20 + COALESCE(ctl, 0) * 0.15
      ) / NULLIF(
        (CASE WHEN acc IS NULL THEN 0 ELSE 0.40 END) +
        (CASE WHEN spd IS NULL THEN 0 ELSE 0.25 END) +
        (CASE WHEN smo IS NULL THEN 0 ELSE 0.20 END) +
        (CASE WHEN ctl IS NULL THEN 0 ELSE 0.15 END), 0)
    ) AS lpi
  FROM components
)
UPDATE public.sessions s
SET lpi_score = LEAST(100, GREATEST(0, scored.lpi))
FROM scored
WHERE s.id = scored.id
  AND scored.lpi IS NOT NULL;

-- Sessions that stored nothing usable keep no placeholder: an empty LPI is
-- information, a fake 85 is not. The dashboards render these as "—".
UPDATE public.sessions
SET lpi_score = NULL
WHERE end_time IS NOT NULL
  AND lpi_score = 85
  AND game_name IN (
    'Follow the Ladybug', 'Pop the Bubble', 'Pinch the Coin',
    'Trace Find Type', 'Magic Finger Copy'
  );

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- Verification — run these after the migration
-- ═══════════════════════════════════════════════════════════════════════════

-- No accuracy_score should be above 1 any more.
-- SELECT count(*) AS still_broken FROM public.sessions WHERE accuracy_score > 1;

-- LPI should now vary by game instead of being 85 everywhere.
-- SELECT game_name,
--        count(*)                       AS sessions,
--        round(avg(lpi_score))          AS avg_lpi,
--        min(lpi_score)                 AS min_lpi,
--        max(lpi_score)                 AS max_lpi,
--        count(*) FILTER (WHERE lpi_score IS NULL) AS no_metrics
-- FROM public.sessions
-- WHERE end_time IS NOT NULL
-- GROUP BY game_name
-- ORDER BY sessions DESC;
