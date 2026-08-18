-- ============================================================
-- NestureAI — Seed données de démo (VERSION CORRIGÉE)
-- Colonnes exactes du schéma init.sql
-- ============================================================

-- ── 1. Mettre à jour les 4 enfants avec détails ───────────────

UPDATE public.children SET
  age = 8,
  diagnosis = 'ASD — High support needs, limited verbal output',
  letterquest_level = 'easy',
  completeness_percentage = 28
WHERE first_name = 'Lily'
  AND parent_id IN (SELECT id FROM public.users WHERE id IN (
    SELECT id FROM auth.users WHERE email = 'jennifer@example.com'));

UPDATE public.children SET
  age = 12,
  diagnosis = 'ASD — Moderate support needs, emerging AAC user',
  letterquest_level = 'medium',
  completeness_percentage = 72
WHERE first_name = 'Marcus'
  AND parent_id IN (SELECT id FROM public.users WHERE id IN (
    SELECT id FROM auth.users WHERE email = 'jennifer@example.com'));

UPDATE public.children SET
  age = 10,
  diagnosis = 'ASD — Sensory processing difficulties, motor coordination challenges',
  letterquest_level = 'medium',
  completeness_percentage = 60
WHERE first_name = 'Alex'
  AND parent_id IN (SELECT id FROM public.users WHERE id IN (
    SELECT id FROM auth.users WHERE email = 'jennifer@example.com'));

-- ── 2. Sessions LetterQuest pour Akhil ────────────────────────
-- difficulty_mode: 'Easy' | 'Medium' | 'Complex - Words' | 'Complex - Sentences'
-- keyboard_size:   'Big keys' | 'Medium keys' | 'Standard keys'

INSERT INTO public.sessions (
  id, child_id, session_date,
  difficulty_mode, keyboard_size,
  accuracy, words_completed, average_response_time_ms
) VALUES
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000002',
   NOW() - INTERVAL '30 days',
   'Medium', 'Big keys', 73, 8, 4200),

  (gen_random_uuid(), '00000000-0000-0000-0000-000000000002',
   NOW() - INTERVAL '27 days',
   'Medium', 'Big keys', 75, 10, 3900),

  (gen_random_uuid(), '00000000-0000-0000-0000-000000000002',
   NOW() - INTERVAL '24 days',
   'Medium', 'Medium keys', 78, 12, 3700),

  (gen_random_uuid(), '00000000-0000-0000-0000-000000000002',
   NOW() - INTERVAL '21 days',
   'Complex - Words', 'Medium keys', 80, 14, 3500),

  (gen_random_uuid(), '00000000-0000-0000-0000-000000000002',
   NOW() - INTERVAL '18 days',
   'Complex - Words', 'Medium keys', 83, 16, 3300),

  (gen_random_uuid(), '00000000-0000-0000-0000-000000000002',
   NOW() - INTERVAL '14 days',
   'Complex - Words', 'Medium keys', 84, 18, 3100),

  (gen_random_uuid(), '00000000-0000-0000-0000-000000000002',
   NOW() - INTERVAL '10 days',
   'Complex - Sentences', 'Standard keys', 87, 20, 2900),

  (gen_random_uuid(), '00000000-0000-0000-0000-000000000002',
   NOW() - INTERVAL '7 days',
   'Complex - Sentences', 'Standard keys', 88, 22, 2750),

  (gen_random_uuid(), '00000000-0000-0000-0000-000000000002',
   NOW() - INTERVAL '4 days',
   'Complex - Sentences', 'Standard keys', 90, 23, 2600),

  (gen_random_uuid(), '00000000-0000-0000-0000-000000000002',
   NOW() - INTERVAL '2 days',
   'Complex - Sentences', 'Standard keys', 91, 24, 2450)

ON CONFLICT DO NOTHING;

-- ── 3. Documents & Atlas pour Marcus ─────────────────────────
DO $$
DECLARE
  marcus_id UUID;
BEGIN
  SELECT c.id INTO marcus_id
  FROM public.children c
  JOIN auth.users au ON au.id = c.parent_id
  WHERE au.email = 'jennifer@example.com' AND c.first_name = 'Marcus';

  IF marcus_id IS NOT NULL THEN
    -- Documents (file_type doit être un doc_type enum, file_path requis)
    INSERT INTO public.documents (id, child_id, file_name, file_path, file_type, status)
    VALUES
      (gen_random_uuid(), marcus_id, 'IEP_Marcus_2024.pdf',     'demo/IEP_Marcus_2024.pdf',     'IEP',          'definitive'),
      (gen_random_uuid(), marcus_id, 'SpeechEval_Marcus_2023.pdf', 'demo/SpeechEval_Marcus_2023.pdf', 'Speech_Language', 'definitive'),
      (gen_random_uuid(), marcus_id, 'OT_Report_Marcus_2025.pdf',  'demo/OT_Report_Marcus_2025.pdf',  'OT_Evaluation', 'processing')
    ON CONFLICT DO NOTHING;

    -- Profil Atlas
    INSERT INTO public.atlas_profiles (
      id, child_id, completeness_percentage,
      strengths, challenges, functional_wellness, calibration_parameters
    ) VALUES (
      gen_random_uuid(), marcus_id, 72,
      '[
        {"label": "Strong visual memory for letters and symbols", "source": "IEP_Marcus_2024.pdf"},
        {"label": "Motivated by technology-based learning", "source": "OT_Report_Marcus_2025.pdf"},
        {"label": "Emerging AAC device use for basic communication", "source": "SpeechEval_Marcus_2023.pdf"}
      ]'::jsonb,
      '[
        {"label": "Sequential motor planning difficulties", "source": "OT_Report_Marcus_2025.pdf"},
        {"label": "Auditory processing delays in noisy environments", "source": "IEP_Marcus_2024.pdf"},
        {"label": "Fatigue management during extended practice sessions", "source": "OT_Report_Marcus_2025.pdf"}
      ]'::jsonb,
      '[
        {"title": "Sensory Regulation", "description": "Movement breaks every 15-20 min. Fidget tools support attention.", "confidence": "DEFINITIVE", "source": "OT_Report_Marcus_2025.pdf"},
        {"title": "Visual Processing", "description": "Colour coding and visual schedules improve task completion.", "confidence": "PROBABLE", "source": "IEP_Marcus_2024.pdf"},
        {"title": "Communication Support", "description": "Core vocabulary board recommended for LetterQuest sessions.", "confidence": "DEFINITIVE", "source": "SpeechEval_Marcus_2023.pdf"}
      ]'::jsonb,
      '{"key_size": "large", "dwell_time_ms": 2000, "break_interval_min": 15}'::jsonb
    ) ON CONFLICT (child_id) DO NOTHING;
  END IF;
END $$;

-- ── 4. Document pour Lily ─────────────────────────────────────
DO $$
DECLARE
  lily_id UUID;
BEGIN
  SELECT c.id INTO lily_id
  FROM public.children c
  JOIN auth.users au ON au.id = c.parent_id
  WHERE au.email = 'jennifer@example.com' AND c.first_name = 'Lily';

  IF lily_id IS NOT NULL THEN
    INSERT INTO public.documents (id, child_id, file_name, file_path, file_type, status)
    VALUES (gen_random_uuid(), lily_id, 'School_Letter_Lily_2025.pdf', 'demo/School_Letter_Lily_2025.pdf', 'School_Report', 'definitive')
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- ── Vérification ──────────────────────────────────────────────
SELECT 'Akhil sessions' AS check_name, count(*)::text AS result
FROM public.sessions WHERE child_id = '00000000-0000-0000-0000-000000000002'
UNION ALL
SELECT 'Total children', count(*)::text FROM public.children
UNION ALL
SELECT 'Atlas profiles', count(*)::text FROM public.atlas_profiles
UNION ALL
SELECT 'Total documents', count(*)::text FROM public.documents;
