import React, { useState, useEffect, useCallback } from 'react';
import { useAuthStore } from '../store';
import toast from 'react-hot-toast';
import SessionTimeoutModal from '../components/shared/SessionTimeoutModal';

const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const WARNING_THRESHOLD_MS = 29 * 60 * 1000; // 29 minutes (1 minute before timeout)

export function useSessionManager() {
  const { user, originalProfile, logout, isInitializing } = useAuthStore();
  const [isOpen, setIsOpen] = useState(false);
  const [countdown, setCountdown] = useState(60);

  // Function to refresh the last activity timestamp in localStorage
  const recordActivity = useCallback(() => {
    if (!user || isInitializing) return;
    localStorage.setItem('nesture-last-activity', String(Date.now()));
  }, [user, isInitializing]);

  const handleStayConnected = useCallback(() => {
    localStorage.setItem('nesture-last-activity', String(Date.now()));
    setIsOpen(false);
  }, []);

  // 1. Initial startup check
  useEffect(() => {
    if (isInitializing) return;
    if (!user) return;
    if (originalProfile) return; // Exempt impersonation

    const lastActivity = Number(localStorage.getItem('nesture-last-activity') || 0);
    const now = Date.now();

    if (lastActivity && now - lastActivity > INACTIVITY_TIMEOUT_MS) {
      toast.error('Your session expired due to inactivity. Please sign in again.', { id: 'session-timeout-startup', duration: 5000 });
      logout();
    } else {
      // Set timestamp if missing
      if (!lastActivity) {
        localStorage.setItem('nesture-last-activity', String(now));
      }
    }
  }, [user, isInitializing, originalProfile, logout]);

  // 2. Event listeners for tracking activity
  useEffect(() => {
    if (!user || isInitializing || originalProfile) return;

    const activityEvents = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll', 'visibilitychange'];

    activityEvents.forEach(event => {
      window.addEventListener(event, recordActivity, { passive: true });
    });

    return () => {
      activityEvents.forEach(event => {
        window.removeEventListener(event, recordActivity);
      });
    };
  }, [user, isInitializing, originalProfile, recordActivity]);

  // 3. Periodic check loop (interval) for multi-tab sync
  useEffect(() => {
    if (!user || isInitializing || originalProfile) {
      setIsOpen(false);
      return;
    }

    const checkSession = () => {
      const lastActivity = Number(localStorage.getItem('nesture-last-activity') || 0);
      if (!lastActivity) return;

      const elapsed = Date.now() - lastActivity;

      if (elapsed >= INACTIVITY_TIMEOUT_MS) {
        setIsOpen(false);
        toast.error('Your session expired due to inactivity.', { id: 'session-timeout-expired', duration: 6000 });
        logout();
      } else if (elapsed >= WARNING_THRESHOLD_MS) {
        const remaining = Math.max(0, Math.ceil((INACTIVITY_TIMEOUT_MS - elapsed) / 1000));
        setCountdown(remaining);
        setIsOpen(true);
      } else {
        setIsOpen(false);
      }
    };

    const intervalId = setInterval(checkSession, 1000);

    // Initial check
    checkSession();

    return () => clearInterval(intervalId);
  }, [user, isInitializing, originalProfile, logout]);

  // Returned modal element to be rendered in App.js
  const timeoutModal = (
    <SessionTimeoutModal
      isOpen={isOpen}
      countdown={countdown}
      onStayConnected={handleStayConnected}
    />
  );

  return { timeoutModal };
}
