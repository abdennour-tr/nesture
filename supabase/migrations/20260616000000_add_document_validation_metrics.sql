-- Migration: Add validation_metrics to public.documents
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS validation_metrics JSONB DEFAULT NULL;
