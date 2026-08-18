-- Migration: Database-level Security Validation & Hard Constraints
-- Cleanup legacy dotted last names to prevent CHECK constraint failures
UPDATE public.users SET last_name = replace(last_name, '.', '') WHERE last_name LIKE '%.%';
UPDATE public.children SET last_name = replace(last_name, '.', '') WHERE last_name LIKE '%.%';

-- 1. Add CHECK constraints to public.users table
ALTER TABLE public.users
  -- Validation de first_name (requis pour les comptes, mais peut être vide dans les triggers temporaires, donc check si non vide)
  ADD CONSTRAINT users_first_name_check CHECK (
    first_name IS NULL OR first_name = '' OR (
      length(trim(first_name)) >= 2 AND 
      length(trim(first_name)) <= 50 AND 
      trim(first_name) ~ '^[a-zA-ZÀ-ÿ\s''-]+$'
    )
  ),
  -- Validation de last_name (si non vide/null)
  ADD CONSTRAINT users_last_name_check CHECK (
    last_name IS NULL OR last_name = '' OR (
      length(trim(last_name)) >= 2 AND 
      length(trim(last_name)) <= 50 AND 
      trim(last_name) ~ '^[a-zA-ZÀ-ÿ\s''-]+$'
    )
  ),
  -- Limite de longueur pour practice_name
  ADD CONSTRAINT users_practice_name_length CHECK (
    practice_name IS NULL OR length(trim(practice_name)) <= 100
  ),
  -- Limite de longueur pour location
  ADD CONSTRAINT users_location_length CHECK (
    location IS NULL OR length(trim(location)) <= 100
  ),
  -- Limite de longueur et format pour registration_number (si non null)
  ADD CONSTRAINT users_registration_number_check CHECK (
    registration_number IS NULL OR registration_number = '' OR (
      length(trim(registration_number)) <= 30 AND 
      trim(registration_number) ~ '^[a-zA-Z0-9_-]+$'
    )
  ),
  -- Limite de longueur pour bio
  ADD CONSTRAINT users_bio_length CHECK (
    bio IS NULL OR length(trim(bio)) <= 500
  );

-- 2. Add CHECK constraints to public.children table
ALTER TABLE public.children
  -- Validation de first_name (requis, 2-50 chars, lettres, espaces, tirets, apostrophes)
  ADD CONSTRAINT children_first_name_check CHECK (
    length(trim(first_name)) >= 2 AND 
    length(trim(first_name)) <= 50 AND 
    trim(first_name) ~ '^[a-zA-ZÀ-ÿ\s''-]+$'
  ),
  -- Validation de last_name (si non vide/null)
  ADD CONSTRAINT children_last_name_check CHECK (
    last_name IS NULL OR last_name = '' OR (
      length(trim(last_name)) >= 2 AND 
      length(trim(last_name)) <= 50 AND 
      trim(last_name) ~ '^[a-zA-ZÀ-ÿ\s''-]+$'
    )
  ),
  -- Validation de l'âge (0 à 80 ans)
  ADD CONSTRAINT children_age_check CHECK (
    age IS NULL OR (age >= 0 AND age <= 80)
  ),
  -- Limite de longueur pour diagnosis (facultatif)
  ADD CONSTRAINT children_diagnosis_length CHECK (
    diagnosis IS NULL OR length(trim(diagnosis)) <= 100
  );
