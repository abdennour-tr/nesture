import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Star, Clock, Trophy, Target } from 'lucide-react';
import { useAuthStore } from '../store';
import api from '../services/api';
import toast from 'react-hot-toast';
import { supabase } from '../services/supabaseClient';

export default function LearnerDashboard() {
  const navigate = useNavigate();
  const { user, profile } = useAuthStore();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    const learnerId = profile?.learner_id || profile?.id || user?.id;
    if (!learnerId) return;
    try {
      const { data, error } = await supabase
        .from('sessions')
        .select('*')
        .or(`learner_id.eq.${learnerId},learner_id.eq.${user?.id || ''}`)
        .order('start_time', { ascending: false });

      if (error) {
        let res = await api.get(`/sessions/learner/${learnerId}?limit=500&_t=${Date.now()}`);
        setSessions(Array.isArray(res.data) ? res.data : (res.data?.sessions || []));
      } else {
        setSessions(data || []);
      }
    } catch (e) {
      console.error("Could not fetch learner stats", e);
    } finally {
      setLoading(false);
    }
  }, [profile, user]);

  useEffect(() => {
    fetchStats();

    const learnerId = profile?.learner_id || profile?.id || user?.id;
    if (!learnerId) return;

    const channel = supabase
      .channel(`learner_dashboard_${learnerId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sessions' },
        () => {
          fetchStats();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchStats, profile, user]);

  // Compute stats securely with Number conversions
  const totalGames = sessions.length;
  // Calculate Level: 1 level per 2 completed games.
  const level = Math.max(1, Math.floor(totalGames / 2) + 1);
  
  const totalMinutes = Math.round(
    sessions.reduce((acc, s) => acc + (parseFloat(s.duration_seconds) || 0), 0) / 60
  );
  
  // Calculate average accuracy
  const totalAcc = sessions.reduce((acc, s) => acc + (parseFloat(s.accuracy_score) || 0), 0);
  const avgAccuracy = totalGames > 0 ? Math.round((totalAcc / totalGames) * 100) : 0;

  // Words completed 
  const totalWords = sessions.reduce((acc, s) => acc + (parseInt(s.perfect_grabs, 10) || 0), 0);

  if (loading) {
    return (
      <div style={styles.root}>
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div style={styles.root}>
      <style>{`
        @media (max-width: 600px) {
          #stat-grid { grid-template-columns: 1fr !important; }
          #learner-container { padding: 30px 20px !important; }
          #learner-title { font-size: 1.8rem !important; }
        }
      `}</style>
      {/* Background decorations */}
      <div style={styles.bgCircle1} />
      <div style={styles.bgCircle2} />
      <div style={styles.bgCircle3} />

      <motion.div 
        id="learner-container"
        style={styles.container}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 20 }}
      >
        <button onClick={() => navigate('/play')} style={styles.backBtn}>
          <ArrowLeft size={20} /> Back to Games
        </button>

        <div style={styles.header}>
          <div style={styles.avatarContainer}>
            <div style={{ ...styles.avatar, overflow: 'hidden', background: profile?.avatar_url ? '#fff' : 'linear-gradient(135deg, #0D5E6B, #1A8FA0)' }}>
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                profile?.first_name?.[0]?.toUpperCase() || 'L'
              )}
            </div>
            
            <label style={{
              position: 'absolute', bottom: -5, left: -5,
              background: '#fff', border: '2px solid #E5E7EB',
              borderRadius: '50%', padding: 6, cursor: 'pointer',
              boxShadow: '0 4px 10px rgba(0,0,0,0.15)',
              zIndex: 10
            }}>
              <span style={{ fontSize: '1rem' }}>📷</span>
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const tId = toast.loading('Uploading avatar...');
                try {
                  const fileExt = file.name.split('.').pop();
                  const filePath = `learner_${user.id}_${Date.now()}.${fileExt}`;
                  const { error: upErr } = await supabase.storage.from('avatars').upload(filePath, file, { upsert: true });
                  if (upErr) throw upErr;
                  
                  const { data } = supabase.storage.from('avatars').getPublicUrl(filePath);
                  
                  // Update database: either public.users (if user row) or public.learners (if child of parent)
                  // Assume learner dashboard uses public.users for the learner login.
                  const { error: updateErr } = await supabase.from('users').update({ avatar_url: data.publicUrl }).eq('id', user.id);
                  if (updateErr) throw updateErr;
                  
                  useAuthStore.getState().updateProfile({ avatar_url: data.publicUrl });
                  toast.success('Profile photo updated!', { id: tId });
                } catch (err) {
                  toast.error('Failed to upload photo: ' + err.message, { id: tId });
                }
              }} />
            </label>

            <motion.div 
              animate={{ rotate: 360 }} 
              transition={{ repeat: Infinity, duration: 20, ease: "linear" }}
              style={styles.starBadge}
            >
              <Star fill="#FCD34D" color="#FCD34D" size={24} />
            </motion.div>
          </div>
          <h1 id="learner-title" style={styles.title}>Super {profile?.first_name || 'Player'}! 🚀</h1>
          <p style={styles.subtitle}>Here is your amazing progress so far.</p>
          <motion.div 
            initial={{ scale: 0.8 }} 
            animate={{ scale: 1 }} 
            whileHover={{ scale: 1.05 }}
            style={styles.levelBadge}
          >
            Level {level}
          </motion.div>
        </div>

        <div id="stat-grid" style={styles.grid}>
          <motion.div whileHover={{ y: -5 }} style={{ ...styles.statCard, background: '#FEF3E2', borderColor: '#FCD34D' }}>
            <div style={{...styles.iconBox, background: '#FCD34D', color: '#B45309'}}>
              <Trophy size={28} />
            </div>
            <div style={styles.statValue}>{totalGames}</div>
            <div style={styles.statLabel}>Games Played</div>
          </motion.div>

          <motion.div whileHover={{ y: -5 }} style={{ ...styles.statCard, background: '#EEF6F8', borderColor: '#1A8FA0' }}>
            <div style={{...styles.iconBox, background: '#1A8FA0', color: '#FFF'}}>
              <Star fill="#FFF" size={28} />
            </div>
            <div style={styles.statValue}>{totalWords}</div>
            <div style={styles.statLabel}>Perfect Actions</div>
          </motion.div>

          <motion.div whileHover={{ y: -5 }} style={{ ...styles.statCard, background: '#F0FDF4', borderColor: '#86EFAC' }}>
            <div style={{...styles.iconBox, background: '#22C55E', color: '#FFF'}}>
              <Target size={28} />
            </div>
            <div style={styles.statValue}>{avgAccuracy}%</div>
            <div style={styles.statLabel}>Accuracy</div>
          </motion.div>

          <motion.div whileHover={{ y: -5 }} style={{ ...styles.statCard, background: '#F3F4F6', borderColor: '#D1D5DB' }}>
            <div style={{...styles.iconBox, background: '#9CA3AF', color: '#FFF'}}>
              <Clock size={28} />
            </div>
            <div style={styles.statValue}>{totalMinutes} <span style={{fontSize: '1rem', fontWeight: 600}}>min</span></div>
            <div style={styles.statLabel}>Time Played</div>
          </motion.div>
        </div>

        <div style={styles.journeyBox}>
          <h3 style={styles.journeyTitle}>Keep going! You're doing great! 🎉</h3>
          <div style={styles.progressBarBg}>
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${Math.min((totalGames / 50) * 100, 100)}%` }}
              transition={{ duration: 1.5, ease: "easeOut" }}
              style={styles.progressBarFill} 
            />
          </div>
          <p style={{ textAlign: 'center', marginTop: 10, color: '#6B7280', fontSize: '0.9rem', fontWeight: 600 }}>
            {50 - totalGames > 0 ? `${50 - totalGames} games to reach the next big level!` : "You reached the highest level!"}
          </p>
        </div>

      </motion.div>
    </div>
  );
}

const styles = {
  root: {
    minHeight: '100vh',
    background: '#EEF6F8',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 24, paddingTop: 40, paddingBottom: 40,
    position: 'relative',
    overflowY: 'auto',
  },
  bgCircle1: { position: 'absolute', width: 600, height: 600, borderRadius: '50%', background: 'radial-gradient(circle, rgba(13,94,107,0.06) 0%, transparent 70%)', top: -150, left: -150 },
  bgCircle2: { position: 'absolute', width: 500, height: 500, borderRadius: '50%', background: 'radial-gradient(circle, rgba(232,132,26,0.08) 0%, transparent 70%)', bottom: -100, right: -100 },
  bgCircle3: { position: 'absolute', width: 300, height: 300, borderRadius: '50%', background: 'radial-gradient(circle, rgba(34,197,94,0.05) 0%, transparent 70%)', top: '40%', left: '60%' },
  
  container: {
    background: '#fff',
    borderRadius: 32,
    padding: '40px 48px',
    maxWidth: 800, width: '100%',
    boxShadow: '0 20px 60px rgba(13,94,107,0.12)',
    position: 'relative', zIndex: 1,
  },
  backBtn: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '10px 18px', background: '#F3F4F6', color: '#4B5563',
    border: 'none', borderRadius: 12,
    fontSize: '0.9rem', fontWeight: 700, cursor: 'pointer',
    position: 'absolute', top: 30, left: 30,
    transition: 'background 0.2s'
  },
  header: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    textAlign: 'center', marginTop: 20, marginBottom: 40,
  },
  avatarContainer: { position: 'relative', marginBottom: 20 },
  avatar: {
    width: 100, height: 100, borderRadius: '50%',
    background: 'linear-gradient(135deg, #0D5E6B, #1A8FA0)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: 'Inter, sans-serif', fontWeight: 800, fontSize: '3rem', color: '#fff',
    border: '4px solid #fff', boxShadow: '0 10px 25px rgba(13,94,107,0.2)'
  },
  starBadge: {
    position: 'absolute', bottom: -5, right: -5,
    background: '#fff', borderRadius: '50%', padding: 4,
    boxShadow: '0 4px 10px rgba(0,0,0,0.1)'
  },
  title: { fontFamily: 'Inter, sans-serif', fontWeight: 800, fontSize: '2.5rem', color: '#0D5E6B', margin: 0 },
  subtitle: { fontSize: '1.1rem', color: '#6B7280', marginTop: 8, fontWeight: 500 },
  
  grid: {
    display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 20, marginBottom: 30
  },
  statCard: {
    padding: 24, borderRadius: 24, border: '2px solid',
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    textAlign: 'center', transition: 'transform 0.2s', cursor: 'default'
  },
  iconBox: {
    width: 56, height: 56, borderRadius: 18,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    marginBottom: 16, boxShadow: '0 8px 16px rgba(0,0,0,0.1)'
  },
  statValue: {
    fontFamily: 'Inter, sans-serif', fontWeight: 800, fontSize: '2.5rem', color: '#1F2937',
    lineHeight: 1
  },
  statLabel: {
    fontSize: '0.9rem', color: '#4B5563', fontWeight: 700, marginTop: 8, textTransform: 'uppercase', letterSpacing: '0.05em'
  },

  journeyBox: {
    background: 'linear-gradient(135deg, #0D5E6B, #1A8FA0)',
    borderRadius: 24, padding: 30, color: '#fff',
    marginTop: 20, boxShadow: '0 10px 30px rgba(13,94,107,0.2)'
  },
  journeyTitle: { textAlign: 'center', fontSize: '1.2rem', fontWeight: 800, margin: '0 0 16px', fontFamily: 'Inter, sans-serif' },
  progressBarBg: {
    height: 16, background: 'rgba(255,255,255,0.2)', borderRadius: 10, overflow: 'hidden'
  },
  progressBarFill: {
    height: '100%', background: '#FCD34D', borderRadius: 10,
    boxShadow: 'inset 0 -2px 0 rgba(0,0,0,0.1)'
  }
};
