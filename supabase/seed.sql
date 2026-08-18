-- ============================================================
-- NestureAI Seed Data — Demo Profile: Akhil
-- Run this AFTER the migration (20260502_init.sql)
-- ============================================================

-- STEP 1: Insert a dummy user into auth.users (the real Supabase auth table)
-- This bypasses the FK constraint on public.users.id → auth.users.id
INSERT INTO auth.users (
    id,
    instance_id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    created_at,
    updated_at,
    raw_app_meta_data,
    raw_user_meta_data,
    is_super_admin,
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change
)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'demo.parent@nestureai.com',
    '$2a$10$PznXR5VSgzjnAp7T2MoMse5moTf0WsEe5JbPDQh1KIbPXLfGR7GEm', -- placeholder hash
    now(),
    now(),
    now(),
    '{"provider": "email", "providers": ["email"]}',
    '{"first_name": "Demo", "last_name": "Parent"}',
    false,
    '',
    '',
    '',
    ''
)
ON CONFLICT (id) DO NOTHING;

-- STEP 2: Insert into public.users (now the FK is satisfied)
INSERT INTO public.users (id, role, first_name, last_name)
VALUES ('00000000-0000-0000-0000-000000000001', 'parent', 'Demo', 'Parent')
ON CONFLICT (id) DO NOTHING;

-- STEP 3: Create Akhil (the demo child)
INSERT INTO public.children (id, parent_id, first_name, last_name, age, diagnosis)
VALUES (
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    'Akhil', 'M.', 22,
    'ASD, CAPD, Mitochondrial Disease, Generalised Dyspraxia'
)
ON CONFLICT (id) DO NOTHING;

-- STEP 4: Create Documents for Akhil
INSERT INTO public.documents (child_id, file_name, file_path, file_type, status)
VALUES 
    ('00000000-0000-0000-0000-000000000002', 'Neuro_Eval_2021.pdf',  'demo/Neuro_Eval_2021.pdf',  'Biomedical',    'definitive'),
    ('00000000-0000-0000-0000-000000000002', 'OT_Report_2025.pdf',   'demo/OT_Report_2025.pdf',   'OT_Evaluation', 'definitive')
ON CONFLICT DO NOTHING;

-- STEP 5: Create Atlas Profile for Akhil
INSERT INTO public.atlas_profiles (
    child_id,
    completeness_percentage,
    strengths,
    challenges,
    communication_profile,
    sensory_profile,
    functional_wellness,
    motor_reflexes,
    cross_report_insights,
    home_plan,
    calibration_parameters,
    care_navigator
)
VALUES (
    '00000000-0000-0000-0000-000000000002',
    95,
    '[
        {"label": "College-level mathematics", "source": "OT_Report_2025.pdf"},
        {"label": "Deep empathy and emotional intelligence", "source": "Neuro_Eval_2021.pdf"},
        {"label": "Communicates effectively through typing/AAC", "source": "OT_Report_2025.pdf"}
    ]',
    '[
        {"label": "Motor planning and execution", "source": "OT_Report_2025.pdf"},
        {"label": "Auditory processing in noisy environments", "source": "Neuro_Eval_2021.pdf"},
        {"label": "Fatigue management", "source": "Biomedical Report"}
    ]',
    '{"method": "Typing/AAC", "notes": "Presume competence. Give adequate processing time. Avoid rushing responses."}',
    '{"processing": "Gets overwhelmed by multiple simultaneous voices", "environments": "Requires quiet, structured settings for optimal focus"}',
    '[
        {"title": "Gut-brain connection", "confidence": "DEFINITIVE", "source": "Biomedical Report", "description": "Documented connection acknowledged by two independent practitioners."},
        {"title": "Mitochondrial support needs", "confidence": "DEFINITIVE", "source": "Neuro_Eval_2021.pdf", "description": "Formal diagnosis on record. Energy management is a key daily consideration."},
        {"title": "Inflammation markers", "confidence": "DERIVED", "source": "Multiple", "description": "Inferred from biomedical protocol notes. This is an educational inference based on uploaded documents — consult a qualified healthcare professional before acting on it."}
    ]',
    '[
        {"name": "Moro",  "score": 4, "confidence": "DEFINITIVE", "source": "OT_Report_2025.pdf"},
        {"name": "ATNR",  "score": 4, "confidence": "DEFINITIVE", "source": "OT_Report_2025.pdf"},
        {"name": "TLR",   "score": 4, "confidence": "DEFINITIVE", "source": "OT_Report_2025.pdf"}
    ]',
    '[
        {"title": "Consistent Reflex Retention", "confidence": "HIGH", "label": "DERIVED", "description": "Moro, ATNR, and TLR retained at 4/4 across four assessments over four years."}
    ]',
    '{"activities": [{"name": "Bilateral coordination exercises", "duration": "10 mins"}, {"name": "Heavy work / proprioceptive input", "duration": "15 mins"}]}',
    '{"keyboard_size": "Standard keys", "difficulty_mode": "Complex - Sentences"}',
    '{"specialists": [{"type": "Occupational Therapist", "reason": "For primitive reflex integration programme"}], "content": []}'
)
ON CONFLICT (child_id) DO NOTHING;
