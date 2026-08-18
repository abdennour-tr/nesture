-- ============================================================
-- NestureAI - Fix RLS Policies for Practitioners (OTs)
-- ============================================================

-- 1. Drop old restrictive OT select/update policies on public.children
DROP POLICY IF EXISTS "children_ot_select" ON public.children;
DROP POLICY IF EXISTS "children_ot_update" ON public.children;

-- 2. Create new policies based on the practitioner_children junction table
CREATE POLICY "children_ot_select"
  ON public.children FOR SELECT
  TO authenticated
  USING (
    auth.uid() = ot_id OR 
    EXISTS (
      SELECT 1 FROM public.practitioner_children
      WHERE practitioner_id = auth.uid() AND child_id = public.children.id
    )
  );

CREATE POLICY "children_ot_update"
  ON public.children FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = ot_id OR 
    EXISTS (
      SELECT 1 FROM public.practitioner_children
      WHERE practitioner_id = auth.uid() AND child_id = public.children.id
    )
  );

-- 3. Ensure practitioners can read atlas_profiles of connected children
DROP POLICY IF EXISTS "practitioners_read_atlas_profiles" ON public.atlas_profiles;
CREATE POLICY "practitioners_read_atlas_profiles" 
  ON public.atlas_profiles FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.practitioner_children
      WHERE practitioner_id = auth.uid() AND child_id = public.atlas_profiles.child_id
    )
  );
