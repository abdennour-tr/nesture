import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../store';
import { submitFeedback } from '../../services/authService';

const FEATURES = [
  'NesturePlay Game',
  'Atlas Profile',
  'Parent Dashboard',
  'Specialist Dashboard',
  'Learner Dashboard',
  'Document Upload',
  'Other',
];

export default function FeedbackButton({ sessionNumber = null }) {
  const { user, profile } = useAuthStore();
  const [open, setOpen]       = useState(false);
  const [feature, setFeature] = useState('');
  const [comment, setComment] = useState('');
  const [rating, setRating]   = useState(0);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!feature) { toast.error('Please select a feature.'); return; }
    setLoading(true);
    try {
      await submitFeedback({
        userId:        profile?.id   || null,
        authId:        user?.id      || null,
        feature,
        comment:       comment.trim() || null,
        rating:        rating || null,
        sessionNumber,
      });
      toast.success('Thank you for your feedback! 🙏');
      setOpen(false);
      setFeature(''); setComment(''); setRating(0);
    } catch {
      toast.error('Could not submit feedback. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Floating trigger button */}
      <button style={styles.trigger} onClick={() => setOpen(true)} title="Share feedback">
        💬
      </button>

      {/* Backdrop + modal */}
      {open && (
        <div style={styles.backdrop} onClick={() => setOpen(false)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>Share your feedback</h3>
              <button style={styles.closeBtn} onClick={() => setOpen(false)}>✕</button>
            </div>

            <div style={styles.field}>
              <label style={styles.label}>Which feature does this relate to?</label>
              <select value={feature} onChange={(e) => setFeature(e.target.value)} style={styles.select}>
                <option value="">— Select a feature —</option>
                {FEATURES.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>

            <div style={styles.field}>
              <label style={styles.label}>Your feedback <span style={{ color: '#9CA3AF' }}>(optional)</span></label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="What worked well? What could be improved?"
                style={styles.textarea}
                rows={4}
              />
            </div>

            <div style={styles.field}>
              <label style={styles.label}>Rating <span style={{ color: '#9CA3AF' }}>(optional)</span></label>
              <div style={styles.stars}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    style={{ ...styles.star, color: n <= rating ? '#F59E0B' : '#D1D5DB' }}
                    onClick={() => setRating(n)}
                  >★</button>
                ))}
              </div>
            </div>

            <button
              style={{ ...styles.submitBtn, opacity: loading ? 0.7 : 1 }}
              onClick={handleSubmit}
              disabled={loading}
            >
              {loading ? 'Sending…' : 'Submit Feedback'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

const styles = {
  trigger: {
    position: 'fixed',
    bottom: 28,
    right: 28,
    width: 48,
    height: 48,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #0D5E6B, #1A8FA0)',
    border: 'none',
    cursor: 'pointer',
    fontSize: '1.2rem',
    boxShadow: '0 4px 16px rgba(13,94,107,0.4)',
    zIndex: 999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'transform 0.2s',
  },
  backdrop: {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.45)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    background: '#fff',
    borderRadius: 16,
    padding: 28,
    width: 420,
    maxWidth: '95vw',
    boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
    display: 'flex',
    flexDirection: 'column',
    gap: 18,
  },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#0D5E6B', fontFamily: 'Inter, sans-serif' },
  closeBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', color: '#9CA3AF' },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: '0.78rem', fontWeight: 600, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em' },
  select: { padding: '9px 12px', borderRadius: 8, border: '1.5px solid #D1D5DB', fontSize: '0.875rem', background: '#fff', color: '#1F2937' },
  textarea: { padding: '9px 12px', borderRadius: 8, border: '1.5px solid #D1D5DB', fontSize: '0.875rem', resize: 'vertical', color: '#1F2937', fontFamily: 'Inter, sans-serif' },
  stars: { display: 'flex', gap: 4 },
  star: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.6rem', padding: '2px', transition: 'color 0.15s' },
  submitBtn: {
    padding: '11px',
    background: 'linear-gradient(135deg, #0D5E6B, #1A8FA0)',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    fontFamily: 'Inter, sans-serif',
    fontWeight: 700,
    fontSize: '0.9rem',
    cursor: 'pointer',
    transition: 'opacity 0.2s',
  },
};
