-- ═══════════════════════════════════════════════════════════════════════════════
-- NestureLearn — Table de contenu éducatif
-- Exécuter dans le Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1. Créer la table learn_content
CREATE TABLE IF NOT EXISTS learn_content (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL CHECK (type IN ('video', 'podcast', 'article')),
  url TEXT NOT NULL,
  thumbnail_url TEXT,
  duration TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  featured BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Activer RLS
ALTER TABLE learn_content ENABLE ROW LEVEL SECURITY;

-- 3. Policy : tout utilisateur authentifié peut lire
CREATE POLICY "Authenticated users can read learn_content"
  ON learn_content FOR SELECT
  TO authenticated
  USING (true);

-- 4. Index sur les tags pour la recherche par overlaps
CREATE INDEX IF NOT EXISTS idx_learn_content_tags ON learn_content USING GIN (tags);

-- ═══════════════════════════════════════════════════════════════════════════════
-- SEED DATA — Contenu éducatif réel
-- Tags correspondent aux domaines Atlas :
--   sensory, reflex, communication, daily_living, academic, behavioral,
--   developmental, functional_wellness, genetic, environment
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO learn_content (title, description, type, url, thumbnail_url, duration, tags, featured) VALUES

-- ── VIDEOS ──────────────────────────────────────────────────────────────────────
(
  'Understanding Sensory Processing in Children',
  'Learn how sensory processing affects daily life for neurodiverse children and practical strategies for parents.',
  'video',
  'https://www.youtube.com/watch?v=TP0pA2Rtg5E',
  'https://images.unsplash.com/photo-1503454537195-1dcabb73ffb9?w=640&h=360&fit=crop',
  '12 min',
  '{sensory,developmental}',
  true
),
(
  'Primitive Reflexes: What Every Parent Should Know',
  'A clear explanation of retained primitive reflexes and how they impact motor development and learning.',
  'video',
  'https://www.youtube.com/watch?v=GvA7yMjtzcc',
  'https://images.unsplash.com/photo-1587614382346-4ec70e388b28?w=640&h=360&fit=crop',
  '18 min',
  '{reflex,developmental}',
  true
),

-- ── PODCAST ─────────────────────────────────────────────────────────────────────
(
  'AAC Communication: Giving Every Child a Voice',
  'Expert discussion on Augmentative and Alternative Communication strategies for non-verbal and minimally verbal children.',
  'podcast',
  'https://open.spotify.com/episode/placeholder-aac-communication',
  'https://images.unsplash.com/photo-1478737270239-2f02b77fc618?w=640&h=360&fit=crop',
  '25 min',
  '{communication}',
  false
),

-- ── ARTICLES ────────────────────────────────────────────────────────────────────
(
  'Building a Sensory Diet at Home: A Practical Guide',
  'Step-by-step guide to creating sensory-friendly routines and activities that support regulation throughout the day.',
  'article',
  'https://www.understood.org/en/articles/sensory-diet',
  'https://images.unsplash.com/photo-1544776193-352d25ca82cd?w=640&h=360&fit=crop',
  '5 min read',
  '{sensory,daily_living}',
  false
),
(
  'Daily Living Skills for Neurodiverse Kids',
  'Practical strategies for teaching self-care, organization, and independence to children with developmental differences.',
  'article',
  'https://www.autismspeaks.org/daily-living-skills',
  'https://images.unsplash.com/photo-1596464716127-f2a82984de30?w=640&h=360&fit=crop',
  '7 min read',
  '{daily_living,functional_wellness}',
  false
),

-- ── CONTENU SUPPLÉMENTAIRE (affiché quand "See more") ───────────────────────────
(
  'How Retained Reflexes Affect Handwriting',
  'Exploring the link between ATNR, STNR and handwriting difficulties in school-age children.',
  'video',
  'https://www.youtube.com/watch?v=placeholder-reflex-handwriting',
  'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=640&h=360&fit=crop',
  '14 min',
  '{reflex,academic}',
  false
),
(
  'Understanding Meltdowns vs Tantrums',
  'Learn the difference between sensory meltdowns and behavioral tantrums, and how to respond to each.',
  'article',
  'https://www.understood.org/en/articles/meltdowns-vs-tantrums',
  'https://images.unsplash.com/photo-1609220136736-443140cffec6?w=640&h=360&fit=crop',
  '4 min read',
  '{behavioral,sensory}',
  false
),
(
  'Supporting Communication at Home',
  'Simple strategies parents can use daily to encourage communication development in children with speech delays.',
  'podcast',
  'https://open.spotify.com/episode/placeholder-communication-home',
  'https://images.unsplash.com/photo-1491013516836-7db643ee125a?w=640&h=360&fit=crop',
  '30 min',
  '{communication,daily_living}',
  false
);
