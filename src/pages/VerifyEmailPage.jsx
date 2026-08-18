import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { Mail, ArrowRight, RefreshCw, LogIn } from 'lucide-react';
import { supabase } from '../services/supabaseClient';
import BetaFooter from '../components/shared/BetaFooter';

export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const email = searchParams.get('email') || '';
  const navigate = useNavigate();

  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    // Cooldown timer tick
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown(prev => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleResend = async () => {
    if (!email) {
      toast.error('Email is missing. Please go back to the login page.');
      return;
    }
    if (cooldown > 0) return;

    setLoading(true);
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (error) throw error;

      toast.success('Verification email resent successfully!');
      setCooldown(60); // 60 seconds cooldown
    } catch (err) {
      toast.error(err.message || 'Failed to resend verification email.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div style={s.root} className="ve-root">
        <NeuralNetSVG />
        <motion.div 
          style={s.card} 
          className="ve-card" 
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

          <div style={s.formHeader}>
            <div style={s.iconContainer}>
              <Mail size={32} color="#0D5E6B" />
            </div>
            <h2 style={s.title}>Verify your email</h2>
            <p style={s.sub}>
              We sent a verification link to your email address:
            </p>
            {email && (
              <div style={s.emailBadge}>
                {email}
              </div>
            )}
            <p style={{ ...s.sub, marginTop: 12 }}>
              Please click the link in the email to activate your account and access your dashboard.
            </p>
          </div>

          <div style={s.actionRow}>
            <button
              onClick={handleResend}
              disabled={loading || cooldown > 0}
              style={{
                ...s.btn,
                opacity: (loading || cooldown > 0) ? 0.6 : 1,
                background: cooldown > 0 ? '#E5E7EB' : 'linear-gradient(135deg, #0D5E6B, #1A8FA0)',
                color: cooldown > 0 ? '#6B7280' : '#fff',
                cursor: (loading || cooldown > 0) ? 'not-allowed' : 'pointer',
                boxShadow: cooldown > 0 ? 'none' : '0 4px 14px rgba(13, 94, 107, 0.25)',
              }}
            >
              {loading ? (
                <>
                  <RefreshCw size={18} className="spin-icon" /> Sending...
                </>
              ) : cooldown > 0 ? (
                `Resend Email (${cooldown}s)`
              ) : (
                <>
                  Resend Verification Email <ArrowRight size={18} />
                </>
              )}
            </button>

            <Link to="/login" style={s.loginLinkBtn}>
              <LogIn size={16} /> Back to Sign In
            </Link>
          </div>

          <BetaFooter variant="light" />
        </motion.div>
      </div>

      <style>{`
        .spin-icon {
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @media (max-width: 600px) {
          .ve-card {
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
    gap: 24,
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
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: '50%',
    background: '#F0FDF4',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    border: '1px solid #DCFCE7',
  },
  title: {
    fontFamily: 'Inter, sans-serif',
    fontSize: '1.5rem',
    fontWeight: 800,
    color: '#0D5E6B',
    margin: 0,
    letterSpacing: '-0.02em'
  },
  sub: {
    fontSize: '0.875rem',
    color: '#6B7280',
    margin: '8px 0 0 0',
    lineHeight: 1.5
  },
  emailBadge: {
    marginTop: 10,
    padding: '6px 12px',
    background: '#EEF2F6',
    borderRadius: 8,
    fontSize: '0.9rem',
    fontWeight: 600,
    color: '#334155',
    border: '1px solid #E2E8F0',
    display: 'inline-block',
    wordBreak: 'break-all',
  },
  actionRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    alignItems: 'stretch',
  },
  btn: {
    width: '100%',
    padding: '13px',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    fontFamily: 'Inter, sans-serif',
    fontWeight: 700,
    fontSize: '0.95rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    transition: 'all 0.2s',
  },
  loginLinkBtn: {
    padding: '12px',
    background: '#F3F4F6',
    color: '#374151',
    borderRadius: 10,
    fontFamily: 'Inter, sans-serif',
    fontWeight: 600,
    fontSize: '0.88rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    textDecoration: 'none',
    transition: 'all 0.2s',
  }
};
