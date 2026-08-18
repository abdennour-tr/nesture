-- ============================================================
-- NestureAI — Seed Complet (Données démo dans Supabase)
-- À exécuter APRÈS migration_v2.sql
-- ============================================================

-- ── 1. Exercices ─────────────────────────────────────────────
INSERT INTO public.exercises (id, name, target_reflex, description, duration_minutes, video_url, difficulty_level) VALUES
('ex-001','Starfish Stretch','Moro','Lie flat, spread arms and legs wide. Hold 10 seconds. Repeat 5 times.','5','/videos/starfish-stretch.mp4','easy'),
('ex-002','Deep Pressure Massage','Moro','Apply firm pressure to shoulders and arms. Use a weighted blanket.','10','/videos/deep-pressure.mp4','easy'),
('ex-003','Slow Swinging','Moro','Sit in a hammock swing. Sway side to side slowly for 5 minutes.','5','/videos/slow-swinging.mp4','easy'),
('ex-004','Cross-Crawl Patterns','ATNR','Touch right hand to left knee alternately while marching in place.','5','/videos/cross-crawl.mp4','medium'),
('ex-005','Bilateral Clapping','ATNR','Clap hands at midline, then clap each hand to opposite shoulder.','3','/videos/bilateral-clapping.mp4','easy'),
('ex-006','Angels in Snow','ATNR','Lie on floor, move arms and legs simultaneously like a snow angel.','5','/videos/angels-snow.mp4','medium'),
('ex-007','Cat-Cow Yoga','STNR','On hands and knees, alternate between arching and rounding the back.','5','/videos/cat-cow.mp4','easy'),
('ex-008','Tabletop Rocking','STNR','In tabletop position, rock forward and backward slowly.','5','/videos/tabletop-rocking.mp4','easy'),
('ex-009','Head Lifts (Prone)','TLR','Lie on tummy, lift head slowly keeping chin tucked. Hold 5 seconds.','5','/videos/head-lifts-prone.mp4','medium'),
('ex-010','Superman Pose','TLR','Lie on tummy, extend arms and legs. Lift all four off the ground.','3','/videos/superman-pose.mp4','medium'),
('ex-011','Snow Angel Movements','Spinal Galant','Stand and make snow angel arm movements, focusing on trunk rotation.','5','/videos/snow-angel.mp4','easy'),
('ex-012','Side-Lying Trunk Flexion','Spinal Galant','Lie on side, curl knees toward chest. Hold 8 seconds, switch sides.','5','/videos/trunk-flexion.mp4','medium'),
('ex-013','Finger Opposition','Palmar Grasp','Touch each finger to thumb in sequence, forward and backward.','3','/videos/finger-opposition.mp4','easy'),
('ex-014','Playdough Manipulation','Palmar Grasp','Roll, pinch, and shape playdough. Focus on pincer grip and finger isolation.','10','/videos/playdough.mp4','easy'),
('ex-015','Tweezers Pick-up','Palmar Grasp','Use tweezers to pick up small objects (beads, pom-poms) into a cup.','5','/videos/tweezers.mp4','medium')
ON CONFLICT (id) DO NOTHING;

-- ── 2. Enfants de Jennifer ────────────────────────────────────
-- Akhil
INSERT INTO public.children (id, parent_id, auth_user_id, first_name, last_name, age, diagnosis, letterquest_level, completeness_percentage, avatar_color)
SELECT '00000000-0000-0000-0000-000000000010'::UUID, j.id, a.id, 'Akhil', 'M.', 22, 'ASD, CAPD, Mitochondrial Disease, Generalised Dyspraxia', 'medium', 85, '#10b981'
FROM auth.users j, auth.users a WHERE j.email = 'jennifer@example.com' AND a.email = 'akhil@example.com'
ON CONFLICT (id) DO UPDATE SET auth_user_id = EXCLUDED.auth_user_id, letterquest_level = EXCLUDED.letterquest_level, completeness_percentage = EXCLUDED.completeness_percentage;

-- Lily
INSERT INTO public.children (id, parent_id, first_name, last_name, age, diagnosis, letterquest_level, completeness_percentage, avatar_color)
SELECT '00000000-0000-0000-0000-000000000011'::UUID, j.id, 'Lily', 'Chen', 8, 'ASD — High support needs, limited verbal output', 'easy', 28, '#F472B6'
FROM auth.users j WHERE j.email = 'jennifer@example.com' ON CONFLICT (id) DO UPDATE SET letterquest_level = EXCLUDED.letterquest_level;

-- Marcus
INSERT INTO public.children (id, parent_id, first_name, last_name, age, diagnosis, letterquest_level, completeness_percentage, avatar_color)
SELECT '00000000-0000-0000-0000-000000000012'::UUID, j.id, 'Marcus', 'Chen', 12, 'ASD — Moderate support needs, emerging AAC user', 'medium', 72, '#6366F1'
FROM auth.users j WHERE j.email = 'jennifer@example.com' ON CONFLICT (id) DO UPDATE SET letterquest_level = EXCLUDED.letterquest_level;

-- Alex
INSERT INTO public.children (id, parent_id, first_name, last_name, age, diagnosis, letterquest_level, completeness_percentage, avatar_color)
SELECT '00000000-0000-0000-0000-000000000013'::UUID, j.id, 'Alex', 'Chen', 10, 'ASD — Sensory processing difficulties, motor coordination challenges', 'medium', 60, '#F59E0B'
FROM auth.users j WHERE j.email = 'jennifer@example.com' ON CONFLICT (id) DO UPDATE SET letterquest_level = EXCLUDED.letterquest_level;

-- Lier Sarah (OT) à tous les enfants de Jennifer
UPDATE public.children SET ot_id = (SELECT id FROM auth.users WHERE email = 'sarah@example.com') WHERE id IN ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000013');

-- ── 3. Sessions pour Akhil (10 sessions, progression médium→complex) ──────────
INSERT INTO public.sessions (id, learner_id, start_time, end_time, duration_seconds, difficulty, accuracy_score, avg_response_time_ms, trajectory_smoothness, fatigue_index, midline_crossings, lpi_score, total_attempts, perfect_grabs, failed_grabs, skipped, scenario, session_date, difficulty_mode, keyboard_size, accuracy, words_completed, sentences_completed, average_response_time_ms)
VALUES
  ('00000000-0000-0000-0001-000000000001','00000000-0000-0000-0000-000000000010', NOW()-'30 days'::interval, NOW()-'30 days'::interval+'25 min'::interval, 1500,'medium',0.625,4200,0.580,0.300,8,52,40,25,12,3,'happy_path', NOW()-'30 days'::interval, 'Medium', 'Medium keys', 63, 5, 0, 4200),
  ('00000000-0000-0000-0001-000000000002','00000000-0000-0000-0000-000000000010', NOW()-'27 days'::interval, NOW()-'27 days'::interval+'27 min'::interval, 1620,'medium',0.650,4000,0.610,0.280,9,55,41,26,11,4,'happy_path', NOW()-'27 days'::interval, 'Medium', 'Medium keys', 65, 5, 0, 4000),
  ('00000000-0000-0000-0001-000000000003','00000000-0000-0000-0000-000000000010', NOW()-'24 days'::interval, NOW()-'24 days'::interval+'28 min'::interval, 1680,'medium',0.680,3800,0.640,0.260,10,58,43,29,11,3,'happy_path', NOW()-'24 days'::interval, 'Medium', 'Medium keys', 68, 5, 0, 3800),
  ('00000000-0000-0000-0001-000000000004','00000000-0000-0000-0000-000000000010', NOW()-'21 days'::interval, NOW()-'21 days'::interval+'30 min'::interval, 1800,'medium',0.700,3600,0.670,0.240,11,61,44,30,11,3,'happy_path', NOW()-'21 days'::interval, 'Medium', 'Medium keys', 70, 5, 0, 3600),
  ('00000000-0000-0000-0001-000000000005','00000000-0000-0000-0000-000000000010', NOW()-'18 days'::interval, NOW()-'18 days'::interval+'32 min'::interval, 1920,'medium',0.725,3400,0.700,0.220,12,65,45,32,10,3,'happy_path', NOW()-'18 days'::interval, 'Medium', 'Medium keys', 73, 5, 0, 3400),
  ('00000000-0000-0000-0001-000000000006','00000000-0000-0000-0000-000000000010', NOW()-'14 days'::interval, NOW()-'14 days'::interval+'34 min'::interval, 2040,'medium',0.750,3200,0.730,0.200,13,68,46,34,9,3,'happy_path', NOW()-'14 days'::interval, 'Medium', 'Medium keys', 75, 5, 0, 3200),
  ('00000000-0000-0000-0001-000000000007','00000000-0000-0000-0000-000000000010', NOW()-'10 days'::interval, NOW()-'10 days'::interval+'36 min'::interval, 2160,'hard',0.780,3000,0.760,0.180,14,72,47,36,8,3,'happy_path', NOW()-'10 days'::interval, 'Complex - Words', 'Medium keys', 78, 5, 0, 3000),
  ('00000000-0000-0000-0001-000000000008','00000000-0000-0000-0000-000000000010', NOW()-'7 days'::interval,  NOW()-'7 days'::interval+'38 min'::interval,  2280,'hard',0.800,2800,0.790,0.160,15,76,48,38,7,3,'happy_path', NOW()-'7 days'::interval, 'Complex - Words', 'Medium keys', 80, 5, 0, 2800),
  ('00000000-0000-0000-0001-000000000009','00000000-0000-0000-0000-000000000010', NOW()-'4 days'::interval,  NOW()-'4 days'::interval+'40 min'::interval,  2400,'hard',0.830,2600,0.820,0.140,16,80,50,41,7,2,'happy_path', NOW()-'4 days'::interval, 'Complex - Words', 'Medium keys', 83, 5, 0, 2600),
  ('00000000-0000-0000-0001-000000000010','00000000-0000-0000-0000-000000000010', NOW()-'2 days'::interval,  NOW()-'2 days'::interval+'42 min'::interval,  2520,'hard',0.840,2500,0.850,0.120,17,84,51,42,6,3,'happy_path', NOW()-'2 days'::interval, 'Complex - Words', 'Medium keys', 84, 5, 0, 2500)
ON CONFLICT (id) DO NOTHING;

-- Sessions pour Lily (6 sessions, niveau easy, progression lente)
INSERT INTO public.sessions (id, learner_id, start_time, end_time, duration_seconds, difficulty, accuracy_score, avg_response_time_ms, trajectory_smoothness, fatigue_index, midline_crossings, lpi_score, total_attempts, perfect_grabs, failed_grabs, skipped, scenario, session_date, difficulty_mode, keyboard_size, accuracy, words_completed, sentences_completed, average_response_time_ms)
VALUES
  ('00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000011', NOW()-'24 days'::interval, NOW()-'24 days'::interval+'14 min'::interval, 840,'easy',0.420,6800,0.400,0.650,4,36,34,14,16,4,'easy_path', NOW()-'24 days'::interval, 'Easy', 'Medium keys', 42, 5, 0, 6800),
  ('00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000011', NOW()-'20 days'::interval, NOW()-'20 days'::interval+'16 min'::interval, 960,'easy',0.450,6500,0.430,0.620,5,39,33,15,14,4,'easy_path', NOW()-'20 days'::interval, 'Easy', 'Medium keys', 45, 5, 0, 6500),
  ('00000000-0000-0000-0002-000000000003','00000000-0000-0000-0000-000000000011', NOW()-'16 days'::interval, NOW()-'16 days'::interval+'18 min'::interval,1080,'easy',0.480,6200,0.460,0.600,5,42,33,16,13,4,'easy_path', NOW()-'16 days'::interval, 'Easy', 'Medium keys', 48, 5, 0, 6200),
  ('00000000-0000-0000-0002-000000000004','00000000-0000-0000-0000-000000000011', NOW()-'12 days'::interval, NOW()-'12 days'::interval+'20 min'::interval,1200,'easy',0.500,5900,0.490,0.570,6,45,32,16,12,4,'easy_path', NOW()-'12 days'::interval, 'Easy', 'Medium keys', 50, 5, 0, 5900),
  ('00000000-0000-0000-0002-000000000005','00000000-0000-0000-0000-000000000011', NOW()-'8 days'::interval,  NOW()-'8 days'::interval+'20 min'::interval,  1200,'easy',0.530,5600,0.520,0.540,6,48,32,17,12,3,'easy_path', NOW()-'8 days'::interval, 'Easy', 'Medium keys', 53, 5, 0, 5600),
  ('00000000-0000-0000-0002-000000000006','00000000-0000-0000-0000-000000000011', NOW()-'4 days'::interval,  NOW()-'4 days'::interval+'22 min'::interval,  1320,'easy',0.550,5400,0.550,0.510,7,51,31,17,11,3,'easy_path', NOW()-'4 days'::interval, 'Easy', 'Medium keys', 55, 5, 0, 5400)
ON CONFLICT (id) DO NOTHING;

-- Sessions pour Marcus (8 sessions, niveau medium, bonne progression)
INSERT INTO public.sessions (id, learner_id, start_time, end_time, duration_seconds, difficulty, accuracy_score, avg_response_time_ms, trajectory_smoothness, fatigue_index, midline_crossings, lpi_score, total_attempts, perfect_grabs, failed_grabs, skipped, scenario, session_date, difficulty_mode, keyboard_size, accuracy, words_completed, sentences_completed, average_response_time_ms)
VALUES
  ('00000000-0000-0000-0003-000000000001','00000000-0000-0000-0000-000000000012', NOW()-'21 days'::interval, NOW()-'21 days'::interval+'14 min'::interval, 840,'medium',0.550,5200,0.520,0.500,6,48,40,22,15,3,'happy_path', NOW()-'21 days'::interval, 'Medium', 'Medium keys', 55, 5, 0, 5200),
  ('00000000-0000-0000-0003-000000000002','00000000-0000-0000-0000-000000000012', NOW()-'18 days'::interval, NOW()-'18 days'::interval+'16 min'::interval, 960,'medium',0.580,4900,0.550,0.460,7,52,40,23,14,3,'happy_path', NOW()-'18 days'::interval, 'Medium', 'Medium keys', 58, 5, 0, 4900),
  ('00000000-0000-0000-0003-000000000003','00000000-0000-0000-0000-000000000012', NOW()-'15 days'::interval, NOW()-'15 days'::interval+'18 min'::interval,1080,'medium',0.620,4600,0.590,0.420,8,56,39,24,12,3,'happy_path', NOW()-'15 days'::interval, 'Medium', 'Medium keys', 62, 5, 0, 4600),
  ('00000000-0000-0000-0003-000000000004','00000000-0000-0000-0000-000000000012', NOW()-'12 days'::interval, NOW()-'12 days'::interval+'20 min'::interval,1200,'medium',0.650,4300,0.620,0.380,9,60,40,26,11,3,'happy_path', NOW()-'12 days'::interval, 'Medium', 'Medium keys', 65, 5, 0, 4300),
  ('00000000-0000-0000-0003-000000000005','00000000-0000-0000-0000-000000000012', NOW()-'9 days'::interval,  NOW()-'9 days'::interval+'22 min'::interval,  1320,'medium',0.690,4000,0.660,0.340,10,64,39,27,9,3,'happy_path', NOW()-'9 days'::interval, 'Medium', 'Medium keys', 69, 5, 0, 4000),
  ('00000000-0000-0000-0003-000000000006','00000000-0000-0000-0000-000000000012', NOW()-'6 days'::interval,  NOW()-'6 days'::interval+'24 min'::interval,  1440,'medium',0.720,3700,0.690,0.300,11,68,40,29,9,2,'happy_path', NOW()-'6 days'::interval, 'Medium', 'Medium keys', 72, 5, 0, 3700),
  ('00000000-0000-0000-0003-000000000007','00000000-0000-0000-0000-000000000012', NOW()-'3 days'::interval,  NOW()-'3 days'::interval+'26 min'::interval,  1560,'medium',0.740,3500,0.720,0.270,12,71,40,30,8,2,'happy_path', NOW()-'3 days'::interval, 'Medium', 'Medium keys', 74, 5, 0, 3500),
  ('00000000-0000-0000-0003-000000000008','00000000-0000-0000-0000-000000000012', NOW()-'1 day'::interval,   NOW()-'1 day'::interval+'28 min'::interval,   1680,'medium',0.760,3300,0.740,0.240,13,74,39,30,7,2,'happy_path', NOW()-'1 day'::interval, 'Medium', 'Medium keys', 76, 5, 0, 3300)
ON CONFLICT (id) DO NOTHING;

-- Sessions pour Alex (7 sessions, niveau medium, défis sensoriels)
INSERT INTO public.sessions (id, learner_id, start_time, end_time, duration_seconds, difficulty, accuracy_score, avg_response_time_ms, trajectory_smoothness, fatigue_index, midline_crossings, lpi_score, total_attempts, perfect_grabs, failed_grabs, skipped, scenario, session_date, difficulty_mode, keyboard_size, accuracy, words_completed, sentences_completed, average_response_time_ms)
VALUES
  ('00000000-0000-0000-0004-000000000001','00000000-0000-0000-0000-000000000013', NOW()-'28 days'::interval, NOW()-'28 days'::interval+'14 min'::interval, 840,'medium',0.500,5800,0.470,0.580,5,43,36,18,15,3,'alternate_path', NOW()-'28 days'::interval, 'Medium', 'Medium keys', 50, 5, 0, 5800),
  ('00000000-0000-0000-0004-000000000002','00000000-0000-0000-0000-000000000013', NOW()-'24 days'::interval, NOW()-'24 days'::interval+'16 min'::interval, 960,'medium',0.530,5500,0.500,0.550,6,46,36,19,14,3,'alternate_path', NOW()-'24 days'::interval, 'Medium', 'Medium keys', 53, 5, 0, 5500),
  ('00000000-0000-0000-0004-000000000003','00000000-0000-0000-0000-000000000013', NOW()-'20 days'::interval, NOW()-'20 days'::interval+'18 min'::interval,1080,'medium',0.560,5200,0.530,0.520,6,50,37,21,14,2,'alternate_path', NOW()-'20 days'::interval, 'Medium', 'Medium keys', 56, 5, 0, 5200),
  ('00000000-0000-0000-0004-000000000004','00000000-0000-0000-0000-000000000013', NOW()-'16 days'::interval, NOW()-'16 days'::interval+'20 min'::interval,1200,'medium',0.590,4900,0.560,0.480,7,53,37,22,13,2,'alternate_path', NOW()-'16 days'::interval, 'Medium', 'Medium keys', 59, 5, 0, 4900),
  ('00000000-0000-0000-0004-000000000005','00000000-0000-0000-0000-000000000013', NOW()-'12 days'::interval, NOW()-'12 days'::interval+'22 min'::interval,1320,'medium',0.620,4600,0.590,0.440,8,57,38,24,12,2,'alternate_path', NOW()-'12 days'::interval, 'Medium', 'Medium keys', 62, 5, 0, 4600),
  ('00000000-0000-0000-0004-000000000006','00000000-0000-0000-0000-000000000013', NOW()-'8 days'::interval,  NOW()-'8 days'::interval+'24 min'::interval,  1440,'medium',0.650,4300,0.620,0.400,9,60,36,23,10,3,'alternate_path', NOW()-'8 days'::interval, 'Medium', 'Medium keys', 65, 5, 0, 4300),
  ('00000000-0000-0000-0004-000000000007','00000000-0000-0000-0000-000000000013', NOW()-'4 days'::interval,  NOW()-'4 days'::interval+'26 min'::interval,  1560,'medium',0.680,4100,0.650,0.370,10,63,35,24,9,2,'alternate_path', NOW()-'4 days'::interval, 'Medium', 'Medium keys', 68, 5, 0, 4100)
ON CONFLICT (id) DO NOTHING;

-- ── 4. Reflex scores pour Akhil ───────────────────────────────
INSERT INTO public.reflex_scores (session_id, learner_id, reflex_name, confidence_level, score, indicators_found, created_at)
SELECT s.id, '00000000-0000-0000-0000-000000000010', r.reflex_name, r.conf, r.score, r.ind, s.start_time
FROM (
  VALUES
  ('00000000-0000-0000-0001-000000000001'::UUID,'Moro','High',38,3),
  ('00000000-0000-0000-0001-000000000001'::UUID,'ATNR','High',45,3),
  ('00000000-0000-0000-0001-000000000001'::UUID,'STNR','Medium',55,2),
  ('00000000-0000-0000-0001-000000000001'::UUID,'TLR','Medium',60,2),
  ('00000000-0000-0000-0001-000000000001'::UUID,'Spinal Galant','Medium',50,2),
  ('00000000-0000-0000-0001-000000000001'::UUID,'Palmar Grasp','Medium',42,2),
  ('00000000-0000-0000-0001-000000000005'::UUID,'Moro','High',54,3),
  ('00000000-0000-0000-0001-000000000005'::UUID,'ATNR','Medium',60,2),
  ('00000000-0000-0000-0001-000000000005'::UUID,'STNR','Medium',63,2),
  ('00000000-0000-0000-0001-000000000005'::UUID,'TLR','Low',66,1),
  ('00000000-0000-0000-0001-000000000005'::UUID,'Spinal Galant','Medium',58,2),
  ('00000000-0000-0000-0001-000000000005'::UUID,'Palmar Grasp','Medium',55,2),
  ('00000000-0000-0000-0001-000000000010'::UUID,'Moro','Medium',74,2),
  ('00000000-0000-0000-0001-000000000010'::UUID,'ATNR','Low',79,1),
  ('00000000-0000-0000-0001-000000000010'::UUID,'STNR','Low',73,1),
  ('00000000-0000-0000-0001-000000000010'::UUID,'TLR','Low',74,1),
  ('00000000-0000-0000-0001-000000000010'::UUID,'Spinal Galant','Low',68,1),
  ('00000000-0000-0000-0001-000000000010'::UUID,'Palmar Grasp','Low',71,1)
) AS r(sid, reflex_name, conf, score, ind)
JOIN public.sessions s ON s.id = r.sid
ON CONFLICT DO NOTHING;

-- ── 5. Prescriptions démo pour Akhil ─────────────────────────
INSERT INTO public.prescriptions (learner_id, exercise_id, session_id, notes)
VALUES
  ('00000000-0000-0000-0000-000000000010','ex-004','00000000-0000-0000-0001-000000000010','Focus on slow, controlled movements. 3x per week.'),
  ('00000000-0000-0000-0000-000000000010','ex-001','00000000-0000-0000-0001-000000000008','Morning routine before LetterQuest session.'),
  ('00000000-0000-0000-0000-000000000012','ex-007','00000000-0000-0000-0003-000000000008','With AAC device nearby for communication during exercise.')
ON CONFLICT DO NOTHING;

-- ── Vérification finale ───────────────────────────────────────
SELECT 'exercises' AS table_name, count(*)::text AS rows FROM public.exercises
UNION ALL SELECT 'children', count(*)::text FROM public.children
UNION ALL SELECT 'sessions (Akhil)', count(*)::text FROM public.sessions WHERE learner_id='00000000-0000-0000-0000-000000000010'
UNION ALL SELECT 'sessions (Lily)',  count(*)::text FROM public.sessions WHERE learner_id='00000000-0000-0000-0000-000000000011'
UNION ALL SELECT 'sessions (Marcus)',count(*)::text FROM public.sessions WHERE learner_id='00000000-0000-0000-0000-000000000012'
UNION ALL SELECT 'sessions (Alex)',  count(*)::text FROM public.sessions WHERE learner_id='00000000-0000-0000-0000-000000000013'
UNION ALL SELECT 'reflex_scores',    count(*)::text FROM public.reflex_scores
UNION ALL SELECT 'prescriptions',    count(*)::text FROM public.prescriptions;
