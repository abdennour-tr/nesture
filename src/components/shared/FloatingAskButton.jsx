import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles } from 'lucide-react';
import { supabase } from '../../services/supabaseClient';
import AtlasAskModal from './AtlasAskModal';

/**
 * PRD v5: Floating "Ask About [Child]" button — bottom-right, always visible.
 * Opens the AtlasAskModal chat panel on click.
 */
export default function FloatingAskButton({ childName = 'your child', childId, profile: initialProfile }) {
  const [isOpen, setIsOpen] = useState(false);
  const [profile, setProfile] = useState(initialProfile || null);

  useEffect(() => {
    setProfile(null);
  }, [childId]);

  useEffect(() => {
    if (isOpen && childId) {
      const fetchProfile = async () => {
        try {
          const isUUID = (str) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
          const targetId = isUUID(childId) ? childId : '00000000-0000-0000-0000-000000000010';
          const { data, error } = await supabase
            .from('atlas_profiles').select('*').eq('child_id', targetId).limit(1);
          if (data && data.length > 0) setProfile(data[0]);
        } catch (err) {
          console.error('Failed to fetch profile for Ask AI', err);
        }
      };
      fetchProfile();
    }
  }, [isOpen, childId]);

  return (
    <>
      {/* Floating Trigger — fixed bottom-right */}
      <AnimatePresence>
        {!isOpen && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: 'spring', damping: 15, stiffness: 200 }}
            onClick={() => setIsOpen(true)}
            style={styles.fab}
            title={`Ask about ${childName}`}
          >
            <Sparkles size={22} color="#fff" />
            <span style={styles.fabLabel}>Ask AI</span>
            {/* Pulse ring */}
            <span style={styles.pulse} />
          </motion.button>
        )}
      </AnimatePresence>

      {/* Chat Modal */}
      <AtlasAskModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        childName={childName}
        childId={childId}
        profile={profile}
      />
    </>
  );
}

const styles = {
  fab: {
    position: 'fixed',
    bottom: 28,
    right: 28,
    zIndex: 9990,
    width: 'auto',
    height: 52,
    padding: '0 20px 0 16px',
    background: 'linear-gradient(135deg, #1A8FA0, #23BFDB)',
    border: 'none',
    borderRadius: 26,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    cursor: 'pointer',
    boxShadow: '0 8px 24px rgba(26,143,160,0.4), 0 2px 6px rgba(0,0,0,0.1)',
    transition: 'transform 0.2s, box-shadow 0.2s',
    fontFamily: 'Inter, sans-serif',
  },
  fabLabel: {
    color: '#fff',
    fontWeight: 700,
    fontSize: '0.9rem',
    letterSpacing: '0.02em',
  },
  pulse: {
    position: 'absolute',
    inset: -4,
    borderRadius: 30,
    border: '2px solid rgba(26,143,160,0.4)',
    animation: 'askPulse 2.5s infinite ease-out',
    pointerEvents: 'none',
  },
};

// Inject keyframes for the pulse animation
if (typeof document !== 'undefined' && !document.getElementById('ask-pulse-css')) {
  const style = document.createElement('style');
  style.id = 'ask-pulse-css';
  style.textContent = `
    @keyframes askPulse {
      0%   { transform: scale(1);   opacity: 0.6; }
      70%  { transform: scale(1.15); opacity: 0; }
      100% { transform: scale(1.15); opacity: 0; }
    }
  `;
  document.head.appendChild(style);
}
