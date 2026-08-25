import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { Activity, Brain, Infinity, Mail, Lock, User as UserIcon, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { useAuthStore } from '../store';
import { getRouteForRole, DEMO_ACCOUNTS } from '../services/authService';
import { validateEmail, validatePassword, validateNickname } from '../utils/security';
import BetaFooter from '../components/shared/BetaFooter';

export default function LoginPage() {
  const [activeRole, setActiveRole] = useState('parent'); // 'parent', 'practitioner', 'learner'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [nickname, setNickname] = useState('');
  const [learnerPwd, setLearnerPwd] = useState('');

  const [showPassword, setShowPassword] = useState(false);
  const [showLearnerPwd, setShowLearnerPwd] = useState(false);

  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');

  const [nicknameError, setNicknameError] = useState('');
  const [learnerPwdError, setLearnerPwdError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { login, isLoading, error, clearError } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => { 
    clearError();
    setEmailError('');
    setPasswordError('');
    setNicknameError('');
    setLearnerPwdError('');
  }, [activeRole, clearError]);

  const handleEmailChange = (val) => {
    setEmail(val);
    setEmailError('');
  };

  const handleEmailBlur = () => {
    const trimmed = email.trim();
    setEmail(trimmed);
    if (!trimmed) {
      setEmailError('Email address is required.');
    } else {
      setEmailError('');
    }
  };

  const handlePasswordChange = (val) => {
    setPassword(val);
    setPasswordError('');
  };

  const handlePasswordBlur = () => {
    const trimmed = password.trim();
    setPassword(trimmed);
    if (!trimmed) {
      setPasswordError('Password is required.');
    } else {
      setPasswordError('');
    }
  };

  const handleNicknameChange = (val) => {
    setNickname(val);
    setNicknameError('');
  };

  const handleNicknameBlur = () => {
    const trimmed = nickname.trim();
    setNickname(trimmed);
    if (!trimmed) {
      setNicknameError('Nickname is required.');
    } else {
      setNicknameError('');
    }
  };

  const handleLearnerPwdChange = (val) => {
    setLearnerPwd(val);
    setLearnerPwdError('');
  };

  const handleLearnerPwdBlur = () => {
    const trimmed = learnerPwd.trim();
    setLearnerPwd(trimmed);
    if (!trimmed) {
      setLearnerPwdError('Password is required.');
    } else {
      setLearnerPwdError('');
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    if (isLoading || isSubmitting) return;

    clearError();

    const cleanEmail = email.trim();
    const cleanPassword = password.trim();

    if (!cleanEmail) {
      setEmailError('Email address is required.');
      return;
    }
    if (!cleanPassword) {
      setPasswordError('Password is required.');
      return;
    }

    const isLearnerEmail = cleanEmail.endsWith('@learner.nestureai.com') || cleanEmail === 'akhil@example.com';
    if (isLearnerEmail) {
      toast.error("This is a Learner account. Please select the 'Learner' tab above to sign in with your nickname.");
      return;
    }

    try {
      setIsSubmitting(true);
      const profile = await login({ email: cleanEmail, password: cleanPassword, expectedRole: activeRole });
      
      // Rediriger vers le dashboard approprié
      navigate(getRouteForRole(activeRole));
    } catch (err) {
      // Error is set in the store and rendered in UI error box
      if (err.message === 'Please verify your email before continuing.') {
        toast.error(err.message);
        navigate(`/verify-email?email=${encodeURIComponent(cleanEmail)}`);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLearnerLogin = async (e) => {
    e.preventDefault();
    if (isLoading || isSubmitting) return;

    clearError();

    const cleanNickname = nickname.trim().toLowerCase();
    const cleanLearnerPwd = learnerPwd.trim();

    if (!cleanNickname) {
      setNicknameError('Nickname is required.');
      return;
    }
    if (!cleanLearnerPwd) {
      setLearnerPwdError('Password is required.');
      return;
    }

    if (cleanNickname.includes('@')) {
      toast.error('Nicknames cannot contain "@" or be email addresses.');
      return;
    }

    try {
      setIsSubmitting(true);
      const demoLearner = (DEMO_ACCOUNTS || []).find(a =>
        a.role === 'learner' &&
        (a.email.split('@')[0].toLowerCase() === cleanNickname || a.label.toLowerCase().includes(cleanNickname))
      );

      const learnerEmail = demoLearner
        ? demoLearner.email
        : `${cleanNickname.replace(/\s+/g, '')}@learner.nestureai.com`;

      const profile = await login({ email: learnerEmail, password: cleanLearnerPwd, expectedRole: 'learner' });
      toast.success(`Welcome, ${profile.first_name || nickname}! 🎮`);
      navigate(getRouteForRole(profile.role));
    } catch (err) {
      // Error is set in the store and rendered in UI error box
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <style>{`
        @media (max-width: 1200px) {
          #left-panel { padding: 3rem 4vw !important; }
          #hero-title { font-size: 2.8rem !important; margin-bottom: 1.5rem !important; }
          #stats-row { gap: 2rem !important; flex-wrap: wrap; }
          #form-wrapper { padding: 2.5rem !important; max-width: 440px !important; }
          #right-sidebar { padding: 2rem !important; }
          #top-group { gap: 2rem !important; }
        }
        @media (max-width: 992px) {
          #login-root { flex-direction: column !important; overflow-y: auto !important; height: auto !important; }
          #left-panel { flex: none !important; padding: 4rem 2rem !important; }
          #right-sidebar { flex: none !important; width: 100% !important; border-left: none !important; border-top: 1px solid rgba(255,255,255,0.05); padding: 4rem 2rem !important; }
          #form-wrapper { max-width: 100% !important; margin: 0 auto; }
        }
        @media (max-width: 600px) {
          #hero-title { font-size: 2rem !important; }
          .responsive-stat { width: 100%; margin-bottom: 1rem; }
          #stats-row { flex-direction: column; gap: 0 !important; }
          #form-wrapper { padding: 1.5rem !important; }
        }
      `}</style>
      <div id="login-root" style={s.root}>
        {/* ── LEFT PANEL: Off-white, Neural Net, Typography ── */}
        <div id="left-panel" style={s.leftPanel}>
          <NeuralNetSVG />

          <div style={s.leftContent}>
            <motion.div
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.1 }}
              style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <img src="/logo.png" alt="NestureAI Logo" style={{ width: 36, height: 36, objectFit: 'contain' }} />
                </div>
                <div style={{ fontFamily: 'Inter, sans-serif', fontWeight: 800, fontSize: '1.8rem', letterSpacing: '-0.03em' }}>
                  <span style={{ color: '#0D5E6B' }}>Nesture</span>
                  <span style={{ color: '#F59E0B' }}>AI</span>
                </div>
              </div>
              <div style={{ color: '#F59E0B', fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: '0.9rem', paddingLeft: '48px', marginTop: '-6px' }}>
                Transforming Movement into Communication
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.2 }}
              style={s.heroContent}
            >
              <h1 id="hero-title" style={s.heroTitle}>
                Decoding <span style={s.accentCopper}>Neuro-motor</span><br />
                Patterns for Better<br />
                Communication.
              </h1>
              <p style={s.heroSub}>
                The ultra-modern, evidence-backed intelligence platform designed exclusively for neurodiverse minds and their care teams.
              </p>
            </motion.div>

            {/* Footer Stats */}
            <motion.div
              id="stats-row"
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.3 }}
              style={s.statsRow}
            >
              <div className="responsive-stat" style={s.statBox}>
                <div style={s.statIconWrap}><Activity size={18} color="#D97706" /></div>
                <div>
                  <div style={s.statValue}>194x</div>
                  <div style={s.statLabel}>More Affordable</div>
                </div>
              </div>
              <div className="responsive-stat" style={s.statBox}>
                <div style={s.statIconWrap}><Brain size={18} color="#0D5E6B" /></div>
                <div>
                  <div style={s.statValue}>6</div>
                  <div style={s.statLabel}>Reflex Patterns</div>
                </div>
              </div>
              <div className="responsive-stat" style={s.statBox}>
                <div style={s.statIconWrap}><Infinity size={18} color="#10B981" /></div>
                <div>
                  <div style={s.statValue}>∞</div>
                  <div style={s.statLabel}>Practice Sessions</div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>

        {/* ── RIGHT PANEL: Deep Dark Teal Sidebar ── */}
        <div id="right-sidebar" style={s.rightSidebar}>
          <motion.div
            id="form-wrapper"
            initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.8, delay: 0.4, type: 'spring', damping: 25 }}
            style={s.formWrapper}
          >

            {/* 3-Role tab selection */}
            <div style={s.modeToggleGlass}>
              <button
                type="button"
                onClick={() => { setActiveRole('parent'); }}
                style={{ ...s.modeBtn, ...(activeRole === 'parent' ? s.modeBtnActive : {}) }}
              >
                Parent
              </button>
              <button
                type="button"
                onClick={() => { setActiveRole('practitioner'); }}
                style={{ ...s.modeBtn, ...(activeRole === 'practitioner' ? s.modeBtnActive : {}) }}
              >
                Specialist
              </button>
              <button
                type="button"
                onClick={() => { setActiveRole('learner'); }}
                style={{ ...s.modeBtn, ...(activeRole === 'learner' ? s.modeBtnActive : {}) }}
              >
                Learner
              </button>
            </div>

            <div style={s.formHeader}>
              <h2 style={s.formTitle}>
                {activeRole === 'parent' && 'Parent Sign In'}
                {activeRole === 'practitioner' && 'Specialist Sign In'}
                {activeRole === 'learner' && 'Learner Playroom'}
              </h2>
              <p style={s.formSubline}>
                {activeRole === 'parent' && 'Access your secure family dashboard.'}
                {activeRole === 'practitioner' && 'Review reflex tracking logs & assessments.'}
                {activeRole === 'learner' && 'Enter your unique nickname to start playing.'}
              </p>
            </div>

            <AnimatePresence mode="wait">
              {activeRole !== 'learner' ? (
                <motion.form
                  key="standard"
                  initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.3 }}
                  onSubmit={handleLogin} style={s.form}
                  noValidate
                >
                  <div style={s.inputGroup}>
                    <Mail size={18} color="#6B7280" style={s.inputIcon} />
                    <input
                      type="email" 
                      value={email} 
                      onChange={(e) => handleEmailChange(e.target.value)}
                      onBlur={handleEmailBlur}
                      placeholder="Email address" 
                      style={s.input} 
                      required
                      readOnly
                      onFocus={(e) => e.target.removeAttribute('readonly')}
                      autoComplete="off"
                      disabled={isLoading || isSubmitting}
                    />
                  </div>
                  {emailError && <div style={s.inlineError}>{emailError}</div>}
                  
                  <div style={{ ...s.inputGroup, position: 'relative' }}>
                    <Lock size={18} color="#6B7280" style={s.inputIcon} />
                    <input
                      type={showPassword ? 'text' : 'password'} 
                      value={password} 
                      onChange={(e) => handlePasswordChange(e.target.value)}
                      onBlur={handlePasswordBlur}
                      placeholder="Password" 
                      style={{ ...s.input, paddingRight: 40 }} 
                      required
                      readOnly
                      onFocus={(e) => e.target.removeAttribute('readonly')}
                      autoComplete="off"
                      disabled={isLoading || isSubmitting}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      style={s.eyeBtn}
                      disabled={isLoading || isSubmitting}
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  {passwordError && <div style={s.inlineError}>{passwordError}</div>}

                  {error && (
                    <div style={s.errorBox}>
                      {error}
                    </div>
                  )}

                  <div style={s.forgotLinkWrap}>
                    <Link to="/forgot-password" style={s.forgotLink}>Forgot password?</Link>
                  </div>

                  <button type="submit" disabled={isLoading || isSubmitting || !!emailError || !!passwordError} style={{ ...s.submitBtn, opacity: (isLoading || isSubmitting || !!emailError || !!passwordError) ? 0.6 : 1 }}>
                    {(isLoading || isSubmitting) ? 'Signing in...' : (
                      <>Sign In <ArrowRight size={18} /></>
                    )}
                  </button>
                </motion.form>
              ) : (
                <motion.form
                  key="learner"
                  initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.3 }}
                  onSubmit={handleLearnerLogin} style={s.form}
                  noValidate
                >
                  <div style={s.inputGroup}>
                    <UserIcon size={18} color="#6B7280" style={s.inputIcon} />
                    <input
                      type="text" 
                      value={nickname} 
                      onChange={(e) => handleNicknameChange(e.target.value)}
                      onBlur={handleNicknameBlur}
                      placeholder="Learner Nickname" 
                      style={s.input} 
                      required
                      readOnly
                      onFocus={(e) => e.target.removeAttribute('readonly')}
                      autoComplete="off"
                      disabled={isLoading || isSubmitting}
                    />
                  </div>
                  {nicknameError && <div style={s.inlineError}>{nicknameError}</div>}

                  <div style={{ ...s.inputGroup, position: 'relative' }}>
                    <Lock size={18} color="#6B7280" style={s.inputIcon} />
                    <input
                      type={showLearnerPwd ? 'text' : 'password'} 
                      value={learnerPwd} 
                      onChange={(e) => handleLearnerPwdChange(e.target.value)}
                      onBlur={handleLearnerPwdBlur}
                      placeholder="Password" 
                      style={{ ...s.input, paddingRight: 40 }} 
                      required
                      readOnly
                      onFocus={(e) => e.target.removeAttribute('readonly')}
                      autoComplete="off"
                      disabled={isLoading || isSubmitting}
                    />
                    <button
                      type="button"
                      onClick={() => setShowLearnerPwd(!showLearnerPwd)}
                      style={s.eyeBtn}
                      disabled={isLoading || isSubmitting}
                    >
                      {showLearnerPwd ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  {learnerPwdError && <div style={s.inlineError}>{learnerPwdError}</div>}

                  {error && (
                    <div style={s.errorBox}>
                      {error}
                    </div>
                  )}

                  <button type="submit" disabled={isLoading || isSubmitting || !!nicknameError || !!learnerPwdError} style={{ ...s.submitBtn, background: '#10B981', color: '#064E3B', boxShadow: '0 8px 32px rgba(16, 185, 129, 0.3)', opacity: (isLoading || isSubmitting || !!nicknameError || !!learnerPwdError) ? 0.6 : 1 }}>
                    {(isLoading || isSubmitting) ? 'Signing in...' : (
                      <>Let's Play <ArrowRight size={18} /></>
                    )}
                  </button>
                </motion.form>
              )}
            </AnimatePresence>

            {/* Dynamic Disclaimer display tailored to selected role */}
            <div style={s.disclaimerBox}>
              {activeRole === 'parent' && (
                <span style={s.disclaimerText}>
                  <strong>Parent Disclaimer:</strong> NestureAI assists parents in understanding their child's motor coordination. Insights are educational only; they do not replace medical advice, diagnoses, or professional assessments.
                </span>
              )}
              {activeRole === 'practitioner' && (
                <span style={s.disclaimerText}>
                  <strong>Specialist Disclaimer:</strong> This workspace is for licensed specialists and therapists. Logs and assessments are supplements and must be validated with professional judgment.
                </span>
              )}
              {activeRole === 'learner' && (
                <span style={s.disclaimerText}>
                  <strong>Welcome Learner!</strong> Log in with your nickname and get ready to play tracking and movement games. Let's make learning active and fun!
                </span>
              )}
            </div>

            {activeRole !== 'learner' && (
              <div style={s.createAccountWrap}>
                <span style={{ color: '#6B7280' }}>Don't have an account? </span>
                <Link to="/signup" style={s.createLink}>Create account</Link>
              </div>
            )}

            <div style={{ marginTop: '1rem' }}>
              <BetaFooter variant="dark" />
            </div>

          </motion.div>
        </div>
      </div>
    </>
  );
}

// ── Animated Background SVG ──
const NeuralNetSVG = () => (
  <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
    <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <pattern id="grid" width="120" height="120" patternUnits="userSpaceOnUse">
          <circle cx="20" cy="20" r="1.5" fill="#14B8A6" opacity="0.4" />
          <circle cx="80" cy="80" r="2.5" fill="#F59E0B" opacity="0.5" />
          <circle cx="100" cy="40" r="1.5" fill="#14B8A6" opacity="0.4" />
          <path d="M20 20 L80 80 L100 40" stroke="url(#lineGrad)" strokeWidth="1" fill="none" opacity="0.3" />
          <path d="M80 80 L20 140" stroke="url(#lineGrad2)" strokeWidth="1" fill="none" opacity="0.3" />
        </pattern>
        <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#14B8A6" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#F59E0B" stopOpacity="0.8" />
        </linearGradient>
        <linearGradient id="lineGrad2" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#0EA5E9" stopOpacity="0.1" />
        </linearGradient>
        <radialGradient id="glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#0D5E6B" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#0D5E6B" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#grid)" />
      <circle cx="20%" cy="40%" r="40%" fill="url(#glow)" />
      <circle cx="80%" cy="80%" r="50%" fill="url(#glow)" />
    </svg>
  </div>
);

const s = {
  root: {
    display: 'flex',
    minHeight: '100vh',
    fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    overflow: 'hidden',
    background: 'linear-gradient(135deg, #020C12 0%, #062831 100%)',
    color: '#FFFFFF',
  },
  leftPanel: {
    flex: 1.1,
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    padding: '2rem 5vw',
  },
  leftContent: {
    position: 'relative',
    zIndex: 1,
    maxWidth: 700,
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
  },
  heroContent: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    margin: 'auto 0',
  },
  heroTitle: {
    fontSize: 'clamp(2.2rem, 3.8vw, 3.6rem)',
    fontWeight: 800,
    color: '#FFFFFF',
    lineHeight: 1.1,
    letterSpacing: '-0.03em',
    marginBottom: '1.5rem',
    textAlign: 'left',
  },
  accentCopper: {
    background: 'linear-gradient(90deg, #F59E0B 0%, #F97316 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  heroSub: {
    fontSize: '1.15rem',
    color: '#9CA3AF',
    lineHeight: 1.6,
    maxWidth: 580,
    fontWeight: 400,
    letterSpacing: '-0.01em',
    textAlign: 'left',
  },
  statsRow: {
    display: 'flex',
    gap: '3rem',
    borderTop: '1px solid rgba(255,255,255,0.08)',
    paddingTop: '2rem',
    marginUp: 'auto',
  },
  statBox: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
  },
  statIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 16,
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.08)',
    boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statValue: {
    fontSize: '1.4rem',
    fontWeight: 800,
    color: '#FFFFFF',
    lineHeight: 1,
    marginBottom: 6,
    letterSpacing: '-0.02em',
  },
  statLabel: {
    fontSize: '0.8rem',
    color: '#9CA3AF',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  rightSidebar: {
    flex: 0.9,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '2rem',
    position: 'relative',
    zIndex: 10,
    background: 'rgba(0, 0, 0, 0.25)',
    backdropFilter: 'blur(30px)',
    borderLeft: '1px solid rgba(255, 255, 255, 0.05)',
  },
  formWrapper: {
    width: '100%',
    maxWidth: 440,
    background: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: 24,
    padding: '2rem',
    boxShadow: '0 24px 64px rgba(0,0,0,0.4)',
  },
  modeToggleGlass: {
    display: 'flex',
    background: 'rgba(0,0,0,0.3)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 100,
    padding: 6,
    marginBottom: '1.5rem',
  },
  modeBtn: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    color: '#9CA3AF',
    padding: '12px 6px',
    borderRadius: 100,
    fontSize: '0.88rem',
    fontWeight: 700,
    cursor: 'pointer',
    textAlign: 'center',
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
  },
  modeBtnActive: {
    background: 'rgba(255,255,255,0.1)',
    color: '#FFFFFF',
    boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
  },
  formHeader: {
    marginBottom: '1.5rem',
    textAlign: 'center',
  },
  formTitle: {
    fontSize: '1.6rem',
    fontWeight: 800,
    color: '#FFFFFF',
    marginBottom: 8,
    letterSpacing: '-0.03em',
  },
  formSubline: {
    fontSize: '0.9rem',
    color: '#9CA3AF',
    lineHeight: 1.4,
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  inputGroup: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
  },
  inputIcon: {
    position: 'absolute',
    left: 16,
  },
  input: {
    width: '100%',
    padding: '13px 16px 13px 44px',
    background: 'rgba(0,0,0,0.2)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 12,
    color: '#FFFFFF',
    fontSize: '0.95rem',
    transition: 'all 0.3s ease',
    outline: 'none',
    boxSizing: 'border-box',
  },
  forgotLinkWrap: {
    display: 'flex',
    justifyContent: 'flex-end',
    marginTop: -4,
  },
  forgotLink: {
    color: '#F59E0B',
    fontSize: '0.88rem',
    textDecoration: 'none',
    fontWeight: 600,
  },
  errorBox: {
    background: 'rgba(239, 68, 68, 0.15)',
    border: '1px solid rgba(239, 68, 68, 0.3)',
    color: '#FCA5A5',
    padding: '12px 14px',
    borderRadius: 12,
    fontSize: '0.9rem',
    fontWeight: 500,
    textAlign: 'center',
  },
  submitBtn: {
    width: '100%',
    padding: '13px',
    background: 'linear-gradient(135deg, #14B8A6 0%, #0D5E6B 100%)',
    color: '#FFFFFF',
    border: 'none',
    borderRadius: 12,
    fontSize: '0.95rem',
    fontWeight: 700,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    transition: 'all 0.3s ease',
    boxShadow: '0 8px 32px rgba(20, 184, 166, 0.3)',
  },
  createAccountWrap: {
    marginTop: '1.25rem',
    textAlign: 'center',
    fontSize: '0.92rem',
  },
  createLink: {
    color: '#FFFFFF',
    fontWeight: 700,
    textDecoration: 'none',
    marginLeft: 6,
    borderBottom: '2px solid rgba(255,255,255,0.3)',
    paddingBottom: 1,
  },
  eyeBtn: {
    position: 'absolute',
    right: 12,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: '#9CA3AF',
    display: 'flex',
    alignItems: 'center',
  },
  disclaimerBox: {
    marginTop: '1.25rem',
    padding: '12px 14px',
    background: 'rgba(13,94,107,0.1)',
    border: '1px solid rgba(13,94,107,0.2)',
    borderRadius: 12,
    fontSize: '0.78rem',
    lineHeight: 1.5,
    color: '#9CA3AF',
    textAlign: 'left',
  },
  disclaimerText: {
    display: 'block',
  },
  inlineError: {
    color: '#FCA5A5',
    fontSize: '0.75rem',
    marginTop: -8,
    marginBottom: 8,
    textAlign: 'left',
    paddingLeft: 4,
  }
};
