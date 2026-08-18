import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import toast, { Toaster } from 'react-hot-toast';
import { useAuthStore } from './store';
import { getRouteForRole } from './services/authService';
import { useSessionManager } from './hooks/useSessionManager';
import { useTranslation } from 'react-i18next';

// Pages
import LoginPage          from './pages/LoginPage';
import SignUpPage         from './pages/SignUpPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import LearnerHome        from './pages/LearnerHome';
import LearnerDashboard   from './pages/LearnerDashboard';
import GamePage           from './pages/GamePage';
import SessionResults     from './pages/SessionResults';
import ParentDashboard    from './pages/ParentDashboard';
import SpecialistDashboard from './pages/SpecialistDashboard';
import LearnerDetail      from './pages/LearnerDetail';
import DifficultySelection from './pages/DifficultySelection';
import PathTracingDifficulty from './pages/PathTracingDifficulty';
import PathTracingGame       from './pages/PathTracingGame';
import AdaptiveDemoPage   from './pages/AdaptiveDemoPage';
import AdminDashboard     from './pages/AdminDashboard';
import ResetPasswordPage  from './pages/ResetPasswordPage';
import ChatPage           from './pages/ChatPage';
import VerifyEmailPage    from './pages/VerifyEmailPage';
import AuthCallbackPage       from './pages/AuthCallbackPage';
import FingerCopyDifficulty   from './pages/FingerCopyDifficulty';
import FingerCopyGame         from './pages/FingerCopyGame';
import PricingPage            from './pages/PricingPage';

import ErrorBoundary from './components/shared/ErrorBoundary';
import './styles/global.css';

// ── Spinner shown while session is being restored ──────────────────────────────
function FullPageSpinner() {
  const { t } = useTranslation();
  return (
    <div style={{ 
      position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', 
      alignItems: 'center', justifyContent: 'center', background: '#0a192f',
      zIndex: 9999
    }}>
      <div style={{ position: 'relative', width: 90, height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {/* Outer glowing rings */}
        <div className="spinner-ring ring-1"></div>
        <div className="spinner-ring ring-2"></div>
        <div className="spinner-ring ring-3"></div>
        {/* Core logo dot */}
        <div style={{ 
          width: 24, height: 24, borderRadius: '50%', 
          background: 'linear-gradient(135deg, #1A8FA0, #E8841A)',
          boxShadow: '0 0 25px rgba(26, 143, 160, 0.8)'
        }}></div>
      </div>
      
      <div style={{ 
        marginTop: 36, fontFamily: 'Inter, sans-serif', 
        fontSize: '1.25rem', fontWeight: 800, color: '#E2E8F0',
        letterSpacing: '0.2em', textTransform: 'uppercase'
      }}>
        Nesture<span style={{ color: '#1A8FA0' }}>AI</span>
      </div>
      
      <div style={{
        marginTop: 14, fontSize: '0.85rem', color: '#94A3B8',
        display: 'flex', gap: 10, alignItems: 'center',
        fontFamily: 'Inter, sans-serif', fontWeight: 500
      }}>
        {t('app.loadingAuth', 'Authenticating session')}
        <div className="dot-pulse"></div>
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
          border-top-color: rgba(255, 255, 255, 0.5);
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
        .dot-pulse::before {
          left: -10px;
          animation: pulse-before 1.5s infinite;
        }
        .dot-pulse::after {
          left: 10px;
          animation: pulse-after 1.5s infinite;
        }
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

// ── Protected route — blocks unauthenticated or wrong-role users ───────────────
function ProtectedRoute({ children, allowedRoles }) {
  const { user, profile, isInitializing } = useAuthStore();
  if (isInitializing) return <FullPageSpinner />;
  if (!user || !profile) return <Navigate to="/login" replace />;
  if (allowedRoles && !allowedRoles.includes(profile.role)) {
    return <Navigate to={getRouteForRole(profile.role)} replace />;
  }
  return children;
}

// ── Public route — redirects already-authenticated users ──────────────────────
function PublicRoute({ children }) {
  const { user, profile, isInitializing } = useAuthStore();
  if (isInitializing) return <FullPageSpinner />;
  if (user && profile) return <Navigate to={getRouteForRole(profile.role)} replace />;
  return children;
}

function ImpersonationBanner() {
  const { user, profile, originalProfile, stopImpersonating } = useAuthStore();
  const navigate = useNavigate();

  if (!originalProfile) return null;

  const handleExit = () => {
    stopImpersonating();
    toast.success('Exited impersonation mode');
    navigate('/admin');
  };

  return (
    <div style={{
      position: 'sticky',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 9999,
      background: 'linear-gradient(90deg, #b45309 0%, #d97706 50%, #b45309 100%)',
      borderBottom: '2px solid #f59e0b',
      color: '#FFFFFF',
      padding: '10px 24px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      boxShadow: '0 4px 15px rgba(0, 0, 0, 0.3)',
      fontFamily: 'Inter, sans-serif',
      fontSize: '0.875rem',
      fontWeight: 500
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ fontSize: '1.25rem', display: 'flex', alignItems: 'center' }}>👁️</span>
        <span style={{ color: '#FEF3C7' }}>
          Impersonation Mode: You are viewing the dashboard of <strong>{profile ? `${profile.first_name || ''} ${profile.last_name || ''}` : 'User'}</strong> ({profile?.role === 'practitioner' ? 'Specialist' : profile?.role})
        </span>
        <span style={{ color: '#FCD34D', fontSize: '0.75rem', marginLeft: '10px', background: 'rgba(0,0,0,0.2)', padding: '2px 8px', borderRadius: '4px' }}>
          Original Admin: {user?.email || originalProfile?.email || 'nesture.admin.secure.2026@gmail.com'}
        </span>
      </div>
      <button 
        onClick={handleExit}
        style={{
          background: '#ffffff',
          border: 'none',
          borderRadius: '6px',
          color: '#b45309',
          padding: '6px 14px',
          fontSize: '0.8rem',
          fontWeight: 700,
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
        }}
        onMouseEnter={(e) => {
          e.target.style.background = '#fef3c7';
          e.target.style.transform = 'translateY(-1px)';
        }}
        onMouseLeave={(e) => {
          e.target.style.background = '#ffffff';
          e.target.style.transform = 'translateY(0)';
        }}
      >
        Exit Impersonation
      </button>
    </div>
  );
}

export default function App() {
  const init = useAuthStore((s) => s.init);
  
  // Manage inactivity timeout and session cleanup
  const { timeoutModal } = useSessionManager();

  useEffect(() => {
    init();
  }, [init]);

  return (
    <ErrorBoundary>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ImpersonationBanner />
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              fontFamily: 'Inter, sans-serif',
              borderRadius: '12px',
              background: '#1F2937',
              color: '#fff',
            },
          }}
        />
        <Routes>
          {/* Public routes */}
          <Route path="/login"            element={<PublicRoute><LoginPage /></PublicRoute>} />
          <Route path="/signup"           element={<PublicRoute><SignUpPage /></PublicRoute>} />
          <Route path="/verify-email"     element={<VerifyEmailPage />} />
          <Route path="/auth/callback"    element={<AuthCallbackPage />} />
          <Route path="/forgot-password"  element={<PublicRoute><ForgotPasswordPage /></PublicRoute>} />
          <Route path="/reset-password"   element={<ResetPasswordPage />} />
          <Route path="/pricing"          element={<PricingPage />} />
          <Route path="/checkout/success" element={<Navigate to="/parent?payment=success" replace />} />
          <Route path="/demo/alex"        element={<AdaptiveDemoPage />} />

          {/* Learner routes */}
          <Route path="/play" element={
            <ProtectedRoute allowedRoles={['learner']}><LearnerHome /></ProtectedRoute>
          } />
          <Route path="/play/difficulty" element={
            <ProtectedRoute allowedRoles={['learner']}><DifficultySelection /></ProtectedRoute>
          } />
          <Route path="/play/game" element={
            <ProtectedRoute allowedRoles={['learner']}><GamePage /></ProtectedRoute>
          } />
          <Route path="/play/path-difficulty" element={
            <ProtectedRoute allowedRoles={['learner']}><PathTracingDifficulty /></ProtectedRoute>
          } />
          <Route path="/play/path-game" element={
            <ProtectedRoute allowedRoles={['learner']}><PathTracingGame /></ProtectedRoute>
          } />
          <Route path="/play/finger-copy-difficulty" element={
            <ProtectedRoute allowedRoles={['learner']}><FingerCopyDifficulty /></ProtectedRoute>
          } />
          <Route path="/play/finger-copy-game" element={
            <ProtectedRoute allowedRoles={['learner']}><FingerCopyGame /></ProtectedRoute>
          } />
          <Route path="/play/results/:sessionId" element={
            <ProtectedRoute allowedRoles={['learner']}><SessionResults /></ProtectedRoute>
          } />
          <Route path="/learner" element={
            <ProtectedRoute allowedRoles={['learner']}><LearnerHome /></ProtectedRoute>
          } />
          <Route path="/learner/dashboard" element={
            <ProtectedRoute allowedRoles={['learner']}><LearnerDashboard /></ProtectedRoute>
          } />
          <Route path="/difficulty" element={
            <ProtectedRoute allowedRoles={['learner']}><DifficultySelection /></ProtectedRoute>
          } />

          {/* Parent routes */}
          <Route path="/parent" element={
            <ProtectedRoute allowedRoles={['parent']}><ParentDashboard /></ProtectedRoute>
          } />
          <Route path="/chat/:childId" element={
            <ProtectedRoute allowedRoles={['parent', 'practitioner']}><ChatPage /></ProtectedRoute>
          } />

          {/* OT routes */}
          <Route path="/ot" element={
            <ProtectedRoute allowedRoles={['practitioner']}><SpecialistDashboard /></ProtectedRoute>
          } />
          <Route path="/ot/learner/:learnerId" element={
            <ProtectedRoute allowedRoles={['practitioner']}><LearnerDetail /></ProtectedRoute>
          } />

          {/* Admin route */}
          <Route path="/admin" element={<AdminDashboard />} />

          {/* Default redirects */}
          <Route path="/"  element={<Navigate to="/login" replace />} />
          <Route path="*"  element={<Navigate to="/login" replace />} />
        </Routes>
        {timeoutModal}
      </BrowserRouter>
    </ErrorBoundary>
  );
}
