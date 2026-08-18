-- Add connection_code for practitioners (users table)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS connection_code TEXT UNIQUE;

-- Allow practitioners to generate their own code
CREATE OR REPLACE FUNCTION generate_practitioner_code(p_user_id UUID)
RETURNS TEXT AS $$
DECLARE
  new_code TEXT;
BEGIN
  new_code := 'OT-' || upper(substring(md5(random()::text), 1, 5));
  UPDATE public.users SET connection_code = new_code WHERE id = p_user_id;
  RETURN new_code;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
