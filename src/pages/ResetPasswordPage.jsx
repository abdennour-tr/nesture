import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { Lock, Eye, EyeOff, ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../store';
import { supabase } from '../services/supabaseClient';
import { getRouteForRole } from '../services/authService';
import api from '../services/api';
import { validatePassword } from '../utils/security';
import BetaFooter from '../components/shared/BetaFooter';

export default function ResetPasswordPage() {
  const { user, profile, updateProfile } = useAuthStore();
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [isLearner, setIsLearner] = useState(false);
  const [userRole, setUserRole] = useState('');
  const [userId, setUserId] = useState(null);
  const [isValidLink, setIsValidLink] = useState(null);
  const [isForced, setIsForced] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    async function checkUser() {
      try {
        const query = new URLSearchParams(window.location.search);
        const code = query.get('code');
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        }

        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const role = user.user_metadata?.role || '';
          const email = user.email || '';
          setIsLearner(role === 'learner' || email.endsWith('@learner.nestureai.com'));
          setUserRole(role);
          setUserId(user.id);
          setIsForced(query.get('forced') === 'true' || query.get('type') === 'invitation');
          setIsValidLink(true);
        } else {
          setIsValidLink(false);
        }
      } catch (err) {
        console.warn('Failed to check authenticated user role:', err);
        setIsValidLink(false);
      }
    }
    checkUser();
  }, []);

  const handlePasswordChange = (val) => {
    setPassword(val);
    if (!val) {
      setPasswordError('');
    } else {
      try {
        validatePassword(val, isLearner);
        setPasswordError('');
      } catch (err) {
        setPasswordError(err.message);
      }
    }
  };

  const handlePasswordBlur = () => {
    const trimmed = password.trim();
    setPassword(trimmed);
    if (!trimmed) {
      setPasswordError(t('auth.passwordRequired', 'Password is required.'));
    } else {
      try {
        validatePassword(trimmed, isLearner);
        setPasswordError('');
      } catch (err) {
        setPasswordError(err.message);
      }
    }
  };

  const handleConfirmChange = (val) => {
    setConfirm(val);
    if (!val) {
      setConfirmError('');
    } else {
      if (password && val !== password) {
        setConfirmError(t('auth.passwordsDoNotMatch', 'Passwords do not match.'));
      } else {
        setConfirmError('');
      }
    }
  };

  const handleConfirmBlur = () => {
    const trimmed = confirm.trim();
    setConfirm(trimmed);
    if (trimmed !== password) {
      setConfirmError(t('auth.passwordsDoNotMatch', 'Passwords do not match.'));
    } else {
      setConfirmError('');
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setError('');

    const cleanPassword = password.trim();
    const cleanConfirm = confirm.trim();

    setPassword(cleanPassword);
    setConfirm(cleanConfirm);

    // Validations
    if (cleanPassword !== cleanConfirm) {
      setError(t('auth.passwordsDoNotMatch', 'Passwords do not match.'));
      return;
    }

    try {
      validatePassword(cleanPassword, isLearner);
    } catch (valErr) {
      setError(valErr.message);
      return;
    }

    setLoading(true);

    try {
      const authPassword = isLearner ? cleanPassword + '_learner_suffix' : cleanPassword;
      const { error: resetErr } = await supabase.auth.updateUser({
        password: authPassword
      });

      if (resetErr) throw resetErr;

      if (isForced && userId) {
        try {
          await api.put('/users/accept-invitation', { userId });
          updateProfile({ must_reset_password: false });
        } catch (acceptErr) {
          console.warn('Failed to accept invitation formally:', acceptErr);
        }
        toast.success(t('auth.passwordSetSuccess', 'Password set successfully. Welcome!'));
        setTimeout(() => {
          navigate(getRouteForRole(userRole));
        }, 1000);
      } else {
        toast.success(t('auth.passwordResetSuccess', 'Password updated successfully.'));
        setTimeout(() => {
          navigate('/login');
        }, 1000);
      }
    } catch (err) {
      setError(err?.message || t('auth.passwordResetFailed', 'Failed to reset password. Please request a new reset link.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div style={s.root} className="rp-root">
        <NeuralNetSVG />
        <motion.div 
          style={s.card} 
          className="rp-card" 
          initial={{ opacity: 0, y: 24 }} 
          animate={{ opacity: 1, y: 0 }} 
          transition={{ duration: 0.5 }}
        >
          <div style={s.logoRow}>
            <img src="/logo.png" alt="NestureAI Logo" style={{ width: 36, height: 36, objectFit: 'contain' }} />
            <div style={{ ...s.logoName, whiteSpace: 'nowrap' }}>
              <span style={{ color: '#0D5E6B' }}>Nesture</span>
              <span style={{ color: '#F59E0B' }}>AI</span>
            </div>
          </div>

          {isValidLink === null ? (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
               <div className="spinner" style={{ margin: '0 auto' }} />
               <p style={{ marginTop: 16, color: '#6B7280' }}>{t('auth.verifyingLink', 'Verifying secure link...')}</p>
            </div>
          ) : isValidLink === false ? (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
               <h2 style={{...s.title, color: '#EF4444', marginBottom: 16 }}>{t('auth.invalidLink', 'Invalid or expired reset link.')}</h2>
               <p style={s.sub}>{t('auth.invalidLinkDesc', 'Please request a new password reset link from the login page.')}</p>
               <button type="button" onClick={() => navigate('/login')} style={{ ...s.btn, marginTop: 24 }}>
                 {t('auth.backToLogin', 'Back to Login')}
               </button>
            </div>
          ) : (
            <>
              <div style={s.formHeader}>
                <h2 style={s.title}>{isForced ? t('auth.welcomeSetPassword', 'Welcome! Set Your Password') : t('auth.chooseNewPassword', 'Choose New Password')}</h2>
                <p style={s.sub}>{isForced ? t('auth.firstLoginPrompt', 'Please set a secure password to complete your account registration.') : t('auth.typeSecurePassword', 'Type a secure password for your NestureAI account.')}</p>
              </div>

              <form onSubmit={handleResetPassword} style={s.form}>
                {/* New Password */}
                <div style={s.field}>
                  <label style={s.label}>{t('auth.newPassword', 'New Password')}</label>
                  <div style={{ ...s.inputGroup, position: 'relative' }}>
                    <Lock size={18} color="#6B7280" style={s.inputIcon} />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => handlePasswordChange(e.target.value)}
                      onBlur={handlePasswordBlur}
                      placeholder="Min. 8 characters"
                      style={{ ...s.input, paddingRight: 40 }}
                      required
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      style={s.eyeButton}
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  {passwordError && <div style={s.inlineError}>{passwordError}</div>}
                </div>

                {/* Confirm Password */}
                <div style={s.field}>
                  <label style={s.label}>{t('auth.confirmNewPassword', 'Confirm New Password')}</label>
                  <div style={{ ...s.inputGroup, position: 'relative' }}>
                    <Lock size={18} color="#6B7280" style={s.inputIcon} />
                    <input
                      type={showConfirm ? 'text' : 'password'}
                      value={confirm}
                      onChange={(e) => handleConfirmChange(e.target.value)}
                      onBlur={handleConfirmBlur}
                      placeholder="••••••••"
                      style={{ ...s.input, paddingRight: 40 }}
                      required
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirm(!showConfirm)}
                      style={s.eyeButton}
                    >
                      {showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  {confirmError && <div style={s.inlineError}>{confirmError}</div>}
                </div>

                {error && <p style={s.errorMsg}>{error}</p>}

                <button type="submit" disabled={loading || !!passwordError || !!confirmError} style={{ ...s.btn, opacity: (loading || !!passwordError || !!confirmError) ? 0.6 : 1 }}>
                  {loading ? t('auth.updatingPassword', 'Updating Password…') : (
                    <>{t('auth.updatePassword', 'Update Password')} <ArrowRight size={18} /></>
                  )}
                </button>
              </form>
            </>
          )}

          <BetaFooter variant="light" />
        </motion.div>
      </div>

      <style>{`
        @media (max-width: 600px) {
          .rp-card {
            padding: 24px 20px !important;
            border-radius: 16px !important;
          }
        }
      `}</style>
    </>
  );
}

// ── Animated Premium Background SVG ──
const NeuralNetSVG = () => (
  <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
    <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="grid" width="120" height="120" patternUnits="userSpaceOnUse">
          <circle cx="20" cy="20" r="1.5" fill="#14B8A6" opacity="0.4" />
          <circle cx="80" cy="80" r="2.5" fill="#F59E0B" opacity="0.5" />
          <circle cx="100" cy="40" r="1.5" fill="#14B8A6" opacity="0.4" />
          <path d="M20 20 L80 80 L100 40" stroke="url(#lineGrad)" strokeWidth="1" fill="none" opacity="0.3" />
        </pattern>
        <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#14B8A6" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#F59E0B" stopOpacity="0.8" />
        </linearGradient>
        <radialGradient id="glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#0D5E6B" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#0D5E6B" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#grid)" />
      <circle cx="50%" cy="50%" r="55%" fill="url(#glow)" />
    </svg>
  </div>
);

const s = {
  root: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '40px 16px',
    background: 'linear-gradient(135deg, #F0F4F8 0%, #E2E8F0 100%)',
    position: 'relative',
    overflow: 'hidden'
  },
  card: {
    background: '#fff',
    borderRadius: 20,
    boxShadow: '0 12px 48px rgba(0,0,0,0.1)',
    padding: '40px',
    width: '100%',
    maxWidth: 460,
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
    zIndex: 10
  },
  logoRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10
  },
  logoName: {
    fontFamily: 'Inter, sans-serif',
    fontWeight: 800,
    fontSize: '1rem',
    color: '#0D5E6B'
  },
  formHeader: {
    marginBottom: 4,
    textAlign: 'left'
  },
  title: {
    fontFamily: 'Inter, sans-serif',
    fontSize: '1.4rem',
    fontWeight: 800,
    color: '#0D5E6B',
    margin: 0,
    letterSpacing: '-0.02em'
  },
  sub: {
    fontSize: '0.875rem',
    color: '#6B7280',
    margin: '4px 0 0 0',
    lineHeight: 1.5
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6
  },
  label: {
    fontSize: '0.78rem',
    fontWeight: 600,
    color: '#374151',
    textTransform: 'uppercase',
    letterSpacing: '0.05em'
  },
  inputGroup: {
    display: 'flex',
    alignItems: 'center',
    width: '100%'
  },
  inputIcon: {
    position: 'absolute',
    left: 14,
    color: '#9CA3AF'
  },
  input: {
    width: '100%',
    padding: '11px 14px 11px 42px',
    borderRadius: 10,
    border: '1.5px solid #D1D5DB',
    fontSize: '0.9rem',
    color: '#1F2937',
    background: '#fff',
    outline: 'none',
    boxSizing: 'border-box'
  },
  eyeButton: {
    position: 'absolute',
    right: 12,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: '#9CA3AF',
    display: 'flex',
    alignItems: 'center',
    padding: 0
  },
  errorMsg: {
    fontSize: '0.82rem',
    color: '#EF4444',
    background: '#FEF2F2',
    border: '1px solid #FECACA',
    borderRadius: 8,
    padding: '8px 12px',
    margin: 0
  },
  btn: {
    width: '100%',
    padding: '13px',
    background: 'linear-gradient(135deg, #0D5E6B, #1A8FA0)',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    fontFamily: 'Inter, sans-serif',
    fontWeight: 700,
    fontSize: '0.95rem',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    transition: 'all 0.2s',
    boxShadow: '0 4px 14px rgba(13, 94, 107, 0.25)'
  },
  inlineError: {
    color: '#EF4444',
    fontSize: '0.75rem',
    marginTop: 4,
    marginBottom: 4,
    textAlign: 'left'
  }
};
