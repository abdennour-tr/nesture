-- Migration: Create atlas_questionnaire_responses table and RLS policies
-- Store parents' answers to the multi-step intake questionnaire.

CREATE TABLE IF NOT EXISTS public.atlas_questionnaire_responses (
  child_id UUID PRIMARY KEY REFERENCES public.children(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'in_progress' NOT NULL CHECK (status IN ('in_progress', 'completed')),
  
  -- Domain 1: Developmental Profile
  d1_communication_mode TEXT,
  d1_strengths_checklist TEXT[] DEFAULT '{}'::TEXT[],
  d1_who_is TEXT,
  d1_enjoys TEXT,
  d1_what_helps TEXT,

  -- Domains 2-9: JSONB response objects
  d2_responses JSONB DEFAULT '{}'::JSONB,
  d3_responses JSONB DEFAULT '{}'::JSONB,
  d4_responses JSONB DEFAULT '{}'::JSONB,
  d5_responses JSONB DEFAULT '{}'::JSONB,
  d6_responses JSONB DEFAULT '{}'::JSONB,
  d7_responses JSONB DEFAULT '{}'::JSONB,
  d8_responses JSONB DEFAULT '{}'::JSONB,
  d9_responses JSONB DEFAULT '{}'::JSONB,

  -- Domain 10: Genetics
  d10_family_differences TEXT,
  d10_genetic_notes TEXT,

  -- Domain 11: Environment
  d11_location TEXT,
  d11_calm_space TEXT,
  d11_what_helps TEXT[] DEFAULT '{}'::TEXT[],

  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Enable RLS
ALTER TABLE public.atlas_questionnaire_responses ENABLE ROW LEVEL SECURITY;

-- Drop old policies if they exist
DROP POLICY IF EXISTS "Parents can view own child's responses" ON public.atlas_questionnaire_responses;
DROP POLICY IF EXISTS "Parents can manage own child's responses" ON public.atlas_questionnaire_responses;

-- Policy 1: Parents can read their own child's questionnaire responses
CREATE POLICY "Parents can view own child's responses"
  ON public.atlas_questionnaire_responses FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.children
      WHERE children.id = atlas_questionnaire_responses.child_id
      AND children.parent_id = auth.uid()
    )
  );

-- Policy 2: Parents can insert/update (all operations) their own child's questionnaire responses
CREATE POLICY "Parents can manage own child's responses"
  ON public.atlas_questionnaire_responses FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.children
      WHERE children.id = atlas_questionnaire_responses.child_id
      AND children.parent_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.children
      WHERE children.id = atlas_questionnaire_responses.child_id
      AND children.parent_id = auth.uid()
    )
  );
