-- ==============================================================================
-- NestureAI - Avatar & Deletion Updates
-- ==============================================================================

-- 1. Add avatar_url to public.children
ALTER TABLE public.children ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- 2. Create the avatars bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public) 
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- 3. Set up RLS for avatars bucket
-- Drop existing policies if they exist to avoid conflicts
DROP POLICY IF EXISTS "Public access to avatars" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload avatars" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update their avatars" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete their avatars" ON storage.objects;

-- Allow public read access to all avatars
CREATE POLICY "Public access to avatars"
ON storage.objects FOR SELECT
USING ( bucket_id = 'avatars' );

-- Allow authenticated users to upload avatars
CREATE POLICY "Authenticated users can upload avatars"
ON storage.objects FOR INSERT
WITH CHECK ( bucket_id = 'avatars' AND auth.role() = 'authenticated' );

-- Allow authenticated users to update avatars
CREATE POLICY "Authenticated users can update their avatars"
ON storage.objects FOR UPDATE
WITH CHECK ( bucket_id = 'avatars' AND auth.role() = 'authenticated' );

-- Allow authenticated users to delete avatars
CREATE POLICY "Authenticated users can delete their avatars"
ON storage.objects FOR DELETE
USING ( bucket_id = 'avatars' AND auth.role() = 'authenticated' );

-- (Optional but recommended) Allow authenticated users to delete documents from patient-documents bucket
DROP POLICY IF EXISTS "Authenticated users can delete documents" ON storage.objects;
CREATE POLICY "Authenticated users can delete documents"
ON storage.objects FOR DELETE
USING ( bucket_id = 'patient-documents' AND auth.role() = 'authenticated' );
