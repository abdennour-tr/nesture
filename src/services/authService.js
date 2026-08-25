import { supabase, getUserProfile } from './supabaseClient';
import { handleAuthError } from './authErrorMiddleware';

// ── Language rule (PRD §1) ─────────────────────────────────────────────────────
// Always use: support plan, learning plan, professional assessment,
//             movement activities, practice sessions, evidence-backed, recommended
// Never use:  treatment plan, prescribe, clinical, therapeutic, patient,
//             medical, diagnose

// ── Demo accounts ──────────────────────────────────────────────────────────────
export const DEMO_ACCOUNTS = [
  {
    email:    'jennifer@example.com',
    password: 'password123',
    role:     'parent',
    label:    'Jennifer · Parent',
    color:    '#E8841A',
    icon:     '👨‍👩‍👧',
  },
  {
    email:    'sarah@example.com',
    password: 'password123',
    role:     'practitioner',
    label:    'Sarah · OT',
    color:    '#0ea5e9',
    icon:     '🩺',
  },
  {
    email:    'akhil@example.com',
    password: 'password123',
    role:     'learner',
    label:    'Akhil · Learner',
    color:    '#10b981',
    icon:     '🎮',
  },
];

// ── Route helper ───────────────────────────────────────────────────────────────
export function getRouteForRole(role) {
  if (role === 'admin')        return '/admin';
  if (role === 'parent')       return '/parent';
  if (role === 'practitioner') return '/ot';
  if (role === 'learner')      return '/play';
  return '/login';
}

// ── Strict validations (PRD §3) ───────────────────────────────────────────────
export function validateEmail(email) {
  if (!email) throw new Error('Email is required.');
  if (email.length > 255) throw new Error('Email must be 255 characters or less.');
  
  // Regex to ensure standard email format and prevent SQL/special character injections
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!emailRegex.test(email)) {
    throw new Error('Please enter a valid email address containing only standard characters.');
  }
}

export function validateName(name, fieldName = 'Name') {
  if (!name && fieldName !== 'First name') return; // Only first name is strictly required
  if (!name && fieldName === 'First name') throw new Error('First name is required.');
  if (name.length > 50) throw new Error(`${fieldName} must be 50 characters or less.`);
  
  // Reject any special character besides letters, spaces, hyphens, and apostrophes
  const nameRegex = /^[a-zA-ZÀ-ÿ\s'-]+$/;
  if (!nameRegex.test(name)) {
    throw new Error(`${fieldName} contains invalid characters. Only letters, spaces, hyphens, and apostrophes are allowed.`);
  }
}

export function validatePassword(password, isLearner = false) {
  if (!password) throw new Error('Password is required.');
  const minLength = isLearner ? 4 : 8;
  if (password.length < minLength) throw new Error(`Password must be at least ${minLength} characters.`);
  if (password.length > 72) throw new Error('Password must be 72 characters or less.');
}

// Helper to dynamically create profile row in public.users if missing (e.g. trigger failed or didn't run)
export async function ensureUserProfileFallback(user, expectedRole = null) {
  const authUserId = user.id;
  const meta = user.user_metadata || user.raw_user_meta_data || {};
  
  const role = meta.role || expectedRole || 'parent';
  const first_name = meta.first_name || '';
  const last_name = meta.last_name || '';
  
  const { data, error } = await supabase
    .from('users')
    .insert([{
      id: authUserId,
      role,
      first_name,
      last_name,
      is_demo: false,
      beta_participant: true
    }])
    .select()
    .maybeSingle();

  if (error) {
    console.error('[ensureUserProfileFallback] Failed to insert profile row:', error.message);
    throw error;
  }
  return data;
}

// ── signUp ─────────────────────────────────────────────────────────────────────
export async function signUp({ email, password, firstName, lastName, role = 'parent', consentAccepted }) {
  if (!consentAccepted) {
    throw new Error('Consent is required to create an account.');
  }

  // Run strict validations
  validateEmail(email);
  validatePassword(password);
  validateName(firstName, 'First name');
  validateName(lastName, 'Last name');

  if (role !== 'parent' && role !== 'practitioner') {
    throw new Error('Registration is restricted to Parents and Specialists/Therapists.');
  }

  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        first_name: firstName,
        last_name:  lastName,
        role:       role,
      },
      emailRedirectTo: `${window.location.origin}/auth/callback`,
    },
  });

  if (authError) throw authError;
  if (!authData?.user?.id) {
    throw new Error('Sign up failed: no user returned by Supabase Auth.');
  }

  // Detect duplicate registrations when email confirmation / user enumeration protection is enabled
  const user = authData.user;
  if (user && (!user.identities || user.identities.length === 0)) {
    throw new Error('This email address is already registered. Please sign in instead.');
  }

  // Note: Since email verification is mandatory, the profile row in public.users
  // will be created by the database trigger ONLY after the user confirms their email address.
  return { user: authData.user };
}

// ── signIn ─────────────────────────────────────────────────────────────────────
export async function signIn({ email, password, expectedRole }) {
  try {
    const cleanEmail = (email || '').trim();
    const cleanPassword = (password || '').trim();

    if (!cleanEmail) {
      throw new Error('Email is required.');
    }
    if (!cleanPassword) {
      throw new Error('Password is required.');
    }
    if (!expectedRole) {
      throw new Error('Please select your role before signing in.');
    }

    // Input format validations
    // If it's a learner and they entered a username without '@', convert it to a dummy email behind the scenes
    let finalEmail = cleanEmail;
    if (expectedRole === 'learner' && !cleanEmail.includes('@')) {
      finalEmail = cleanEmail + '@learner.nestureai.com';
    } else {
      validateEmail(finalEmail);
    }
    
    const isLearner = expectedRole === 'learner' || finalEmail.endsWith('@learner.nestureai.com') || finalEmail === 'akhil@example.com';
    validatePassword(cleanPassword, isLearner);

    const authPassword = isLearner ? cleanPassword + '_learner_suffix' : cleanPassword;

    // 1. Authenticate user
    const { data, error } = await supabase.auth.signInWithPassword({ email: finalEmail, password: authPassword });
    if (error) throw error;

    // 2. Strict Email Verification Check
    if (!data.user.email_confirmed_at) {
      await supabase.auth.signOut();
      throw new Error('Please verify your email before continuing.');
    }

    const authUserId = data.user.id;

    // 3. Retrieve database profile
    let profile = null;
    try {
      profile = await getUserProfile(authUserId);
    } catch (err) {
      console.warn('[signIn] Profile not found immediately, trying fallback...');
    }

    // Fallback: create profile manually if missing but authenticated (since email is confirmed)
    if (!profile) {
      const { getChildByEmail } = await import('./supabaseDB.js');
      const child = await getChildByEmail(cleanEmail).catch(() => null);
      try {
        if (child) {
          const { ensureUserRow } = await import('./supabaseDB.js');
          profile = await ensureUserRow(authUserId, child);
          if (profile) profile.role = 'learner';
        } else {
          // Parent or Practitioner: Create the user profile row using their auth metadata
          profile = await ensureUserProfileFallback(data.user, expectedRole);
        }
      } catch (insertErr) {
        console.warn('[signIn] profile creation fallback failed:', insertErr?.message);
        // Last resort: fetch again
        try {
          profile = await getUserProfile(authUserId);
        } catch {
          await supabase.auth.signOut();
          throw new Error('Failed to retrieve or build user profile. Please try again.');
        }
      }
    }

    // Check if account is active
    if (profile.is_active === false) {
      await supabase.auth.signOut();
      throw new Error('This account has been deactivated. Please contact the administrator.');
    }

    // 4. Strict Role Validation & Mismatch Protection
    if (profile.role !== expectedRole) {
      await supabase.auth.signOut();
      throw new Error(`Unauthorized access: This account is registered as a "${profile.role}", but you tried to sign in as a "${expectedRole}".`);
    }

    // 5. For learner accounts, resolve their child_id
    if (profile.role === 'learner' && !profile.learner_id) {
      const { getChildByAuthUserId, getChildByEmail: getByEmail } = await import('./supabaseDB.js');
      let child = await getChildByAuthUserId(authUserId).catch(() => null);
      if (!child) {
        child = await getByEmail(cleanEmail).catch(() => null);
      }
      if (child) {
        profile.learner_id = child.id;
        if (child.avatar_url && !profile.avatar_url) profile.avatar_url = child.avatar_url;
      }
    }

    // 6. Return standard auth data plus the must_reset_password flag for frontend redirection
    return { 
      user: data.user, 
      profile, 
      mustResetPassword: profile.must_reset_password === true 
    };
  } catch (err) {
    // Required fields errors (UX level checks) propagate directly
    const isRequiredErr =
      err.message === 'Email is required.' ||
      err.message === 'Password is required.' ||
      err.message === 'Please select your role before signing in.' ||
      err.message === 'Please verify your email before continuing.';

    if (isRequiredErr) {
      throw err;
    }

    // Technical/auth errors are mapped to generic/network message
    throw handleAuthError(err, { email, expectedRole });
  }
}

// ── signInAsLearner (Maintained for backward compatibility, mapped to signIn) ──
export async function signInAsLearner({ email, password }) {
  return signIn({ email, password, expectedRole: 'learner' });
}

// ── signOut ────────────────────────────────────────────────────────────────────
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  
  // Strict cleanup: Clear session storage and all local storage to avoid cross-child or cross-session leak
  sessionStorage.clear();
  localStorage.clear();

  if (error) throw error;
}

// ── restoreSession ─────────────────────────────────────────────────────────────
export async function restoreSession() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return null;

    // Block session recovery if email is not confirmed
    if (!session.user.email_confirmed_at) {
      await supabase.auth.signOut();
      return null;
    }

    const authUserId = session.user.id;

    let profile = null;
    try {
      profile = await getUserProfile(authUserId);
    } catch (err) {
      console.warn('[restoreSession] Profile not found immediately, trying fallback...');
    }

    if (!profile) {
      try {
        const { getChildByAuthUserId, ensureUserRow } = await import('./supabaseDB.js');
        const child = await getChildByAuthUserId(authUserId).catch(() => null);
        if (child) {
          profile = await ensureUserRow(authUserId, child).catch(() => null);
          if (profile) {
            profile.role = 'learner';
            profile.learner_id = child.id;
          }
        } else {
          // Fallback: create profile from session user metadata if they are not a child
          profile = await ensureUserProfileFallback(session.user).catch(() => null);
        }
      } catch {
        // Silent fail
      }
      if (!profile) return null;
    }

    if (profile.is_active === false) {
      await supabase.auth.signOut();
      return null;
    }

    if (profile.role === 'learner' && !profile.learner_id) {
      const { getChildByAuthUserId, getChildByEmail } = await import('./supabaseDB.js');
      let child = await getChildByAuthUserId(authUserId).catch(() => null);
      if (!child && session?.user?.email) {
        child = await getChildByEmail(session.user.email).catch(() => null);
      }
      if (child) {
        profile.learner_id = child.id;
        if (child.avatar_url && !profile.avatar_url) profile.avatar_url = child.avatar_url;
      }
    }

    return { user: session.user, profile };
  } catch (globalErr) {
    console.error('[restoreSession] Failed to restore session globally:', globalErr);
    return null;
  }
}

// ── resetPassword ──────────────────────────────────────────────────────────────
export async function resetPassword(email) {
  validateEmail(email);
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`,
  });
  if (error) throw error;
}

// ── revokeConsentForPractitioner ──────────────────────────────────────────────
export async function revokeConsentForPractitioner(parentId, practitionerId) {
  const now = new Date().toISOString();

  await supabase
    .from('consent')
    .update({
      withdrawal_at: now,
      withdrawn_practitioners: supabase.rpc('jsonb_set_practitioner', {
        p_id: practitionerId,
        p_ts: now,
      }),
    })
    .eq('parent_id', parentId);

  await supabase
    .from('practitioner_children')
    .delete()
    .eq('practitioner_id', practitionerId);
}

// ── submitFeedback ────────────────────────────────────────────────────────────
export async function submitFeedback({ userId, feature, comment, rating, sessionNumber }) {
  const { error } = await supabase.from('feedback').insert([{
    user_id:        userId,
    feature,
    comment:        comment || null,
    rating:         rating  || null,
    session_number: sessionNumber || null,
  }]);
  if (error) throw error;
}
