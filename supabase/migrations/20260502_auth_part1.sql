-- ============================================================
-- NestureAI Auth Migration — PARTIE 1 of 2
-- Coller dans le SQL Editor et cliquer Run AVANT la Partie 2
-- ============================================================

-- ── 1. Ajouter les colonnes manquantes à public.users ────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'auth_id') THEN
    ALTER TABLE public.users ADD COLUMN auth_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'is_demo') THEN
    ALTER TABLE public.users ADD COLUMN is_demo BOOLEAN DEFAULT FALSE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'beta_participant') THEN
    ALTER TABLE public.users ADD COLUMN beta_participant BOOLEAN DEFAULT FALSE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'converted_at') THEN
    ALTER TABLE public.users ADD COLUMN converted_at TIMESTAMPTZ DEFAULT NULL;
  END IF;
END $$;

-- ── 2. Ajouter les colonnes à children ───────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'children' AND column_name = 'letterquest_level') THEN
    ALTER TABLE public.children ADD COLUMN letterquest_level TEXT DEFAULT 'medium';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'children' AND column_name = 'completeness_percentage') THEN
    ALTER TABLE public.children ADD COLUMN completeness_percentage INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'children' AND column_name = 'adaptive_demo') THEN
    ALTER TABLE public.children ADD COLUMN adaptive_demo BOOLEAN DEFAULT FALSE;
  END IF;
END $$;

-- ── 3. Créer la table consent (si elle n'existe pas déjà) ─────
CREATE TABLE IF NOT EXISTS public.consent (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id               UUID REFERENCES public.users(id) ON DELETE CASCADE,
  auth_id                 UUID REFERENCES auth.users(id),
  agreement_version       VARCHAR(10) DEFAULT 'v1.0',
  accepted_at             TIMESTAMPTZ DEFAULT NOW(),
  ip_address              TEXT,
  sections_consented      JSONB DEFAULT '["strengths","challenges","communication_profile","sensory_profile","functional_wellness","primitive_motor_reflex"]'::jsonb,
  practitioner_sharing    BOOLEAN DEFAULT FALSE,
  beta_participation      BOOLEAN DEFAULT TRUE,
  withdrawal_at           TIMESTAMPTZ DEFAULT NULL,
  withdrawn_practitioners JSONB DEFAULT NULL
);

-- ── 4. Créer la table feedback ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.feedback (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID REFERENCES public.users(id),
  auth_id        UUID REFERENCES auth.users(id),
  feature        TEXT NOT NULL,
  comment        TEXT,
  rating         INTEGER CHECK (rating >= 1 AND rating <= 5),
  session_number INTEGER DEFAULT NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── Résultat attendu : "Success. No rows returned." ──────────
-- → Passez maintenant à la PARTIE 2
