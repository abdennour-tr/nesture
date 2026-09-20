import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, X, Lock, CheckCircle, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';

export default function ConsentSettingsModal({ isOpen, onClose }) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [revoking, setRevoking] = useState(false);

  if (!isOpen) return null;

  const handleRevoke = async () => {
    setRevoking(true);
    // Simulate API call for revocation
    await new Promise(r => setTimeout(r, 1500));
    setRevoking(false);
    toast.success('Consent revoked. All AI data will be securely deleted within 24 hours.');
    onClose();
  };

  const points = [
    "Data Encryption: All data is encrypted in transit and at rest using AES-256.",
    "Data Minimization: We only collect reports and session metrics necessary for the 6-agent AI pipeline.",
    "Camera Stays On Device: Activities analyse the camera image on your device. No video or photo is ever uploaded or stored \u2014 only the positions of tracked points such as wrists and shoulders.",
    "Right to Erasure: You can revoke access and delete all data at any time.",
    "No Third-Party Selling: Your data is never sold to third-party brokers.",
    "Specialist Access: Only specialists you explicitly link can view the Atlas Profile.",
    "AI Training Opt-Out: Our AI and OCR providers process your data under contract and do not use it to train their models.",
    "Auto-Deletion: The original file you upload is deleted as soon as processing completes. The text extracted from it is kept so your profile can be updated, and you can delete that too at any time.",
    "Name Removal: Profile data sent to our AI provider for insight generation has your child\u2019s name removed before it leaves NestureAI."
  ];

  return (
    <div style={styles.overlay}>
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        style={styles.modal}
      >
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.headerLeft}>
            <div style={styles.iconWrap}>
              <Shield size={24} color="#0D5E6B" />
            </div>
            <div>
              <h2 style={styles.title}>Data Privacy & Consent</h2>
              <p style={styles.subtitle}>Review your agreements and manage data access.</p>
            </div>
          </div>
          <button onClick={onClose} style={styles.closeBtn}>
            <X size={20} />
          </button>
        </div>

        <div style={styles.body}>
          {/* Active Consent Info */}
          <div style={styles.consentCard}>
            <div style={styles.statusRow}>
              <div style={styles.statusBadge}>
                <CheckCircle size={16} /> Active Consent Agreement
              </div>
              <span style={{ fontSize: '0.8rem', color: '#6B7280' }}>Signed: Oct 12, 2025</span>
            </div>
            
            <p style={styles.introText}>
              By using NestureAI, you have agreed to our data pledge. We believe in complete transparency regarding your child's data.
            </p>

            <ul style={styles.pointsList}>
              {points.map((pt, i) => {
                const [title, desc] = pt.split(': ');
                return (
                  <li key={i} style={styles.pointItem}>
                    <Lock size={14} color="#10B981" style={{ flexShrink: 0, marginTop: 2 }} />
                    <span style={{ fontSize: '0.85rem', color: '#374151', lineHeight: 1.5 }}>
                      <strong style={{ color: '#111827' }}>{title}:</strong> {desc}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Revoke Section */}
          <div style={styles.dangerZone}>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '1rem', color: '#991B1B', display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={16} /> Danger Zone
            </h3>
            <p style={{ margin: '0 0 16px 0', fontSize: '0.85rem', color: '#7F1D1D' }}>
              Revoking consent will permanently delete all AI-generated insights, child profiles, and uploaded documents. Game progress (scores) will remain anonymized.
            </p>
            
            {!showConfirm ? (
              <button 
                onClick={() => setShowConfirm(true)}
                style={styles.revokeBtn}
              >
                Revoke AI Access & Delete Data
              </button>
            ) : (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} style={styles.confirmBox}>
                <p style={{ margin: '0 0 12px 0', fontSize: '0.85rem', fontWeight: 600 }}>Are you absolutely sure?</p>
                <div style={{ display: 'flex', gap: 12 }}>
                  <button 
                    disabled={revoking}
                    onClick={handleRevoke}
                    style={{ ...styles.revokeBtn, flex: 1, background: '#DC2626', color: '#fff', border: 'none' }}
                  >
                    {revoking ? 'Deleting...' : 'Yes, Revoke Access'}
                  </button>
                  <button 
                    disabled={revoking}
                    onClick={() => setShowConfirm(false)}
                    style={{ flex: 1, background: '#fff', border: '1px solid #D1D5DB', borderRadius: 8, cursor: 'pointer', fontWeight: 600, color: '#374151' }}
                  >
                    Cancel
                  </button>
                </div>
              </motion.div>
            )}
          </div>

        </div>
      </motion.div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 99999, background: 'rgba(17, 24, 39, 0.6)',
    backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '20px'
  },
  modal: {
    background: '#fff', borderRadius: 24, width: '100%', maxWidth: 600,
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
    boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)'
  },
  header: {
    padding: '24px 32px', borderBottom: '1px solid #F3F4F6',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
  },
  headerLeft: {
    display: 'flex', alignItems: 'center', gap: 16
  },
  iconWrap: {
    width: 48, height: 48, background: '#EEF6F8', borderRadius: 12,
    display: 'flex', alignItems: 'center', justifyContent: 'center'
  },
  title: {
    margin: 0, fontSize: '1.2rem', fontWeight: 800, color: '#111827', fontFamily: 'Inter, sans-serif'
  },
  subtitle: {
    margin: '2px 0 0 0', fontSize: '0.85rem', color: '#6B7280'
  },
  closeBtn: {
    width: 36, height: 36, borderRadius: '50%', background: '#F3F4F6', border: 'none',
    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
    color: '#6B7280', transition: 'all 0.2s'
  },
  body: {
    padding: '32px', overflowY: 'auto', maxHeight: '70vh'
  },
  consentCard: {
    background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 16, padding: '24px',
    marginBottom: '24px'
  },
  statusRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16
  },
  statusBadge: {
    display: 'flex', alignItems: 'center', gap: 6, background: '#D1FAE5', color: '#065F46',
    padding: '6px 12px', borderRadius: 20, fontSize: '0.8rem', fontWeight: 700
  },
  introText: {
    fontSize: '0.85rem', color: '#4B5563', lineHeight: 1.6, marginBottom: 20
  },
  pointsList: {
    margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 12
  },
  pointItem: {
    display: 'flex', alignItems: 'flex-start', gap: 10
  },
  dangerZone: {
    border: '1px solid #FECACA', background: '#FEF2F2', borderRadius: 16, padding: '20px'
  },
  revokeBtn: {
    width: '100%', padding: '10px', background: 'none', border: '2px solid #FCA5A5', color: '#B91C1C',
    borderRadius: 8, fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s'
  },
  confirmBox: {
    background: '#fff', border: '1px solid #FCA5A5', borderRadius: 12, padding: '16px',
    marginTop: 12
  }
};
