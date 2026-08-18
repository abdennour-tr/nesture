import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { supabase } from '../services/supabaseClient';
import { restoreSession, getRouteForRole } from '../services/authService';
import { useAuthStore } from '../store';
import { AlertCircle, LogIn } from 'lucide-react';

export default function AuthCallbackPage() {
  const [errorMsg, setErrorMsg] = useState('');
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);

  useEffect(() => {
    async function handleCallback() {
      try {
        const query = new URLSearchParams(window.location.search);
        const code = query.get('code');
        const next = query.get('next') || '';

        // 1. Exchanger le code si présent dans l'URL (flux PKCE)
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        }

        // 2. Restaurer la session et récupérer le profil utilisateur
        const session = await restoreSession();
        if (session) {
          setAuth({ user: session.user, profile: session.profile });
          toast.success(`Welcome, ${session.profile.first_name || 'User'}! Account activated.`);
          
          // Rediriger vers la page demandée ou le dashboard correspondant au rôle
          if (next) {
            navigate(next, { replace: true });
          } else {
            navigate(getRouteForRole(session.profile.role), { replace: true });
          }
        } else {
          throw new Error('Failed to restore verified session. Please log in.');
        }
      } catch (err) {
        console.error('[AuthCallback] Error:', err);
        setErrorMsg(err.message || 'Verification link is invalid or expired.');
        toast.error('Activation failed. Please check the link or log in.');
      }
    }

    handleCallback();
  }, [navigate, setAuth]);

  if (errorMsg) {
    return (
      <div style={s.root} className="ac-root">
        <NeuralNetSVG />
        <div style={s.card} className="ac-card">
          <div style={s.logoRow}>
            <img src="/logo.png" alt="NestureAI Logo" style={{ width: 36, height: 36, objectFit: 'contain' }} />
            <div style={s.logoName}>
              <span style={{ color: '#0D5E6B' }}>Nesture</span>
              <span style={{ color: '#F59E0B' }}>AI</span>
            </div>
          </div>
          <div style={s.errorContainer}>
            <div style={s.iconContainer}>
              <AlertCircle size={32} color="#EF4444" />
            </div>
            <h2 style={s.title}>Verification Failed</h2>
            <p style={s.sub}>{errorMsg}</p>
          </div>
          <button 
            onClick={() => navigate('/login')} 
            style={s.btn}
          >
            <LogIn size={18} /> Back to Sign In
          </button>
        </div>
      </div>
    );
  }

  // Loading state (beautiful loader spinner)
  return (
    <div style={s.root} className="ac-root">
      <NeuralNetSVG />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}>
        <div style={{ position: 'relative', width: 90, height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="spinner-ring ring-1"></div>
          <div className="spinner-ring ring-2"></div>
          <div className="spinner-ring ring-3"></div>
          <div style={{ 
            width: 24, height: 24, borderRadius: '50%', 
            background: 'linear-gradient(135deg, #1A8FA0, #E8841A)',
            boxShadow: '0 0 25px rgba(26, 143, 160, 0.8)'
          }}></div>
        </div>
        
        <div style={{ 
          marginTop: 36, fontFamily: 'Inter, sans-serif', 
          fontSize: '1.25rem', fontWeight: 800, color: '#0D5E6B',
          letterSpacing: '0.2em', textTransform: 'uppercase'
        }}>
          Nesture<span style={{ color: '#1A8FA0' }}>AI</span>
        </div>
        
        <div style={{
          marginTop: 14, fontSize: '0.85rem', color: '#6B7280',
          display: 'flex', gap: 10, alignItems: 'center',
          fontFamily: 'Inter, sans-serif', fontWeight: 500
        }}>
          Activating account session
          <div className="dot-pulse"></div>
        </div>
      </div>

      <style>{`
        .spinner-ring {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          border: 2px solid transparent;
        }
        .ring-1 {
          border-top-color: #1A8FA0;
          border-left-color: rgba(26, 143, 160, 0.2);
          animation: spin 1.8s cubic-bezier(0.68, -0.55, 0.265, 1.55) infinite;
        }
        .ring-2 {
          inset: 12px;
          border-bottom-color: #E8841A;
          border-right-color: rgba(232, 132, 26, 0.2);
          animation: spin-reverse 2.2s cubic-bezier(0.68, -0.55, 0.265, 1.55) infinite;
        }
        .ring-3 {
          inset: 24px;
          border-top-color: rgba(0, 0, 0, 0.2);
          animation: spin 3s linear infinite;
        }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        @keyframes spin-reverse { 0% { transform: rotate(360deg); } 100% { transform: rotate(0deg); } }
        
        .dot-pulse {
          position: relative;
          width: 4px; height: 4px;
          border-radius: 50%;
          background: currentColor;
          animation: pulse 1.5s infinite;
        }
        .dot-pulse::before, .dot-pulse::after {
          content: '';
          position: absolute;
          top: 0;
          width: 4px; height: 4px;
          border-radius: 50%;
          background: currentColor;
        }
        .dot-pulse::before { left: -10px; animation: pulse-before 1.5s infinite; }
        .dot-pulse::after { left: 10px; animation: pulse-after 1.5s infinite; }
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.8); }
        }
        @keyframes pulse-before {
          0%, 100% { opacity: 0.4; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1); }
        }
        @keyframes pulse-after {
          0%, 100% { opacity: 0.4; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1); }
          75% { opacity: 0.4; transform: scale(0.8); }
        }
      `}</style>
    </div>
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
    maxWidth: 420,
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
  errorContainer: {
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: '50%',
    background: '#FEF2F2',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    border: '1px solid #FEE2E2',
  },
  title: {
    fontFamily: 'Inter, sans-serif',
    fontSize: '1.4rem',
    fontWeight: 800,
    color: '#EF4444',
    margin: 0,
  },
  sub: {
    fontSize: '0.875rem',
    color: '#6B7280',
    margin: '8px 0 0 0',
    lineHeight: 1.5
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
    boxShadow: '0 4px 14px rgba(13, 94, 107, 0.25)',
  }
};
