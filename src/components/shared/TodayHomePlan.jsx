import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Play, CheckCircle, Clock, Sparkles } from 'lucide-react';

export default function TodayHomePlan({ childName = 'your child' }) {
  const [completed, setCompleted] = useState({
    ex1: false,
    ex2: false,
    ex3: false
  });

  const toggleComplete = (id) => {
    setCompleted(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const total = Object.keys(completed).length;
  const done = Object.values(completed).filter(Boolean).length;
  const progressPct = Math.round((done / total) * 100);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={{ flex: 1 }}>
          <div style={styles.badgeWrapper}>
            <span style={styles.badge}>
              <Sparkles size={12} color="#E8841A" />
              Agent 3 (Home Strategy)
            </span>
          </div>
          <h2 style={styles.title}>Today's Home Plan</h2>
          <p style={styles.subtitle}>AI-tailored 15-minute routine to support {childName}'s fine motor skills based on yesterday's session.</p>
        </div>

        {/* Progress Circular Indicator */}
        <div style={styles.progressCircleWrap}>
          <svg viewBox="0 0 36 36" style={styles.progressSvg}>
            <path
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              fill="none" stroke="#F3F4F6" strokeWidth="3"
            />
            <path
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              fill="none" stroke="#10B981" strokeWidth="3"
              strokeDasharray={`${progressPct}, 100`}
              style={{ transition: 'stroke-dasharray 0.5s ease' }}
            />
          </svg>
          <div style={styles.progressText}>
            <span style={{ fontSize: '1rem', fontWeight: 800, color: '#0D5E6B' }}>{done}</span>
            <span style={{ fontSize: '0.65rem', color: '#6B7280' }}>/ {total}</span>
          </div>
        </div>
      </div>

      <div style={styles.list}>
        {/* Task 1 */}
        <div style={{ ...styles.taskItem, background: completed.ex1 ? '#F9FAFB' : '#fff' }}>
          <button 
            onClick={() => toggleComplete('ex1')}
            style={{ ...styles.checkBtn, color: completed.ex1 ? '#10B981' : '#D1D5DB' }}
          >
            <CheckCircle size={24} fill={completed.ex1 ? '#D1FAE5' : 'none'} />
          </button>
          <div style={styles.taskBody}>
            <div style={styles.taskHeader}>
              <h4 style={{ ...styles.taskTitle, color: completed.ex1 ? '#9CA3AF' : '#111827', textDecoration: completed.ex1 ? 'line-through' : 'none' }}>
                Playdough Letter Molding
              </h4>
              <span style={styles.duration}><Clock size={12} /> 5 min</span>
            </div>
            <p style={styles.taskDesc}>Pinch and roll playdough to form letters from yesterday's hardest words. Great for pincer grasp!</p>
          </div>
          <button style={styles.playBtn}><Play size={14} /></button>
        </div>

        {/* Task 2 */}
        <div style={{ ...styles.taskItem, background: completed.ex2 ? '#F9FAFB' : '#fff' }}>
          <button 
            onClick={() => toggleComplete('ex2')}
            style={{ ...styles.checkBtn, color: completed.ex2 ? '#10B981' : '#D1D5DB' }}
          >
            <CheckCircle size={24} fill={completed.ex2 ? '#D1FAE5' : 'none'} />
          </button>
          <div style={styles.taskBody}>
            <div style={styles.taskHeader}>
              <h4 style={{ ...styles.taskTitle, color: completed.ex2 ? '#9CA3AF' : '#111827', textDecoration: completed.ex2 ? 'line-through' : 'none' }}>
                Wall Push-ups
              </h4>
              <span style={styles.duration}><Clock size={12} /> 3 min</span>
            </div>
            <p style={styles.taskDesc}>To integrate the ATNR reflex and provide deep proprioceptive input before the next session.</p>
          </div>
          <button style={styles.playBtn}><Play size={14} /></button>
        </div>

        {/* Task 3 */}
        <div style={{ ...styles.taskItem, background: completed.ex3 ? '#F9FAFB' : '#fff' }}>
          <button 
            onClick={() => toggleComplete('ex3')}
            style={{ ...styles.checkBtn, color: completed.ex3 ? '#10B981' : '#D1D5DB' }}
          >
            <CheckCircle size={24} fill={completed.ex3 ? '#D1FAE5' : 'none'} />
          </button>
          <div style={styles.taskBody}>
            <div style={styles.taskHeader}>
              <h4 style={{ ...styles.taskTitle, color: completed.ex3 ? '#9CA3AF' : '#111827', textDecoration: completed.ex3 ? 'line-through' : 'none' }}>
                Starfish Breathing
              </h4>
              <span style={styles.duration}><Clock size={12} /> 5 min</span>
            </div>
            <p style={styles.taskDesc}>Trace the fingers while breathing in and out. Calms the nervous system post-activity.</p>
          </div>
          <button style={styles.playBtn}><Play size={14} /></button>
        </div>
      </div>

      {progressPct === 100 && (
        <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} style={styles.celebration}>
          🎉 Amazing job! You've completed {childName}'s routine for today.
        </motion.div>
      )}
    </div>
  );
}

const styles = {
  container: {
    background: '#fff', borderRadius: 16, border: '1px solid #E5E7EB', overflow: 'hidden',
    boxShadow: '0 4px 6px rgba(0,0,0,0.02)', padding: '24px'
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20,
    gap: 20
  },
  badgeWrapper: { marginBottom: 8 },
  badge: {
    display: 'inline-flex', alignItems: 'center', gap: 4, background: '#FEF3C7', color: '#B45309',
    padding: '4px 10px', borderRadius: 12, fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase',
    letterSpacing: '0.05em'
  },
  title: {
    fontFamily: 'Inter, sans-serif', fontSize: '1.3rem', fontWeight: 800, color: '#111827', margin: '0 0 6px 0'
  },
  subtitle: {
    fontSize: '0.85rem', color: '#6B7280', margin: 0, lineHeight: 1.5
  },
  progressCircleWrap: {
    position: 'relative', width: 64, height: 64, flexShrink: 0
  },
  progressSvg: {
    width: '100%', height: '100%', transform: 'rotate(-90deg)'
  },
  progressText: {
    position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'
  },
  list: {
    display: 'flex', flexDirection: 'column', gap: 12
  },
  taskItem: {
    display: 'flex', alignItems: 'center', gap: 16, padding: '16px',
    border: '1px solid #F3F4F6', borderRadius: 12, transition: 'all 0.2s'
  },
  checkBtn: {
    background: 'none', border: 'none', cursor: 'pointer', padding: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'color 0.2s'
  },
  taskBody: {
    flex: 1
  },
  taskHeader: {
    display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4
  },
  taskTitle: {
    margin: 0, fontSize: '0.95rem', fontWeight: 700, transition: 'color 0.2s'
  },
  duration: {
    display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.7rem', color: '#9CA3AF', fontWeight: 600,
    background: '#F3F4F6', padding: '2px 8px', borderRadius: 12
  },
  taskDesc: {
    margin: 0, fontSize: '0.8rem', color: '#6B7280', lineHeight: 1.4
  },
  playBtn: {
    width: 36, height: 36, borderRadius: '50%', background: '#EEF6F8', color: '#0D5E6B',
    border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', transition: 'background 0.2s', flexShrink: 0
  },
  celebration: {
    marginTop: 16, padding: '12px', background: '#D1FAE5', color: '#065F46',
    borderRadius: 8, fontSize: '0.85rem', fontWeight: 600, textAlign: 'center'
  }
};
