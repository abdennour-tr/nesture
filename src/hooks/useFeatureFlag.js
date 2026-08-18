import { useState, useEffect } from 'react';
import { supabase } from '../services/supabaseClient';
import { useAuthStore } from '../store';

/**
 * Reusable hook to query user_feature_flags table for the current user.
 * @param {string} featureName - The name of the feature to check.
 * @returns {object} { enabled: boolean, loading: boolean }
 */
export function useFeatureFlag(featureName) {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const { user } = useAuthStore();

  useEffect(() => {
    if (!user) {
      setEnabled(false);
      setLoading(false);
      return;
    }

    async function checkFlag() {
      try {
        setLoading(true);
        const { data, error } = await supabase
          .from('user_feature_flags')
          .select('enabled')
          .eq('user_id', user.id)
          .eq('feature_name', featureName)
          .maybeSingle();

        if (error) throw error;
        setEnabled(data ? !!data.enabled : false);
      } catch (err) {
        console.warn(`[useFeatureFlag] Error checking flag ${featureName}:`, err.message);
        setEnabled(false);
      } finally {
        setLoading(false);
      }
    }

    checkFlag();
  }, [user, featureName]);

  return { enabled, loading };
}
