-- ============================================================
-- NestureAI - Fix RLS Recursion on children Table
-- ============================================================

-- 1. Create a SECURITY DEFINER function to check relationship
-- This function runs with bypass RLS privileges (as owner), breaking the circular dependency.
CREATE OR REPLACE FUNCTION public.check_practitioner_child_relation(p_id UUID, c_id UUID)
RETURNS boolean SECURITY DEFINER LANGUAGE plpgsql AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.practitioner_children
    WHERE practitioner_id = p_id AND child_id = c_id
  );
END;
$$;

-- 2. Drop the recursive children policies
DROP POLICY IF EXISTS "children_ot_select" ON public.children;
DROP POLICY IF EXISTS "children_ot_update" ON public.children;

-- 3. Recreate children policies using the helper function
CREATE POLICY "children_ot_select"
  ON public.children FOR SELECT
  TO authenticated
  USING (
    auth.uid() = ot_id OR 
    public.check_practitioner_child_relation(auth.uid(), id)
  );

CREATE POLICY "children_ot_update"
  ON public.children FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = ot_id OR 
    public.check_practitioner_child_relation(auth.uid(), id)
  );

-- 4. Update atlas_profiles policy using the helper function as well
DROP POLICY IF EXISTS "practitioners_read_atlas_profiles" ON public.atlas_profiles;
CREATE POLICY "practitioners_read_atlas_profiles" 
  ON public.atlas_profiles FOR SELECT
  TO authenticated
  USING (
    public.check_practitioner_child_relation(auth.uid(), child_id)
  );
