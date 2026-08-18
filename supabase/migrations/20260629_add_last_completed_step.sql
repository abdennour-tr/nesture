-- Add last_completed_step column to atlas_questionnaire_responses
-- This tracks which step the parent was on when they saved progress
ALTER TABLE atlas_questionnaire_responses 
  ADD COLUMN IF NOT EXISTS last_completed_step int DEFAULT 0;
