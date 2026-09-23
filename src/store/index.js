import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { supabase } from '../services/supabaseClient';
import { signIn, signUp, signOut, restoreSession, getRouteForRole } from '../services/authService';

// ── Auth Store ─────────────────────────────────────────────────────────────────
export const useAuthStore = create(
  persist(
    (set, get) => ({
      user:           null,   // Supabase auth.user object
      profile:        null,   // public.users row
      originalProfile: null,  // Stores admin profile during impersonation
      isInitializing: true,   // true ONLY while restoring session on initial app startup
      isLoading:      false,  // true during active auth requests (login/signup)
      error:          null,

      init: async () => {
        set({ isLoading: true });

        try {
          // Restore existing session (page reload)
          const session = await restoreSession();
          if (session) {
            const original = get().originalProfile;
            if (original) {
              // Preserve active impersonated profile and original admin profile
              set({ user: session.user, isInitializing: false, isLoading: false });
            } else {
              set({ user: session.user, profile: session.profile, isInitializing: false, isLoading: false });
            }
          } else {
            set({ user: null, profile: null, originalProfile: null, isInitializing: false, isLoading: false });
          }
        } catch (err) {
          console.error('[Store init] Failed to restore session:', err);
          set({ user: null, profile: null, originalProfile: null, isInitializing: false, isLoading: false });
        }
      },

      /** Login with email + password via Supabase Auth */
      login: async ({ email, password, expectedRole }) => {
        set({ error: null, isLoading: true });
        try {
          const { user, profile, mustResetPassword } = await signIn({ email, password, expectedRole });
          set({ user, profile, isLoading: false });
          return { ...profile, mustResetPassword };
        } catch (err) {
          set({ error: err.message, isLoading: false });
          throw err;
        }
      },

      /** Sign up new account */
      signup: async ({ email, password, firstName, lastName, role, consentAccepted, attestationAgreed }) => {
        set({ error: null, isLoading: true });
        try {
          const { user } = await signUp({ email, password, firstName, lastName, role, consentAccepted, attestationAgreed });
          set({ user, profile: null, isLoading: false });
          return user;
        } catch (err) {
          set({ error: err.message, isLoading: false });
          throw err;
        }
      },

      /** Set auth state directly (used after signUp when the session already exists) */
      setAuth: ({ user, profile }) => {
        set({ user, profile, isLoading: false, error: null });
      },

      /** Sign out from Supabase */
      logout: async () => {
        try {
          await signOut();
        } catch (err) {
          console.warn('[Store] Ignored logout error:', err.message);
        } finally {
          set({ user: null, profile: null, originalProfile: null, error: null });
          // Clear any active game session state
          useSessionStore.getState().clearSession();
        }
      },

      clearError: () => set({ error: null }),

      /** Update profile fields locally (after server save) */
      updateProfile: (updates) => {
        const current = get().profile;
        if (current) {
          set({ profile: { ...current, ...updates } });
        }
      },

      /** Enter impersonation mode */
      impersonate: (targetProfile) => {
        set((state) => ({
          originalProfile: state.originalProfile || state.profile,
          profile: targetProfile
        }));
      },

      /** Exit impersonation mode */
      stopImpersonating: () => {
        const original = get().originalProfile;
        if (original) {
          set({
            profile: original,
            originalProfile: null
          });
        }
      },
    }),
    {
      name:    'nesture-auth',
      storage: createJSONStorage(() => sessionStorage),
      // Persist profile and originalProfile (to maintain impersonation across refreshes)
      partialize: (state) => ({ profile: state.profile, originalProfile: state.originalProfile }),
    }
  )
);

// ── Session Store (unchanged) ──────────────────────────────────────────────────
import * as db from '../services/supabaseDB.js';

export const useSessionStore = create((set, get) => ({
  activeSession: null,
  gestures:      [],
  isRecording:   false,

  startSession: (sessionId, learnerId, difficulty) => {
    set({
      activeSession: { id: sessionId, learnerId, difficulty, startTime: Date.now() },
      gestures:      [],
      isRecording:   true,
    });
  },

  recordGesture: (gesture) => {
    set((state) => ({ gestures: [...state.gestures, gesture] }));
  },

  endSession: async (reflexEngineOutput = null) => {
    const { activeSession, gestures } = get();
    if (!activeSession) {
      console.warn('[Store] endSession called but no activeSession');
      return null;
    }
    try {
      // Passer la sortie du moteur temps réel à la DB pour fusion avec aiEngine
      const result = await db.endSession(activeSession.id, gestures, reflexEngineOutput);
      set({ activeSession: null, gestures: [], isRecording: false });
      return result;
    } catch (err) {
      console.error('[Store] endSession error:', err.message);
      set({ activeSession: null, gestures: [], isRecording: false });
      throw err;
    }
  },

  clearSession: () => {
    set({ activeSession: null, gestures: [], isRecording: false });
  },
}));
