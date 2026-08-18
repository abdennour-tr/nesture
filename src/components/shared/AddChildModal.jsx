import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { X, User, Calendar, MessageCircle, Eye, EyeOff, Loader2 } from 'lucide-react';
import { validateName, validateNickname, validateDateNotFuture, sanitizeInput } from '../../utils/security';
import { supabase } from '../../services/supabaseClient';
import toast from 'react-hot-toast';

export default function AddChildModal({ isOpen, onClose, onSaveChild }) {
  const [fullName, setFullName] = useState('');
  const [dob, setDob] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [communication, setCommunication] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [userEditedNickname, setUserEditedNickname] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);

  // Errors
  const [nameError, setNameError] = useState('');
  const [dobError, setDobError] = useState('');
  const [nicknameError, setNicknameError] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [passwordError, setPasswordError] = useState('');

  // Reset fields when modal is toggled
  React.useEffect(() => {
    if (!isOpen) {
      setFullName('');
      setDob('');
      setDiagnosis('');
      setCommunication('');
      setNickname('');
      setPassword('');
      setUserEditedNickname(false);
      setNameError('');
      setDobError('');
      setNicknameError('');
      setUsernameError('');
      setPasswordError('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleNameChange = (val) => {
    setFullName(val);
    if (!val) setNameError('');
    else {
      try {
        validateName(val, 'First name');
        setNameError('');
      } catch (err) {
        setNameError(err.message);
      }
    }

    // Auto-fill username with the child's first name (first word, alphanumeric lowercased) if not manually edited
    if (!userEditedNickname) {
      const firstWord = val.trim().split(/\s+/)[0] || '';
      const cleanFirstWord = firstWord.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase();
      setNickname(cleanFirstWord);
      setNicknameError('');
      setUsernameError('');
    }
  };

  const handleDOBChange = (val) => {
    setDob(val);
    if (!val) setDobError('');
    else {
      try {
        validateDateNotFuture(val);
        setDobError('');
      } catch (err) {
        setDobError(err.message);
      }
    }
  };

  const handleNicknameChange = (val) => {
    setNickname(val);
    setUserEditedNickname(true);
    setUsernameError('');
    if (!val) {
      setNicknameError('');
      return;
    }

    const regex = /^[a-zA-Z0-9_]+$/;
    if (!regex.test(val)) {
      setNicknameError('Username can only contain letters, numbers, and underscores');
      return;
    }

    try {
      validateNickname(val);
      setNicknameError('');
    } catch (err) {
      setNicknameError(err.message);
    }
  };

  const handlePasswordChange = (val) => {
    setPassword(val);
    if (!val) setPasswordError('');
    else {
      if (val.length < 6) {
        setPasswordError('Password must be at least 6 characters.');
      } else {
        setPasswordError('');
      }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setNameError('');
    setDobError('');
    setNicknameError('');
    setUsernameError('');
    setPasswordError('');

    const cleanName = sanitizeInput(fullName.trim(), 50);
    const cleanDob = dob.trim();
    const cleanDiag = sanitizeInput(diagnosis.trim(), 100);
    const cleanNickname = sanitizeInput(nickname.trim(), 30);
    const cleanPassword = password.trim();

    const regex = /^[a-zA-Z0-9_]+$/;
    if (!regex.test(cleanNickname)) {
      setNicknameError('Username can only contain letters, numbers, and underscores');
      return;
    }

    try {
      validateName(cleanName, 'Child name');
      validateDateNotFuture(cleanDob);
      validateNickname(cleanNickname);
      if (cleanPassword.length < 6) throw new Error('Password must be at least 6 characters.');

      setSaving(true);
      await onSaveChild({
        details: { fullName: cleanName, dob: cleanDob, diagnosis: cleanDiag, communication },
        login: { nickname: cleanNickname, password: cleanPassword }
      });
      onClose();
    } catch (err) {
      const errMsg = err?.message || err?.response?.data?.detail || err?.response?.data?.error || String(err);
      if (
        errMsg === 'username_taken' ||
        errMsg.includes('username_taken') ||
        errMsg.includes('already taken') ||
        errMsg.includes('already registered') ||
        errMsg.includes('already exists')
      ) {
        setUsernameError('This username is already taken. Please choose a different one.');
        return; // don't close the modal
      }
      if (errMsg.includes('between 2 and 30')) {
        setNicknameError('Username must be between 2 and 30 characters.');
        return;
      }
      toast.error(errMsg || 'Could not create learner profile. Please check credentials and try again.');
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
            <h2 style={styles.title}>Add Child Profile</h2>
            <p style={styles.subtitle}>Create a learner profile and login credentials for your child.</p>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={styles.label}>Child's Full Name *</label>
              <input value={fullName} onChange={e => handleNameChange(e.target.value)}
                placeholder="e.g. Lily Chen" style={styles.input} required />
              {nameError && <div style={styles.inlineError}>{nameError}</div>}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <label style={styles.label}>Date of Birth *</label>
                <input type="date" value={dob} onChange={e => handleDOBChange(e.target.value)}
                  style={styles.input} required />
                {dobError && <div style={styles.inlineError}>{dobError}</div>}
              </div>
              <div>
                <label style={styles.label}>Communication Method</label>
                <select value={communication} onChange={e => setCommunication(e.target.value)} style={styles.input}>
                  <option value="">Select...</option>
                  <option value="verbal">Full sentences</option>
                  <option value="phrases">Short phrases / single words</option>
                  <option value="nonverbal">Non-verbal / gestures</option>
                  <option value="aac">AAC device</option>
                  <option value="sign">Sign language</option>
                </select>
              </div>
            </div>

            <div>
              <label style={styles.label}>Diagnosis (optional)</label>
              <input value={diagnosis} onChange={e => setDiagnosis(e.target.value)}
                placeholder="e.g. Autism, ADHD, Speech Delay" style={styles.input} />
            </div>

            <div style={{ borderTop: '1px solid #E5E7EB', paddingTop: 16, marginTop: 8 }}>
              <h3 style={{ fontSize: '0.9rem', fontWeight: 700, color: '#1F2937', marginBottom: 4 }}>Learner Login Credentials</h3>
              <p style={{ fontSize: '0.75rem', color: '#6B7280', marginBottom: 12 }}>Your child will use these credentials to log in and play the games.</p>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <label style={styles.label}>Username / Nickname *</label>
                  <input
                    value={nickname}
                    onChange={e => handleNicknameChange(e.target.value)}
                    placeholder="e.g. lily"
                    autoComplete="new-username"
                    style={styles.input}
                    required
                  />
                  {nicknameError && <div style={styles.inlineError}>{nicknameError}</div>}
                  {usernameError && <div style={styles.inlineError}>{usernameError}</div>}
                </div>
                <div>
                  <label style={styles.label}>Learner Password *</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={e => handlePasswordChange(e.target.value)}
                      placeholder="••••••"
                      autoComplete="new-password"
                      style={styles.input}
                      required
                    />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {passwordError && <div style={styles.inlineError}>{passwordError}</div>}
                </div>
              </div>
            </div>

            <button type="submit" disabled={saving} style={styles.submitBtn}>
              {saving ? <><Loader2 size={16} className="animate-spin" /> Creating Learner Profile...</> : 'Save Child Profile'}
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
    background: '#ffffff', borderRadius: 24, width: '100%', maxWidth: 540,
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
  eyeBtn: {
    position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
    background: 'none', border: 'none', color: '#64748B', cursor: 'pointer', display: 'flex', alignItems: 'center'
  },
  submitBtn: {
    width: '100%', padding: '12px', background: 'linear-gradient(135deg, #0D5E6B, #1A8FA0)',
    color: '#fff', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: '0.9rem',
    cursor: 'pointer', transition: 'opacity 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 12
  },
  inlineError: { color: '#EF4444', fontSize: '0.72rem', marginTop: 4, fontWeight: 500 }
};
