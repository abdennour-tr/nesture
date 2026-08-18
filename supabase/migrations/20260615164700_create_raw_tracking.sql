-- Création de la table pour stocker les données brutes de suivi
CREATE TABLE IF NOT EXISTS public.raw_hand_tracking (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id UUID NOT NULL,
    child_id UUID NOT NULL,
    positions JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Activation de la sécurité au niveau des lignes (RLS)
ALTER TABLE public.raw_hand_tracking ENABLE ROW LEVEL SECURITY;

-- Politique : Les utilisateurs authentifiés peuvent insérer des données
CREATE POLICY "Users can insert raw tracking data" 
ON public.raw_hand_tracking 
FOR INSERT 
TO authenticated 
WITH CHECK (true);

-- Politique : Les utilisateurs authentifiés peuvent lire les données
CREATE POLICY "Users can view raw tracking data" 
ON public.raw_hand_tracking 
FOR SELECT 
TO authenticated 
USING (true);
