-- ==============================================================================
-- NestureAI — Security & Consent Fixes (privacy review follow-up, 2026-09-22)
-- ==============================================================================
-- This migration fixes 3 of the 5 items raised in the privacy review:
--   1. Admin RLS policies were gated on a hardcoded literal email address.
--      -> replaced with a role-based check via public.is_admin().
--   2. The "Revoke AI Access & Delete Data" button in the app did nothing.
--      -> adds a real, auditable RPC (public.revoke_ai_consent) + a
--         consent_revocations audit table, used by the new
--         supabase/functions/revoke-ai-consent edge function.
--   3. No verifiable-parental-consent record was ever actually written.
--      -> adds attestation columns to public.consent, used by the new
--         supabase/functions/record-consent-attestation edge function.
-- Run this with `supabase db push` (or paste into the SQL Editor and Run).
-- ==============================================================================

-- ──────────────────────────────────────────────────────────────────────────────
-- PART 1 — Role-based admin check (replaces hardcoded admin email in RLS)
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid()
      AND role = 'admin'
      AND COALESCE(is_active, true) = true
  );
$$;

COMMENT ON FUNCTION public.is_admin() IS
  'Role-based admin check for RLS policies. Replaces the old hardcoded '
  '"auth.jwt() ->> ''email'' = ''admin@gmail.com''" pattern (a prototype '
  'artifact flagged in the Sept 2026 privacy review).';

-- Recreate every "admin_all_*" policy using public.is_admin() instead of a
-- literal email address. Tables that may not exist on every environment are
-- guarded with a DO block so this migration is safe to run anywhere.

CREATE OR REPLACE FUNCTION public._recreate_admin_policy(p_table text, p_policy text) RETURNS void AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = p_table) THEN
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p_policy, p_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin())',
      p_policy, p_table
    );
  END IF;
END;
$$ LANGUAGE plpgsql;

SELECT public._recreate_admin_policy('users', 'admin_all_users');
SELECT public._recreate_admin_policy('children', 'admin_all_children');
SELECT public._recreate_admin_policy('sessions', 'admin_all_sessions');
SELECT public._recreate_admin_policy('learn_content', 'admin_all_learn_content');
SELECT public._recreate_admin_policy('practitioner_children', 'admin_all_practitioner_children');
SELECT public._recreate_admin_policy('connection_requests', 'admin_all_connection_requests');
SELECT public._recreate_admin_policy('atlas_profiles', 'admin_all_atlas_profiles');
SELECT public._recreate_admin_policy('documents', 'admin_all_documents');
SELECT public._recreate_admin_policy('prescriptions', 'admin_all_prescriptions');
SELECT public._recreate_admin_policy('consent', 'admin_all_consent');
SELECT public._recreate_admin_policy('reflex_scores', 'admin_all_reflex_scores');
SELECT public._recreate_admin_policy('admin_audit_logs', 'admin_all_audit_logs');
SELECT public._recreate_admin_policy('admin_impersonation_logs', 'admin_all_impersonation_logs');
SELECT public._recreate_admin_policy('ask_ai_messages', 'admin_all_ask_ai_messages');

DROP FUNCTION public._recreate_admin_policy(text, text);

-- NOTE (manual step, not run by this migration — see chat steps):
-- The seeded demo admin account (auth.users row with the gmail-style
-- address and the 'admin123'/'NestureAdmin2026!Secure' password from the
-- 2026-06-14 / 2026-07-15 migrations) is a prototype artifact and should be
-- rotated or deleted before a public launch — see CLAUDE.md §5.


-- ──────────────────────────────────────────────────────────────────────────────
-- PART 2 — Real "Revoke AI Access & Delete Data"
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.children
  ADD COLUMN IF NOT EXISTS ai_consent_revoked_at TIMESTAMPTZ DEFAULT NULL;

CREATE TABLE IF NOT EXISTS public.consent_revocations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  child_id          UUID NOT NULL REFERENCES public.children(id) ON DELETE CASCADE,
  documents_deleted INTEGER NOT NULL DEFAULT 0,
  revoked_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.consent_revocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "consent_revocations_own" ON public.consent_revocations;
CREATE POLICY "consent_revocations_own" ON public.consent_revocations
  FOR SELECT TO authenticated
  USING (auth.uid() = parent_id);

DROP POLICY IF EXISTS "admin_all_consent_revocations" ON public.consent_revocations;
CREATE POLICY "admin_all_consent_revocations" ON public.consent_revocations
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Deletes every AI-derived data point for every child of p_parent_id:
--   uploaded documents (+ extracted text), atlas profile, atlas domain
--   scores, atlas questionnaire responses, and the AI chat history.
-- Returns the file_path of every document deleted, so the edge function can
-- remove the matching object from Storage (RPCs cannot touch Storage).
-- Game session data (scores) is intentionally left untouched — the consent
-- copy shown to parents ("Game progress will remain") promises this.
CREATE OR REPLACE FUNCTION public.revoke_ai_consent(p_parent_id UUID)
RETURNS TABLE(child_id UUID, file_path TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_child RECORD;
  v_doc_count INTEGER;
BEGIN
  IF p_parent_id IS NULL OR p_parent_id <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized to revoke consent for this account';
  END IF;

  FOR v_child IN SELECT id FROM public.children WHERE parent_id = p_parent_id LOOP
    -- Hand back every document's storage path before we delete the rows.
    RETURN QUERY
      SELECT v_child.id, d.file_path FROM public.documents d
      WHERE d.child_id = v_child.id AND d.file_path IS NOT NULL;

    SELECT COUNT(*) INTO v_doc_count FROM public.documents WHERE public.documents.child_id = v_child.id;

    DELETE FROM public.documents WHERE public.documents.child_id = v_child.id;
    DELETE FROM public.atlas_profiles WHERE public.atlas_profiles.child_id = v_child.id;
    DELETE FROM public.atlas_domain_scores WHERE public.atlas_domain_scores.child_id = v_child.id;
    DELETE FROM public.atlas_questionnaire_responses WHERE public.atlas_questionnaire_responses.child_id = v_child.id;
    DELETE FROM public.ask_ai_messages WHERE public.ask_ai_messages.child_id = v_child.id;

    UPDATE public.children SET ai_consent_revoked_at = NOW() WHERE id = v_child.id;

    INSERT INTO public.consent_revocations (parent_id, child_id, documents_deleted)
    VALUES (p_parent_id, v_child.id, v_doc_count);
  END LOOP;

  UPDATE public.consent
  SET withdrawal_at = NOW()
  WHERE parent_id = p_parent_id AND withdrawal_at IS NULL;
END;
$$;


-- ──────────────────────────────────────────────────────────────────────────────
-- PART 3 — Verifiable parental attestation (lightweight self-certification)
-- ──────────────────────────────────────────────────────────────────────────────
-- Not an identity check (no ID document, no payment method): a required,
-- explicit legal attestation checkbox captured with timestamp + IP + user
-- agent as evidence, per the review's "quick / free" option.

ALTER TABLE public.consent
  ADD COLUMN IF NOT EXISTS attestation_confirmed BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS attestation_text TEXT,
  ADD COLUMN IF NOT EXISTS user_agent TEXT;
