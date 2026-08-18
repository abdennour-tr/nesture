import { createClient } from '@supabase/supabase-js';

export const supabaseUrl     = process.env.REACT_APP_SUPABASE_URL     || 'https://placeholder.supabase.co';
export const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY || 'placeholder';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken:    true,
    persistSession:      true,
    detectSessionInUrl:  true,
    storage:             window.localStorage,
  },
});

/** Fetch the public.users profile row for a given Supabase auth UUID
 *  In this schema, public.users.id = auth.users.id (standard Supabase pattern)
 */
export async function getUserProfile(authId) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', authId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`No profile found in public.users for auth ID: ${authId}. Run the demo seed SQL.`);
  return data;
}

/** Fetch all children linked to a parent's public.users id */
export async function getChildrenForParent(parentId) {
  const { data, error } = await supabase
    .from('children')
    .select('*')
    .eq('parent_id', parentId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}
