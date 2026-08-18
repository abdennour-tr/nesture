import React from 'react';
import { useLocation, useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Download, Home, RefreshCw } from 'lucide-react';
import ReflexScoreCard from '../components/shared/ReflexScoreCard';
import api from '../services/api';
import toast from 'react-hot-toast';

export default function SessionResults() {
  const { sessionId } = useParams();
  const { state } = useLocation();
  const navigate = useNavigate();
  const analysis = state?.analysis;
  const [feedbackSubmitted, setFeedbackSubmitted] = React.useState(false);

  const downloadPDF = async () => {
    try {
      const res = await api.get(`/reports/${sessionId}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url; a.download = `NestureAI_Report_${sessionId?.slice(0,8)}.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
      toast.success('Report downloaded!');
    } catch { toast.error('Could not download report'); }
  };

  const submitFeedback = async (rating) => {
    try {
      await api.post(`/sessions/${sessionId}/feedback`, { rating });
      setFeedbackSubmitted(true);
      toast.success('Feedback saved successfully!');
    } catch {
      toast.error('Could not save feedback');
    }
  };

  const metrics = analysis?.metrics || {};
  const accuracyPct = Math.round((metrics.accuracy || 0) * 100);
  const rtSec = ((metrics.avg_response_time_ms || 0) / 1000).toFixed(1);
  const isHappyPath = analysis?.scenario === 'happy_path';

  return (
    <div style={styles.root} className="sr-root">
      <motion.div style={styles.container} className="sr-container"
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        
        {/* Header */}
        <div style={styles.header} className="sr-header">
          <div style={{ ...styles.resultBadge, background: isHappyPath ? '#D1FAE5' : '#FEF3E2' }}>
            <span style={{ fontSize: '1.5rem' }}>{isHappyPath ? '🎉' : '💪'}</span>
            <div>
              <div style={{ fontFamily: 'Inter, sans-serif', fontWeight: 800, fontSize: '1.1rem',
                color: isHappyPath ? '#065F46' : '#92400E' }}>
                {isHappyPath ? 'Great Session!' : 'Session Complete'}
              </div>
              <div style={{ fontSize: '0.82rem', color: '#6B7280' }}>
                {isHappyPath ? 'You\'re improving — keep it up!' : 'Every session builds strength. Well done!'}
              </div>
            </div>
          </div>

          <div style={styles.lpiBlock}>
            <div style={styles.lpiNum}>{analysis?.lpi_score || 0}</div>
            <div style={styles.lpiLabel}>LPI Score</div>
          </div>
        </div>

        {/* Key metrics */}
        <div style={styles.metricsGrid} className="sr-metrics-grid">
          {[
            { label: 'Accuracy',        value: `${accuracyPct}%`,             color: '#0D5E6B' },
            { label: 'Avg Response',    value: `${rtSec}s`,                   color: '#E8841A' },
            { label: 'Perfect Grabs',   value: metrics.perfect_grabs || 0,    color: '#10B981' },
            { label: 'Total Attempts',  value: metrics.total_attempts || 0,   color: '#8B5CF6' },
          ].map((m) => (
            <div key={m.label} style={styles.metricCard}>
              <div style={{ ...styles.metricVal, color: m.color }}>{m.value}</div>
              <div style={styles.metricLbl}>{m.label}</div>
            </div>
          ))}
        </div>

        {/* Narrative */}
        {analysis?.narrative && (
          <div style={styles.narrative}>
            <div style={styles.narrativeIcon}>🧠</div>
            <p style={styles.narrativeText}>{analysis.narrative}</p>
          </div>
        )}

        {/* Reflex scores */}
        {analysis?.reflex_scores?.length > 0 && (
          <div>
            <div style={styles.sectionTitle}>Reflex Patterns Detected</div>
            <div style={styles.reflexGrid} className="sr-reflex-grid">
              {analysis.reflex_scores.map((r) => (
                <ReflexScoreCard
                  key={r.reflex}
                  reflex={r.reflex}
                  score={r.score}
                  confidence={r.confidence}
                  trend="stable"
                  compact
                />
              ))}
            </div>
          </div>
        )}



        {/* Feedback Form */}
        {!feedbackSubmitted ? (
          <div style={{ background: 'linear-gradient(135deg, #ffffff, #F8FAFC)', borderRadius: 20, padding: '24px', border: '1px solid #E2E8F0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, boxShadow: '0 4px 14px rgba(0,0,0,0.03)' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '1.1rem', fontFamily: 'Inter, sans-serif', fontWeight: 800, color: '#0D5E6B' }}>How was this session?</div>
              <div style={{ fontSize: '0.85rem', color: '#64748B', marginTop: 4 }}>Your feedback helps us adapt the next exercises.</div>
            </div>
            
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
              {[
                { rating: 1, emoji: '😫', label: 'Too hard' },
                { rating: 2, emoji: '😕', label: 'Difficult' },
                { rating: 3, emoji: '😐', label: 'Medium' },
                { rating: 4, emoji: '🙂', label: 'Good' },
                { rating: 5, emoji: '🤩', label: 'Great!' }
              ].map(opt => (
                <button
                  key={opt.rating}
                  onClick={() => submitFeedback(opt.rating)}
                  className="feedback-btn"
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                    background: '#fff', border: '2px solid #E2E8F0', borderRadius: 16, padding: '12px 10px',
                    cursor: 'pointer', transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                    width: 85
                  }}
                >
                  <span style={{ fontSize: '2.2rem', transition: 'transform 0.2s', display: 'block' }} className="emoji">{opt.emoji}</span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569' }}>{opt.label}</span>
                </button>
              ))}
            </div>
            <style>{`
              .feedback-btn:hover {
                border-color: #1A8FA0 !important;
                box-shadow: 0 8px 16px rgba(26,143,160,0.15) !important;
                transform: translateY(-4px);
              }
              .feedback-btn:hover .emoji {
                transform: scale(1.2) rotate(5deg);
              }
              
              /* Responsive Rules */
              @media (max-width: 768px) {
                .sr-reflex-grid {
                  grid-template-columns: repeat(2, 1fr) !important;
                }
              }
              @media (max-width: 640px) {
                .sr-root {
                  padding: 16px 12px !important;
                }
                .sr-header {
                  flex-direction: column-reverse !important;
                  gap: 20px !important;
                  align-items: center !important;
                  text-align: center !important;
                }
                .sr-metrics-grid {
                  grid-template-columns: repeat(2, 1fr) !important;
                }
                .sr-actions {
                  flex-direction: column !important;
                  gap: 10px !important;
                }
                .sr-actions button {
                  width: 100% !important;
                  justify-content: center !important;
                }
              }
              @media (max-width: 480px) {
                .sr-metrics-grid {
                  grid-template-columns: 1fr !important;
                }
                .sr-reflex-grid {
                  grid-template-columns: 1fr !important;
                }
              }
            `}</style>
          </div>
        ) : (
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} style={{ background: 'linear-gradient(135deg, #D1FAE5, #A7F3D0)', borderRadius: 20, padding: '20px', border: '1px solid #34D399', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, boxShadow: '0 4px 12px rgba(16,185,129,0.1)' }}>
            <div style={{ fontSize: '2rem' }}>💖</div>
            <div style={{ color: '#065F46', fontWeight: 800, fontSize: '1.1rem', fontFamily: 'Inter, sans-serif' }}>Thanks for your feedback!</div>
            <div style={{ color: '#047857', fontSize: '0.85rem' }}>Your results have been saved successfully.</div>
          </motion.div>
        )}

        {/* Actions */}
        <div style={styles.actions} className="sr-actions">
          <button onClick={downloadPDF} style={styles.downloadBtn}>
            <Download size={16} /> Download Report
          </button>
          <button onClick={() => navigate('/play/game?difficulty=medium')} style={styles.playAgainBtn}>
            <RefreshCw size={16} /> Play Again
          </button>
          <button onClick={() => navigate('/play')} style={styles.homeBtn}>
            <Home size={16} /> Home
          </button>
        </div>

      </motion.div>
    </div>
  );
}

const styles = {
  root: {
    minHeight: '100vh', background: '#EEF6F8',
    display: 'flex', justifyContent: 'center',
    padding: '32px 24px',
  },
  container: {
    width: '100%', maxWidth: '100%',
    display: 'flex', flexDirection: 'column', gap: 24,
  },
  header: {
    background: '#fff', borderRadius: 20, padding: '24px',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    boxShadow: '0 4px 16px rgba(13,94,107,0.1)',
  },
  resultBadge: {
    display: 'flex', alignItems: 'center', gap: 14,
    padding: '12px 20px', borderRadius: 14,
  },
  lpiBlock: { textAlign: 'center' },
  lpiNum: {
    fontFamily: 'Inter, sans-serif',
    fontWeight: 800, fontSize: '3rem', color: '#E8841A',
    lineHeight: 1,
  },
  lpiLabel: { fontSize: '0.75rem', color: '#9CA3AF', fontWeight: 600, letterSpacing: '0.05em' },
  metricsGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12,
  },
  metricCard: {
    background: '#fff', borderRadius: 14, padding: '16px 12px',
    textAlign: 'center',
    boxShadow: '0 2px 8px rgba(13,94,107,0.07)',
  },
  metricVal: {
    fontFamily: 'Inter, sans-serif',
    fontWeight: 800, fontSize: '1.6rem',
  },
  metricLbl: { fontSize: '0.72rem', color: '#9CA3AF', marginTop: 2, fontWeight: 500 },
  narrative: {
    background: '#fff', borderRadius: 16, padding: '20px',
    display: 'flex', gap: 14, alignItems: 'flex-start',
    border: '1px solid #C8E8ED',
  },
  narrativeIcon: { fontSize: '1.5rem', flexShrink: 0 },
  narrativeText: { fontSize: '0.95rem', color: '#374151', lineHeight: 1.7 },
  sectionTitle: {
    fontFamily: 'Inter, sans-serif',
    fontWeight: 700, fontSize: '0.9rem',
    color: '#0D5E6B', textTransform: 'uppercase',
    letterSpacing: '0.05em', marginBottom: 12,
  },
  reflexGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10,
  },

  actions: { display: 'flex', gap: 12, justifyContent: 'center', paddingTop: 8 },
  downloadBtn: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '11px 20px',
    background: '#0D5E6B', color: '#fff',
    border: 'none', borderRadius: 10,
    fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: '0.875rem',
    cursor: 'pointer',
  },
  playAgainBtn: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '11px 20px',
    background: '#E8841A', color: '#fff',
    border: 'none', borderRadius: 10,
    fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: '0.875rem',
    cursor: 'pointer',
  },
  homeBtn: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '11px 20px',
    background: '#EEF6F8', color: '#0D5E6B',
    border: '1.5px solid #C8E8ED', borderRadius: 10,
    fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: '0.875rem',
    cursor: 'pointer',
  },
};
