import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, User, Loader2 } from 'lucide-react';
import { validateName, sanitizeInput } from '../../utils/security';
import { supabase } from '../../services/supabaseClient';
import { useAuthStore } from '../../store';
import toast from 'react-hot-toast';

export default function AtlasOnboardingModal({ isOpen, onClose, onComplete }) {
  const { profile, updateProfile } = useAuthStore();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState('');

  useEffect(() => {
    if (profile) {
      setFirstName(profile.first_name || '');
      setLastName(profile.last_name || '');
    }
  }, [profile]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setNameError('');
    setSaving(true);

    const cleanFirst = sanitizeInput(firstName.trim(), 50);
    const cleanLast = sanitizeInput(lastName.trim(), 50);

    try {
      validateName(cleanFirst, 'First name');
      if (cleanLast !== '') {
        validateName(cleanLast, 'Last name');
      }

      // Update parent profile fields in Supabase
      const { error } = await supabase
        .from('users')
        .update({ first_name: cleanFirst, last_name: cleanLast })
        .eq('id', profile.id);

      if (error) throw error;

      // Update Auth Store
      updateProfile({ first_name: cleanFirst, last_name: cleanLast });

      toast.success('Parent profile updated successfully!');
      if (onComplete) onComplete();
      onClose();
    } catch (err) {
      setNameError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={styles.overlay}>
      <motion.div
        style={styles.modal}
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
      >
        <button onClick={onClose} style={styles.closeBtn} disabled={saving}><X size={20} /></button>

        <div style={styles.content}>
          <div style={styles.header}>
            <div style={styles.iconWrap}><User size={28} color="#0D5E6B" /></div>
            <h2 style={styles.title}>Parent Profile Setup</h2>
            <p style={styles.subtitle}>Update or confirm your profile details to complete your setup.</p>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={styles.label}>First Name *</label>
              <input 
                value={firstName} 
                onChange={e => setFirstName(e.target.value)}
                placeholder="e.g. John" 
                style={styles.input} 
                required 
              />
            </div>
            <div>
              <label style={styles.label}>Last Name</label>
              <input 
                value={lastName} 
                onChange={e => setLastName(e.target.value)}
                placeholder="e.g. Doe" 
                style={styles.input} 
              />
            </div>

            {nameError && <div style={styles.inlineError}>{nameError}</div>}

            <button type="submit" disabled={saving} style={styles.submitBtn}>
              {saving ? <><Loader2 size={16} className="animate-spin" /> Saving...</> : 'Complete Setup'}
            </button>
          </form>
        </div>
      </motion.div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.45)',
    backdropFilter: 'blur(4px)', display: 'flex', justifyContent: 'center',
    alignItems: 'center', zIndex: 1000, padding: 16
  },
  modal: {
    background: '#ffffff', borderRadius: 24, width: '100%', maxWidth: 440,
    padding: '32px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)',
    position: 'relative', border: '1px solid #F1F5F9'
  },
  closeBtn: {
    position: 'absolute', top: 20, right: 20, background: 'none', border: 'none',
    color: '#94A3B8', cursor: 'pointer', padding: 4, borderRadius: '50%',
    transition: 'background 0.2s', ':hover': { background: '#F1F5F9' }
  },
  content: { display: 'flex', flexDirection: 'column', gap: 20 },
  header: { textAlign: 'center', marginBottom: 8 },
  iconWrap: {
    width: 56, height: 56, borderRadius: 16, background: '#EEF6F8',
    display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px'
  },
  title: { fontSize: '1.4rem', fontWeight: 800, color: '#1E293B', margin: '0 0 4px 0', fontFamily: 'Inter, sans-serif' },
  subtitle: { fontSize: '0.82rem', color: '#64748B', margin: 0, lineHeight: 1.4 },
  label: { display: 'block', fontSize: '0.78rem', fontWeight: 600, color: '#475569', marginBottom: 6 },
  input: {
    width: '100%', padding: '10px 14px', border: '1px solid #D1D5DB', borderRadius: 10,
    fontSize: '0.88rem', color: '#1F2937', outline: 'none', transition: 'border-color 0.2s',
    boxSizing: 'border-box'
  },
  submitBtn: {
    width: '100%', padding: '12px', background: 'linear-gradient(135deg, #0D5E6B, #1A8FA0)',
    color: '#fff', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: '0.9rem',
    cursor: 'pointer', transition: 'opacity 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12
  },
  inlineError: { color: '#EF4444', fontSize: '0.72rem', marginTop: 4, fontWeight: 500 }
};
