-- Migration: Create atlas_domain_scores table and RLS policies
-- Store deterministic scores and bands for child profiles.

CREATE TABLE IF NOT EXISTS public.atlas_domain_scores (
  child_id UUID PRIMARY KEY REFERENCES public.children(id) ON DELETE CASCADE,
  
  -- Scored Domains (d2 to d9)
  d2_score INTEGER,
  d2_band TEXT CHECK (d2_band IN ('support_area', 'developing', 'strength')),
  
  d3_score INTEGER,
  d3_band TEXT CHECK (d3_band IN ('support_area', 'developing', 'strength')),
  
  d4_score INTEGER,
  d4_band TEXT CHECK (d4_band IN ('support_area', 'developing', 'strength')),
  
  d5_score INTEGER,
  d5_band TEXT CHECK (d5_band IN ('support_area', 'developing', 'strength')),
  
  d6_score INTEGER,
  d6_band TEXT CHECK (d6_band IN ('support_area', 'developing', 'strength')),
  
  
  d7_score INTEGER,
  d7_band TEXT CHECK (d7_band IN ('support_area', 'developing', 'strength')),
  
  d8_score INTEGER,
  d8_band TEXT CHECK (d8_band IN ('support_area', 'developing', 'strength')),
  
  d9_score INTEGER,
  d9_band TEXT CHECK (d9_band IN ('support_area', 'developing', 'strength')),

  -- Composite
  composite_score INTEGER,

  -- Domain 12 Support Plan
  d12_support_plan TEXT,

  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Enable RLS
ALTER TABLE public.atlas_domain_scores ENABLE ROW LEVEL SECURITY;

-- Drop old policies if they exist
DROP POLICY IF EXISTS "Parents can view own child's domain scores" ON public.atlas_domain_scores;
DROP POLICY IF EXISTS "Parents can manage own child's domain scores" ON public.atlas_domain_scores;

-- Policy 1: Parents can read their own child's domain scores
CREATE POLICY "Parents can view own child's domain scores"
  ON public.atlas_domain_scores FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.children
      WHERE children.id = atlas_domain_scores.child_id
      AND children.parent_id = auth.uid()
    )
  );

-- Policy 2: Parents can manage (ALL operations) their own child's domain scores
CREATE POLICY "Parents can manage own child's domain scores"
  ON public.atlas_domain_scores FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.children
      WHERE children.id = atlas_domain_scores.child_id
      AND children.parent_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.children
      WHERE children.id = atlas_domain_scores.child_id
      AND children.parent_id = auth.uid()
    )
  );
