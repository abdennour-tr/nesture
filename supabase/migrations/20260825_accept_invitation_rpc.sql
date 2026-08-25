-- RPC function to bypass RLS and accept invitation securely
CREATE OR REPLACE FUNCTION public.accept_invitation(user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Only allow the authenticated user to accept their own invitation
  IF auth.uid() = user_id THEN
    UPDATE public.users
    SET 
      must_reset_password = false,
      invitation_accepted_at = now()
    WHERE id = user_id;
  ELSE
    RAISE EXCEPTION 'Not authorized to accept this invitation';
  END IF;
END;
$$;
