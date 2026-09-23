-- ==============================================================================
-- NestureAI — Revoke AI Access & Delete Data: also delete raw tracking data
-- ==============================================================================
-- Client feedback: "when the data removed when the user click 'Revoke AI
-- Access & Delete Data' the games session data don't removed".
--
-- What was actually happening: revoke_ai_consent() (see
-- 20260922_security_and_consent_fixes.sql) deletes documents, the Atlas
-- profile, domain scores, questionnaire responses and Ask-AI chat history —
-- but never touched raw_hand_tracking or raw_pose_tracking. Those two tables
-- hold the raw per-frame hand/pose landmark positions captured during every
-- camera game round (see hooks/useHandTracking.js, useUpperBodyTracking.js),
-- keyed by child_id. That IS AI-generated/biometric data, not the aggregate
-- "game progress (scores)" the consent copy in ConsentSettingsModal.jsx
-- promises to keep ("Game progress (scores) will remain anonymized") — the
-- `sessions` table (final scores/accuracy/words completed) is intentionally
-- left untouched, unchanged from before.
--
-- This migration extends revoke_ai_consent() to also delete every
-- raw_hand_tracking and raw_pose_tracking row for each affected child.
-- ==============================================================================

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

    -- Raw hand/pose tracking is the per-frame camera-derived landmark data
    -- behind the AI reflex/OT analysis — biometric AI data, not a game score.
    -- Deleting it is what actually fulfils "Revoke AI Access & Delete Data".
    DELETE FROM public.raw_hand_tracking WHERE public.raw_hand_tracking.child_id = v_child.id;
    DELETE FROM public.raw_pose_tracking WHERE public.raw_pose_tracking.child_id = v_child.id;

    UPDATE public.children SET ai_consent_revoked_at = NOW() WHERE id = v_child.id;

    INSERT INTO public.consent_revocations (parent_id, child_id, documents_deleted)
    VALUES (p_parent_id, v_child.id, v_doc_count);
  END LOOP;

  UPDATE public.consent
  SET withdrawal_at = NOW()
  WHERE parent_id = p_parent_id AND withdrawal_at IS NULL;
END;
$$;
