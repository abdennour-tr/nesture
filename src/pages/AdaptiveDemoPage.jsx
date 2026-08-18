import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, Activity, ArrowLeft, Keyboard, AlertTriangle, Zap, CheckCircle, XCircle, Settings } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import BetaFooter from '../components/shared/BetaFooter';

// LEVELS definition
const LEVELS = [
  { level: 1, name: 'Easy', desc: 'Short words (3-4 letters)', kbSize: '8 Keys (Beginner)', word: 'CAT' },
  { level: 2, name: 'Medium', desc: 'Slightly longer (4-5 letters)', kbSize: '12 Keys (Intermediate)', word: 'PLANT' },
  { level: 3, name: 'Complex', desc: 'Long words (6+ letters)', kbSize: '26 Keys (Advanced)', word: 'JOURNEY' },
  { level: 4, name: 'Complex', desc: 'Short phrases', kbSize: '26 Keys (QWERTY)', word: 'I LOVE DOGS' },
  { level: 5, name: 'Expert', desc: 'Complex sentences', kbSize: '26 Keys (QWERTY)', word: 'THE SUN IS SHINING TODAY' }
];

export default function AdaptiveDemoPage() {
  const navigate = useNavigate();
  
  const [level, setLevel] = useState(1);
  const [logs, setLogs] = useState([]);
  const [notification, setNotification] = useState(null);

  const [correctStreak, setCorrectStreak] = useState(0);
  const [errorStreak, setErrorStreak] = useState(0);

  const currentConfig = LEVELS[level - 1];

  const addLog = (msg, type) => {
    setLogs(prev => [{ id: Date.now(), msg, type, time: new Date().toLocaleTimeString() }, ...prev].slice(0, 5));
  };

  const showNotification = (msg) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 4000);
  };

  const handleCorrect = () => {
    addLog(`Alex correctly typed part of "${currentConfig.word}".`, 'success');
    setErrorStreak(0);
    const newStreak = correctStreak + 1;
    
    if (newStreak >= 2 && level < 5) {
      setLevel(level + 1);
      setCorrectStreak(0);
      addLog(`AI detected mastery. Increasing difficulty to Level ${level + 1}.`, 'system');
      showNotification(`Difficulty auto-adjusted to Level ${level + 1}`);
    } else {
      setCorrectStreak(newStreak);
    }
  };

  const handleIncorrect = () => {
    addLog(`Alex struggled with "${currentConfig.word}".`, 'error');
    setCorrectStreak(0);
    const newStreak = errorStreak + 1;
    
    // 1-incorrect-down logic for demo speed
    if (newStreak >= 1 && level > 1) {
      setLevel(level - 1);
      setErrorStreak(0);
      addLog(`AI detected frustration risk. Lowering difficulty to Level ${level - 1}.`, 'system');
      showNotification(`Difficulty auto-adjusted to Level ${level - 1}`);
    } else {
      setErrorStreak(newStreak);
    }
  };

  return (
    <div style={styles.root} className="ad-root">
      {/* HEADER */}
      <div style={styles.header} className="ad-header">
        <button onClick={() => navigate(-1)} style={styles.backBtn}>
          <ArrowLeft size={16} /> Back
        </button>
        <div style={styles.headerTitle}>
          <Brain color="#0D5E6B" /> 
          <span>Adaptive Calibration Demo — Alex</span>
        </div>
        <div style={styles.permanentNote}>
          <Settings size={14} /> Alex can always choose his own level manually
        </div>
      </div>

      <div style={styles.splitContainer} className="ad-split-container">
        {/* LEFT SIDE: GAME VIEW */}
        <div style={styles.leftPanel} className="ad-left-panel">
          <div style={styles.panelHeader}>
            <GamepadIcon /> Alex's View (NesturePlay)
          </div>
          
          <div style={styles.gameSim}>
            <div style={{ fontSize: '0.9rem', color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, marginBottom: 8 }}>Target Word</div>
            <div style={styles.wordDisplay} className="ad-word-display">{currentConfig.word}</div>
            
            <div style={styles.kbIndicator}>
              <Keyboard size={16} /> Keyboard: <strong>{currentConfig.kbSize}</strong>
            </div>

            <div style={styles.controls} className="ad-controls">
              <button onClick={handleCorrect} style={styles.btnSuccess}>
                <CheckCircle size={18} /> Simulate Correct (+1)
              </button>
              <button onClick={handleIncorrect} style={styles.btnError}>
                <XCircle size={18} /> Simulate Error (-1)
              </button>
            </div>
            <p style={{ fontSize: '0.8rem', color: '#9CA3AF', textAlign: 'center', marginTop: 16 }}>
              (In reality, this is driven by dwell-time & hand-tracking)
            </p>
          </div>
        </div>

        {/* RIGHT SIDE: AI BRAIN */}
        <div style={styles.rightPanel} className="ad-right-panel">
          <div style={styles.panelHeader}>
            <Brain size={20} /> AI Engine Analysis
          </div>
          
          <div style={styles.kpiGrid} className="ad-kpi-grid">
            <div style={styles.kpiCard}>
              <div style={styles.kpiLabel}>Current Level</div>
              <div style={styles.kpiValueMain}>Level {level}</div>
              <div style={styles.kpiSub}>{currentConfig.name}</div>
            </div>
            
            <div style={styles.kpiCard}>
              <div style={styles.kpiLabel}>Frustration Risk</div>
              <div style={{ ...styles.kpiValue, color: errorStreak > 0 ? '#EF4444' : '#10B981' }}>
                {errorStreak > 0 ? 'High' : 'Low'}
              </div>
            </div>

            <div style={styles.kpiCard}>
              <div style={styles.kpiLabel}>Engagement</div>
              <div style={{ ...styles.kpiValue, color: '#3B82F6' }}>Optimal</div>
            </div>
          </div>

          <div style={styles.logsContainer}>
            <h3 style={{ fontSize: '0.9rem', color: '#6B7280', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Real-time Logs</h3>
            <AnimatePresence>
              {logs.map(log => (
                <motion.div 
                  key={log.id}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  style={{
                    ...styles.logItem,
                    borderLeftColor: log.type === 'success' ? '#10B981' : log.type === 'error' ? '#EF4444' : '#8B5CF6',
                    background: log.type === 'success' ? '#F0FDF4' : log.type === 'error' ? '#FEF2F2' : '#F5F3FF',
                  }}
                >
                  <span style={{ fontSize: '0.7rem', color: '#9CA3AF', marginRight: 8 }}>{log.time}</span>
                  <span style={{ fontSize: '0.85rem', color: '#374151', fontWeight: 500 }}>{log.msg}</span>
                </motion.div>
              ))}
            </AnimatePresence>
            {logs.length === 0 && (
              <div style={{ fontSize: '0.85rem', color: '#9CA3AF', fontStyle: 'italic' }}>Waiting for interaction...</div>
            )}
          </div>
        </div>
      </div>

      {/* Slide-in Notification */}
      <AnimatePresence>
        {notification && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            style={styles.notificationToast}
          >
            <Zap size={18} color="#E8841A" />
            <span>{notification}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="ad-footer" style={{ position: 'absolute', bottom: 0, width: '100%', paddingBottom: 24 }}>
        <BetaFooter variant="light" />
      </div>

      <style>{`
        /* Responsive Rules */
        @media (max-width: 1024px) {
          .ad-root {
            padding: 16px 20px !important;
          }
          .ad-header {
            flex-wrap: wrap;
            gap: 12px;
          }
          .ad-split-container {
            height: auto !important;
            flex-direction: column !important;
          }
          .ad-footer {
            position: static !important;
            margin-top: 40px !important;
            padding-bottom: 16px !important;
          }
        }
        @media (max-width: 640px) {
          .ad-root {
            padding: 12px 10px !important;
          }
          .ad-header {
            flex-direction: column;
            align-items: stretch !important;
            text-align: center;
          }
          .ad-header > button {
            align-self: center;
          }
          .ad-header > div {
            justify-content: center;
          }
          .ad-word-display {
            font-size: 2.2rem !important;
            letter-spacing: 0.1em !important;
          }
          .ad-left-panel, .ad-right-panel {
            padding: 20px 16px !important;
          }
          .ad-controls {
            flex-direction: column !important;
            width: 100%;
          }
          .ad-controls button {
            width: 100% !important;
            justify-content: center !important;
          }
          .ad-kpi-grid {
            grid-template-columns: repeat(2, 1fr) !important;
          }
        }
        @media (max-width: 480px) {
          .ad-kpi-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}

const GamepadIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="6" y1="12" x2="10" y2="12"></line>
    <line x1="8" y1="10" x2="8" y2="14"></line>
    <line x1="15" y1="13" x2="15.01" y2="13"></line>
    <line x1="18" y1="11" x2="18.01" y2="11"></line>
    <path d="M20.59 15.54l-2.09-2.09a2 2 0 0 0-2.83 0L12 17.1l-3.67-3.65a2 2 0 0 0-2.83 0l-2.09 2.09A2 2 0 0 1 2 14.12V9.88a2 2 0 0 1 1.41-1.42l3.2-1.07a2 2 0 0 1 2.22.77l.7.94a2 2 0 0 0 1.6.8h1.74a2 2 0 0 0 1.6-.8l.7-.94a2 2 0 0 1 2.22-.77l3.2 1.07A2 2 0 0 1 22 9.88v4.24a2 2 0 0 1-1.41 1.42z"></path>
  </svg>
);

const styles = {
  root: {
    minHeight: '100vh', background: '#EEF6F8', padding: '24px 40px', position: 'relative',
    fontFamily: 'Inter, sans-serif'
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32,
    background: '#fff', padding: '16px 24px', borderRadius: 16, boxShadow: '0 4px 20px rgba(0,0,0,0.05)'
  },
  backBtn: {
    display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', background: '#F3F4F6', 
    border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, color: '#4B5563'
  },
  headerTitle: {
    display: 'flex', alignItems: 'center', gap: 10, fontSize: '1.2rem', fontWeight: 800, color: '#0D5E6B'
  },
  permanentNote: {
    display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', fontWeight: 600, 
    color: '#8B5CF6', background: '#EDE9FE', padding: '6px 14px', borderRadius: 20
  },
  splitContainer: {
    display: 'flex', gap: 24, height: 'calc(100vh - 220px)'
  },
  leftPanel: {
    flex: 1, background: '#fff', borderRadius: 24, padding: 32,
    boxShadow: '0 10px 30px rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column'
  },
  rightPanel: {
    flex: 1, background: '#0F1E22', borderRadius: 24, padding: 32, color: '#fff',
    boxShadow: '0 10px 30px rgba(13,94,107,0.2)', display: 'flex', flexDirection: 'column'
  },
  panelHeader: {
    display: 'flex', alignItems: 'center', gap: 10, fontSize: '1.1rem', fontWeight: 700, 
    marginBottom: 24, color: 'inherit', borderBottom: '1px solid rgba(156,163,175,0.2)', paddingBottom: 16
  },
  gameSim: {
    flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    background: '#F9FAFB', borderRadius: 16, border: '2px dashed #E5E7EB', padding: 32
  },
  wordDisplay: {
    fontSize: '3.5rem', fontWeight: 900, letterSpacing: '0.2em', color: '#111827', marginBottom: 24,
    textShadow: '2px 2px 0px #E5E7EB'
  },
  kbIndicator: {
    display: 'flex', alignItems: 'center', gap: 8, background: '#fff', padding: '12px 24px',
    borderRadius: 12, boxShadow: '0 4px 10px rgba(0,0,0,0.05)', fontSize: '0.95rem', color: '#374151',
    marginBottom: 40
  },
  controls: {
    display: 'flex', gap: 16
  },
  btnSuccess: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '14px 24px', background: '#10B981', 
    color: '#fff', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: '1rem', cursor: 'pointer',
    boxShadow: '0 4px 14px rgba(16,185,129,0.3)'
  },
  btnError: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '14px 24px', background: '#EF4444', 
    color: '#fff', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: '1rem', cursor: 'pointer',
    boxShadow: '0 4px 14px rgba(239,68,68,0.3)'
  },
  kpiGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 32
  },
  kpiCard: {
    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 16, padding: 16, textAlign: 'center'
  },
  kpiLabel: {
    fontSize: '0.75rem', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8
  },
  kpiValueMain: {
    fontSize: '1.6rem', fontWeight: 800, color: '#fff', marginBottom: 4
  },
  kpiSub: {
    fontSize: '0.8rem', color: '#14B8A6', fontWeight: 600
  },
  kpiValue: {
    fontSize: '1.2rem', fontWeight: 700, marginTop: 12
  },
  logsContainer: {
    flex: 1, background: 'rgba(0,0,0,0.2)', borderRadius: 16, padding: 20,
    overflowY: 'auto', border: '1px solid rgba(255,255,255,0.05)'
  },
  logItem: {
    padding: '12px 16px', borderRadius: 10, marginBottom: 8, borderLeft: '4px solid'
  },
  notificationToast: {
    position: 'fixed', bottom: 100, right: 40, background: '#fff', border: '2px solid #E8841A',
    padding: '16px 24px', borderRadius: 16, display: 'flex', alignItems: 'center', gap: 12,
    boxShadow: '0 10px 40px rgba(232,132,26,0.2)', fontWeight: 700, color: '#1F2937', zIndex: 1000
  }
};
