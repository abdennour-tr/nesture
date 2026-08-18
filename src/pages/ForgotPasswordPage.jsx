import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { resetPassword } from '../services/authService';
import { validateEmail } from '../utils/security';
import BetaFooter from '../components/shared/BetaFooter';

export default function ForgotPasswordPage() {
  const [email,   setEmail]   = useState('');
  const [sent,    setSent]    = useState(false);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [emailError, setEmailError] = useState('');

  const handleEmailChange = (val) => {
    setEmail(val);
    if (!val) {
      setEmailError('');
    } else {
      try {
        validateEmail(val);
        setEmailError('');
      } catch (err) {
        setEmailError(err.message);
      }
    }
  };

  const handleEmailBlur = () => {
    const trimmed = email.trim();
    setEmail(trimmed);
    if (!trimmed) {
      setEmailError('Email address is required.');
    } else {
      try {
        validateEmail(trimmed);
        setEmailError('');
      } catch (err) {
        setEmailError(err.message);
      }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const cleanEmail = email.trim();
    setEmail(cleanEmail);

    try {
      validateEmail(cleanEmail);
    } catch (valErr) {
      setEmailError(valErr.message);
      return;
    }

    setLoading(true);
    setError('');
    try {
      await resetPassword(cleanEmail);
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={s.root} className="fp-root">
      <motion.div style={s.card} className="fp-card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <div style={s.logoRow}>
          <img src="/logo.png" alt="NestureAI Logo" style={{ width: 36, height: 36, objectFit: 'contain' }} />
          <div style={{ ...s.logoName, whiteSpace: 'nowrap' }}>
            <span style={{ color: '#0D5E6B' }}>Nesture</span>
            <span style={{ color: '#F59E0B' }}>AI</span>
          </div>
        </div>

        {!sent ? (
          <>
            <h2 style={s.title}>Reset your password</h2>
            <p style={s.sub}>Enter your email and we'll send you a link to reset your password.</p>

            <form onSubmit={handleSubmit} style={s.form}>
              <div style={s.field}>
                <label style={s.label}>Email address</label>
                <input style={s.input} type="email" value={email}
                  onChange={(e) => handleEmailChange(e.target.value)}
                  onBlur={handleEmailBlur}
                  required placeholder="you@example.com" />
              </div>
              {emailError && <div style={s.inlineError}>{emailError}</div>}
              {error && <p style={s.errorMsg}>{error}</p>}
              <button type="submit" disabled={loading || !!emailError} style={{ ...s.btn, opacity: (loading || !!emailError) ? 0.6 : 1 }}>
                {loading ? 'Sending…' : 'Send Reset Link'}
              </button>
            </form>
          </>
        ) : (
          <motion.div style={s.successBox} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <div style={{ fontSize: '2.5rem' }}>📬</div>
            <h2 style={{ ...s.title, textAlign: 'center' }}>Check your email</h2>
            <p style={{ ...s.sub, textAlign: 'center' }}>
              We sent a password reset link to <strong>{email}</strong>.<br />
              Check your inbox and follow the link to reset your password.
            </p>
            <button onClick={() => { setSent(false); setEmail(''); }} style={{ ...s.btn, background: '#F3F4F6', color: '#374151' }}>
              Send again
            </button>
          </motion.div>
        )}

        <p style={s.backLink}>
          <Link to="/login" style={s.link}>← Back to Sign In</Link>
        </p>

        <BetaFooter />
        <style>{`
          @media (max-width: 600px) {
            .fp-card {
              padding: 24px 20px !important;
              gap: 16px !important;
            }
          }
        `}</style>
      </motion.div>
    </div>
  );
}

const s = {
  root:       { minHeight: '100vh', background: '#F0F4F8', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 16px' },
  card:       { background: '#fff', borderRadius: 20, boxShadow: '0 12px 48px rgba(0,0,0,0.1)', padding: '40px', width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 20 },
  logoRow:    { display: 'flex', alignItems: 'center', gap: 10 },
  logoIcon:   { width: 36, height: 36, background: '#E8841A', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: '#fff', fontSize: 18 },
  logoName:   { fontFamily: 'Inter, sans-serif', fontWeight: 800, fontSize: '1rem', color: '#0D5E6B' },
  title:      { fontFamily: 'Inter, sans-serif', fontSize: '1.4rem', fontWeight: 800, color: '#0D5E6B', margin: 0 },
  sub:        { fontSize: '0.875rem', color: '#6B7280', margin: 0, lineHeight: 1.6 },
  form:       { display: 'flex', flexDirection: 'column', gap: 14 },
  field:      { display: 'flex', flexDirection: 'column', gap: 6 },
  label:      { fontSize: '0.78rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em' },
  input:      { padding: '11px 14px', borderRadius: 10, border: '1.5px solid #D1D5DB', fontSize: '0.9rem', color: '#1F2937', background: '#fff' },
  errorMsg:   { fontSize: '0.82rem', color: '#EF4444', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '8px 12px', margin: 0 },
  btn:        { padding: '12px', background: 'linear-gradient(135deg, #0D5E6B, #1A8FA0)', color: '#fff', border: 'none', borderRadius: 10, fontFamily: 'Inter, sans-serif', fontWeight: 700, fontSize: '0.95rem', cursor: 'pointer' },
  successBox: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 },
  backLink:   { textAlign: 'center', fontSize: '0.82rem', margin: 0 },
  link:       { color: '#0D5E6B', fontWeight: 600, textDecoration: 'none' },
  inlineError: {
    color: '#EF4444',
    fontSize: '0.75rem',
    marginTop: -8,
    marginBottom: 4,
    textAlign: 'left'
  }
};
