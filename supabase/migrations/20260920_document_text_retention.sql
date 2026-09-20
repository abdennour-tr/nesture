-- ============================================================================
-- Make "documents are processed and then deleted" true.
-- ----------------------------------------------------------------------------
-- The consent shown at signup promises that an uploaded report is processed and
-- then deleted, and that only the structured profile is retained. The pipeline
-- could not honour that, because re-analysis re-downloaded the original file
-- from storage: deleting it would have broken the feature and, on failure, the
-- error path deleted the document record outright.
--
-- Storing the extracted text breaks that dependency. Re-analysis reads the text
-- instead of the file, so process-document can delete the raw upload as soon as
-- extraction succeeds.
--
-- Note what this does and does not change: the text of the report still lives in
-- our database, and it still contains whatever identifiers the clinician wrote.
-- What goes away is the original document — the letterhead, signatures, logos and
-- any images it carried.
-- ============================================================================

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS extracted_text TEXT;

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS raw_file_deleted_at TIMESTAMPTZ;

COMMENT ON COLUMN public.documents.extracted_text IS
  'Text extracted from the uploaded document at processing time. Retained so the '
  'raw file can be deleted while re-analysis still works. Treat as sensitive: it '
  'is the content of a clinical report.';

COMMENT ON COLUMN public.documents.raw_file_deleted_at IS
  'When the original uploaded file was removed from the patient-documents bucket. '
  'NULL means the raw file is still stored — either processing has not finished, '
  'or it predates automatic deletion.';

-- Lets support answer "is this parent's original file gone yet?" without a scan.
CREATE INDEX IF NOT EXISTS idx_documents_raw_pending
  ON public.documents (child_id)
  WHERE raw_file_deleted_at IS NULL;
