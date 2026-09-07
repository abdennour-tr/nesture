import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { LogOut, Play, Lock, Gamepad2, Zap, Clock, Target, BarChart2, Star, Trophy, Menu, X, ChevronLeft, ChevronRight, CheckCircle, Video } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useAuthStore } from '../store';
import api from '../services/api';
import toast from 'react-hot-toast';
import { supabase } from '../services/supabaseClient';
import BetaBadge from '../components/shared/BetaBadge';
import BetaFooter from '../components/shared/BetaFooter';
import VideoModal from '../components/shared/VideoModal';

/* ─── "not ready yet" notice ─────────────────────────────
   Shown when a child taps a game that is still being built. It explains the
   situation in words a child can read and offers the way back, rather than
   failing silently or opening something unfinished. */
function ComingSoonModal({ game, onClose }) {
  if (!game) return null;
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 4000,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: 'clamp(12px, 4vh, 32px)', overflowY: 'auto',
        background: 'rgba(8, 20, 26, 0.62)',
        backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
      }}
    >
      <motion.div
        role="dialog" aria-modal="true" aria-labelledby="cs-title"
        onClick={(e) => e.stopPropagation()}
        initial={{ scale: 0.9, y: 24, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.94, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 24 }}
        style={{
          /* margin:auto centres it while it fits and never clips it when the
             window is short -- align-items:center would cut off the top. */
          margin: 'auto', width: 'min(440px, 100%)',
          background: '#FFFFFF', borderRadius: 24, padding: 'clamp(20px, 3vh, 30px)',
          boxShadow: '0 30px 70px -20px rgba(8, 20, 26, 0.55)',
          border: '1px solid rgba(124, 58, 237, 0.18)', textAlign: 'center',
        }}
      >
        <div style={{
          width: 76, height: 76, margin: '0 auto 16px', borderRadius: 22,
          display: 'grid', placeItems: 'center', fontSize: '2.4rem',
          background: game.bg, border: `2px solid ${game.accent}33`,
        }}>{game.emoji}</div>

        <div style={{
          display: 'inline-block', marginBottom: 12, padding: '4px 12px',
          borderRadius: 999, fontSize: '0.66rem', fontWeight: 900,
          letterSpacing: '0.09em', color: game.accent,
          background: `${game.accent}14`, border: `1px solid ${game.accent}33`,
        }}>UNDER CONSTRUCTION</div>

        <h2 id="cs-title" style={{
          margin: '0 0 10px', fontSize: '1.4rem', fontWeight: 800, color: '#0D3D47',
        }}>{game.title} is almost ready</h2>

        <p style={{
          margin: '0 0 22px', fontSize: '0.95rem', lineHeight: 1.55, color: '#4B5563',
        }}>
          We are still building this game. It will unlock as soon as it is
          finished — until then, pick another one and keep practising!
        </p>

        <button
          onClick={onClose}
          style={{
            width: '100%', padding: '13px 24px', borderRadius: 15, border: 'none',
            cursor: 'pointer', color: '#fff', fontSize: '1rem', fontWeight: 700,
            background: `linear-gradient(135deg, ${game.accent}, #0EA5E9)`,
            boxShadow: `0 10px 24px ${game.accent}44`,
          }}
        >
          Choose another game
        </button>
      </motion.div>
    </motion.div>
  );
}

/* ─── animated counter hook ─────────────────────────── */
function useCountUp(target, duration = 1200) {
  const [value, setValue] = useState(0);
  const raf = useRef(null);
  useEffect(() => {
    if (target === 0) { setValue(0); return; }
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min((now - start) / duration, 1);
      setValue(Math.round(p * target));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target, duration]);
  return value;
}

/* ─── game catalogue ─────────────────────────────────── */
const GAMES = [
  {
    id: 'letterquest',
    title: 'LetterQuest',
    desc: 'Practice spelling words visually with hand gestures',
    emoji: '🔤',
    accent: '#1A8FA0',
    bg: 'linear-gradient(135deg, #EEF6F8 0%, #D1ECF0 100%)',
    enabled: true,
    route: '/play/difficulty',
    badge: 'ACTIVE',
  },
  {
    id: 'ladybug',
    title: 'Follow the Ladybug',
    desc: 'Trace the moving ladybug with your index finger!',
    emoji: '🐞',
    accent: '#E53E3E',
    bg: 'linear-gradient(135deg, #E6FFEC 0%, #C6F6D5 100%)',
    enabled: true,
    route: '/play/ladybug-difficulty',
    badge: 'NEW',
  },
  {
    id: 'bubble',
    title: 'Pop the Bubble',
    desc: 'Point at the bubbles and pop them with your index finger!',
    emoji: '🫧',
    accent: '#0EA5E9',
    bg: 'linear-gradient(135deg, #E0F2FE 0%, #BAE6FD 100%)',
    enabled: true,
    route: '/play/bubble-difficulty',
    badge: 'NEW',
  },
  {
    id: 'tracetype',
    title: 'Trace → Find → Type',
    desc: 'Learn letters by tracing, finding & typing them',
    emoji: '✏️',
    accent: '#6366F1',
    bg: 'linear-gradient(135deg, #EEF2FF 0%, #E0E7FF 100%)',
    enabled: true,
    route: '/play/trace-type-difficulty',
    badge: 'NEW',
  },
  {
    id: 'pinchcoin',
    title: 'Pinch the Coin',
    desc: 'Pinch the coin and drop it in the piggy bank!',
    emoji: '🪙',
    accent: '#F59E0B',
    bg: 'linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%)',
    enabled: true,
    route: '/play/pinch-coin-difficulty',
    badge: 'NEW',
  },
  {
    id: 'fingerpiano',
    title: 'Finger Piano',
    desc: 'Play piano keys using the correct fingers!',
    emoji: '🎹',
    accent: '#7C3AED',
    bg: 'linear-gradient(135deg, #F5F3FF 0%, #EDE9FE 100%)',
    enabled: true,
    /* Sealed on request. The card opens the "almost ready" notice instead of
       the game. This flag and the two redirects in App.js must always agree —
       to unseal, drop this line, put the routes back, and uncomment App.js's
       two imports. */
    comingSoon: true,
    route: '/play/finger-piano-difficulty',
    badge: 'COMING SOON',
  },
  {
    id: 'fingercopy',
    title: 'Magic Finger Copy',
    desc: 'Imitate hand gestures using your webcam',
    emoji: '🖐️',
    accent: '#8B5CF6',
    bg: 'linear-gradient(135deg, #F3E8FF 0%, #DDD6FE 100%)',
    enabled: true,
    route: '/play/finger-copy-difficulty',
    badge: 'NEW',
  },
  {
    id: 'touchstar',
    title: 'Touch the Star',
    desc: 'Reach out and touch the glowing stars!',
    emoji: '⭐',
    accent: '#F59E0B',
    bg: '#FFFBEB',
    enabled: false,
    badge: 'Under construction'
  },
  {
    id: 'dottodot',
    title: 'Dot-to-Dot',
    desc: 'Connect the dots to reveal a hidden picture!',
    emoji: '🖍️',
    accent: '#F59E0B',
    bg: '#FFFBEB',
    enabled: false,
    badge: 'Under construction'
  },
  {
    id: 'dragapple',
    title: 'Drag the Apple',
    desc: 'Drag and drop the apples into the basket!',
    emoji: '🍎',
    accent: '#F59E0B',
    bg: '#FFFBEB',
    enabled: false,
    badge: 'Under construction'
  },
  {
    id: 'fingerzone',
    title: 'Finger Zone',
    desc: 'Keep your fingers inside the safe zones!',
    emoji: '🎯',
    accent: '#F59E0B',
    bg: '#FFFBEB',
    enabled: false,
    badge: 'Under construction'
  }
];

/* ════════════════════════════════════════════════════════ */
export default function LearnerHome() {
  const { user, profile, logout } = useAuthStore();
  const navigate = useNavigate();
  const { search } = useLocation();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [prescriptions, setPrescriptions] = useState([]);
  const [comingSoonGame, setComingSoonGame] = useState(null);
  const [activeVideoUrl, setActiveVideoUrl] = useState(null);
  const [activeVideoTitle, setActiveVideoTitle] = useState('');

  /* Reaching a locked game by its URL -- a bookmark, the back button, a typed
     address -- redirects here with ?locked=<id>. Showing the same notice means
     the child gets an explanation instead of a silent bounce. */
  useEffect(() => {
    const id = new URLSearchParams(search).get('locked');
    if (!id) return;
    const game = GAMES.find((g) => g.id === id && g.comingSoon);
    if (game) setComingSoonGame(game);
  }, [search]);

  useEffect(() => {
    const learnerId = profile?.learner_id || user?.id;
    if (!learnerId) return;

    const fetchPrescriptions = async () => {
      try {
        const res = await api.get(`/exercises/prescriptions/${learnerId}`);
        setPrescriptions(res.data || []);
      } catch (err) {
        console.error('Could not fetch prescriptions', err);
      }
    };

    fetchPrescriptions();

    const channel = supabase
      .channel(`prescriptions_learner_${learnerId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'prescriptions',
          filter: `learner_id=eq.${learnerId}`,
        },
        () => {
          fetchPrescriptions();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, profile?.learner_id]);

  const handleMarkAsCompleted = async (prescriptionId) => {
    try {
      await api.post(`/exercises/prescriptions/${prescriptionId}/status`, { status: 'completed' });
      toast.success('Awesome job! Exercise completed! 🌟');
      setPrescriptions(prev => prev.map(p => p.id === prescriptionId ? { ...p, status: 'completed' } : p));
    } catch (err) {
      toast.error('Could not update exercise status');
    }
  };

  useEffect(() => {
    async function fetchStats() {
      if (!user) { setLoading(false); return; }
      try {
        // Use profile.learner_id (children.id) for session lookups,
        // NOT user.id (auth.users.id) which doesn't match session data.
        const learnerId = profile?.learner_id || user.id;
        let res = await api.get(`/sessions/learner/${learnerId}?limit=500`);
        setSessions(res.data || []);
      } catch (e) {
        console.error('Could not fetch learner stats', e);
      } finally {
        setLoading(false);
      }
    }
    fetchStats();
  }, [user?.id, profile?.learner_id]);

  /* ── helper to get real accuracy from notes for past sessions ── */
  const getAccuracyScore = (sess) => {
    let acc = parseFloat(sess.accuracy_score) || 0;
    try {
      if (sess.notes) {
        const notes = typeof sess.notes === 'string' ? JSON.parse(sess.notes) : sess.notes;
        if (sess.game_name?.toLowerCase().includes('ladybug')) {
          if (notes.performanceScore !== undefined) {
            acc = notes.performanceScore / 100;
          } else if (notes.score !== undefined) {
            acc = notes.score / 100;
          }
        }
      }
    } catch (e) {
      console.warn("Failed to parse notes for session", sess.id, e);
    }
    // Safety fallback if something is drastically wrong
    if (acc > 1 && acc <= 100) acc = acc / 100;
    return acc;
  };

  /* ── computed stats ── */
  const totalGames = sessions.length;
  const level = Math.max(1, Math.floor(totalGames / 2) + 1);
  const totalMinutes = Math.round(
    sessions.reduce((a, s) => a + (parseFloat(s.duration_seconds) || 0), 0) / 60
  );
  const totalAcc = sessions.reduce((a, s) => a + getAccuracyScore(s), 0);
  const avgAccuracy = totalGames > 0 ? Math.round((totalAcc / totalGames) * 100) : 0;

  /* animated values */
  const animLevel = useCountUp(loading ? 0 : level);
  const animTime = useCountUp(loading ? 0 : totalMinutes);
  const animAcc = useCountUp(loading ? 0 : avgAccuracy);

  const [activeView, setActiveView] = useState('games');
  const [historyPage, setHistoryPage] = useState(1);

  /* ── 30-day filter for history ── */
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  const historySessions = sessions.filter(s => {
    if (!s.start_time) return false;
    return new Date(s.start_time) >= thirtyDaysAgo;
  });

  const REPORTS_PER_PAGE = 8;
  const totalHistoryPages = Math.ceil(historySessions.length / REPORTS_PER_PAGE);
  const pagedHistory = historySessions.slice((historyPage - 1) * REPORTS_PER_PAGE, historyPage * REPORTS_PER_PAGE);

  /* ── chart data (last 10 sessions reversed chronologically) ── */
  const chartData = [...sessions].reverse().slice(-10).map((s, i) => ({
    session: `S${i + 1}`,
    accuracy: Math.round(getAccuracyScore(s) * 100),
    duration: Math.round(parseFloat(s.duration_seconds || 0) / 60),
  }));

  const totalWords = sessions.reduce((a, s) => a + (parseInt(s.perfect_grabs, 10) || 0), 0);

  const handleLogout = () => {
    logout();
    toast.success('See you next time! 👋');
    navigate('/login');
  };

  const firstName = profile?.first_name || user?.user_metadata?.first_name || 'Player';
  const initial = firstName?.[0]?.toUpperCase() || 'P';
  const fullName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || firstName;

  const [isOpen, setIsOpen] = useState(false);
  const toggleSidebar = () => setIsOpen(!isOpen);

  return (
    <div style={s.root} className="page-layout lh-root">
      <style>{`
        .mobile-menu-btn {
          position: fixed; top: 15px; left: 15px; z-index: 2000;
          background: rgba(13, 61, 71, 0.9); backdrop-filter: blur(8px);
          border: 1px solid rgba(255,255,255,0.1); borderRadius: 12px;
          color: #fff; padding: 8px 14px; display: none; align-items: center; gap: 8px;
          font-weight: 700; font-size: 0.9rem; box-shadow: 0 4px 15px rgba(0,0,0,0.2); cursor: pointer;
        }
        .sidebar-overlay {
          position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
          background: rgba(0,0,0,0.5); backdrop-filter: blur(4px); z-index: 99;
        }
        .sidebar-close-btn {
          display: none; background: none; border: none; color: #fff; cursor: pointer;
          position: absolute; right: 15px; top: 15px;
        }
        @media (max-width: 1100px) {
          .mobile-menu-btn { display: flex; }
          .sidebar-close-btn { display: block; }
        }
        @media (max-width: 768px) {
          .lh-header {
            flex-direction: column !important;
            align-items: stretch !important;
            gap: 16px !important;
          }
          .lh-kpi-row {
            grid-template-columns: repeat(2, 1fr) !important;
          }
        }
        @media (max-width: 640px) {
          .lh-main {
            padding: 70px 12px 20px !important;
          }
          .lh-stats {
            justify-content: center !important;
            gap: 8px !important;
          }
          .lh-greet-banner {
            flex-direction: column !important;
            align-items: flex-start !important;
            gap: 12px !important;
            padding: 20px 16px !important;
          }
          .lh-greet-title {
            font-size: 1.5rem !important;
          }
          .lh-games-grid {
            grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)) !important;
            gap: 14px !important;
          }
        }
        @media (max-width: 480px) {
          .lh-main {
            padding: 70px 8px 16px !important;
          }
          .lh-stats {
            flex-direction: column !important;
            align-items: stretch !important;
          }
          .lh-stats > div {
            min-width: 0 !important;
          }
          .lh-kpi-row {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>

      {/* Mobile Menu Button */}
      <button className="mobile-menu-btn" onClick={toggleSidebar}>
        {isOpen ? <X size={20} /> : <Menu size={20} />}
        <span>Menu</span>
      </button>

      {/* Sidebar Overlay */}
      {isOpen && <div className="sidebar-overlay" onClick={() => setIsOpen(false)} />}

      {/* ══════════ SIDEBAR ══════════ */}
      <aside 
        style={{...s.sidebar, transform: isOpen ? 'translateX(0)' : undefined}} 
        className={`sidebar lh-sidebar ${isOpen ? 'is-open' : ''}`}
      >
        <button className="sidebar-close-btn" onClick={() => setIsOpen(false)}>
          <X size={20} />
        </button>
        {/* top decoration */}
        <div style={s.sidebarGlow} />

        {/* avatar + name */}
        <div style={s.sidebarUser} className="sidebar-user lh-sidebar-user">
          <div style={{...s.avatarLg, overflow: 'hidden', background: profile?.avatar_url ? 'transparent' : 'linear-gradient(135deg, #1A8FA0, #23BFDB)'}} className="lh-avatar">
            {profile?.avatar_url ? (
              <img src={profile.avatar_url} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              initial
            )}
          </div>
          <div style={s.userName}>{fullName}</div>
          <div style={s.userRole}>Learner</div>
        </div>

        {/* nav */}
        <nav style={s.nav} className="sidebar-nav lh-nav">
          <div
            onClick={() => setActiveView('games')}
            style={{ ...s.navItem, ...(activeView === 'games' ? s.navActive : {}) }}
            className="sidebar-nav-item"
          >
            <Gamepad2 size={18} />
            <span>Games</span>
          </div>
          <div
            onClick={() => setActiveView('progress')}
            style={{ ...s.navItem, ...(activeView === 'progress' ? s.navActive : {}) }}
            className="sidebar-nav-item"
          >
            <BarChart2 size={18} />
            <span>My Progress</span>
          </div>
          <div
            onClick={() => setActiveView('exercises')}
            style={{ ...s.navItem, ...(activeView === 'exercises' ? s.navActive : {}) }}
            className="sidebar-nav-item"
          >
            <CheckCircle size={18} />
            <span>My Exercises</span>
          </div>
        </nav>

        <div style={s.sidebarSpacer} className="lh-spacer" />

        {/* sign out */}
        <motion.button
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          onClick={handleLogout}
          style={s.signOutBtn}
          className="sidebar-logout"
        >
          <LogOut size={16} />
          Sign Out
        </motion.button>
      </aside>

      {/* ══════════ MAIN WRAPPER (header + content) ══════════ */}
      <div style={s.mainWrapper} className="main-content lh-main">

        {/* ══════════ HEADER ══════════ */}
        <header style={s.header} className="lh-header">
          <div style={s.headerLeft}>
            <div>
              <div style={s.headerLogo}>Nesture AI <BetaBadge variant="dark" size="small" /></div>
              <div style={s.headerSubtitle}>NesturePlay</div>
            </div>
          </div>

          <div style={s.statsRow} className="lh-stats">
            {/* Level */}
            <motion.div
              whileHover={{ y: -3, boxShadow: '0 8px 24px rgba(13,94,107,0.2)' }}
              style={{ ...s.statBadge, ...s.statBadgeLevel }}
            >
              <div style={{ ...s.statIcon, background: 'linear-gradient(135deg,#0D5E6B,#1A8FA0)' }}>
                <Zap size={14} fill="#fff" color="#fff" />
              </div>
              <div style={s.statBody}>
                <div style={s.statVal}>{loading ? '—' : animLevel}</div>
                <div style={s.statLbl}>Level</div>
              </div>
            </motion.div>

            {/* Time */}
            <motion.div
              whileHover={{ y: -3, boxShadow: '0 8px 24px rgba(107,114,128,0.2)' }}
              style={{ ...s.statBadge, ...s.statBadgeTime }}
            >
              <div style={{ ...s.statIcon, background: 'linear-gradient(135deg,#374151,#6B7280)' }}>
                <Clock size={14} color="#fff" />
              </div>
              <div style={s.statBody}>
                <div style={s.statVal}>{loading ? '—' : `${animTime}min`}</div>
                <div style={s.statLbl}>Time Played</div>
              </div>
            </motion.div>

            {/* Accuracy */}
            <motion.div
              whileHover={{ y: -3, boxShadow: '0 8px 24px rgba(34,197,94,0.2)' }}
              style={{ ...s.statBadge, ...s.statBadgeAcc }}
            >
              <div style={{ ...s.statIcon, background: 'linear-gradient(135deg,#15803D,#22C55E)' }}>
                <Target size={14} color="#fff" />
              </div>
              <div style={s.statBody}>
                <div style={s.statVal}>{loading ? '—' : `${animAcc}%`}</div>
                <div style={s.statLbl}>Accuracy</div>
              </div>
            </motion.div>


          </div>
        </header>

        {/* ══════════ CONTENT ══════════ */}
        <main style={s.content}>
          <AnimatePresence mode="wait">

          {/* ─── GAMES VIEW ─── */}
          {activeView === 'games' && (
          <motion.div key="games"
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.3 }}
          >
            <div style={s.greetBanner} className="lh-greet-banner">
              <div>
                <h1 style={s.greetTitle} className="lh-greet-title">Hello, {firstName}! 👋</h1>
                <p style={s.greetSub}>Choose a game and start playing right now.</p>
              </div>
              {totalGames > 0 && (
                <div style={s.streakChip}>🔥 {totalGames} games played</div>
              )}
            </div>
            <div style={s.sectionLabel}>My Games</div>
            <div style={s.gamesGrid} className="lh-games-grid">
              <AnimatePresence>
                {GAMES.map((game, i) => (
                  <motion.button
                    key={game.id}
                    initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.08 }}
                    whileHover={game.enabled ? { y: -6, boxShadow: `0 16px 40px ${game.accent}33` } : {}}
                    whileTap={game.enabled ? { scale: 0.97 } : {}}
                    onClick={() => {
                      if (!game.enabled) return;
                      if (game.comingSoon) { setComingSoonGame(game); return; }
                      navigate(game.route);
                    }}
                    style={{
                      ...s.gameCard,
                      background: game.bg,
                      borderColor: game.enabled ? game.accent : '#E5E7EB',
                      cursor: game.enabled ? 'pointer' : 'not-allowed',
                      opacity: game.enabled ? 1 : 0.58,
                    }}
                  >
                    {game.badge && <div style={{ ...s.gameBadge, background: game.accent }}>{game.badge}</div>}
                    <div style={s.gameTop}>
                      <div style={s.gameEmoji}>{game.emoji}</div>
                      {game.enabled
                        ? <div style={{ ...s.playCircle, background: game.accent }}><Play size={14} fill="#fff" color="#fff" /></div>
                        : <Lock size={18} color="#9CA3AF" />}
                    </div>
                    <div style={{ ...s.gameTitle, color: game.enabled ? '#0D3D47' : '#4B5563' }}>{game.title}</div>
                    <div style={s.gameDesc}>{game.desc}</div>
                    {game.enabled && (
                      <div style={s.gameProgressBg}>
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.min((totalGames / 50) * 100, 100)}%` }}
                          transition={{ duration: 1.4, ease: 'easeOut' }}
                          style={{ ...s.gameProgressFill, background: game.accent }}
                        />
                      </div>
                    )}
                  </motion.button>
                ))}
              </AnimatePresence>
            </div>
          </motion.div>
          )}

          {/* ─── PROGRESS VIEW ─── */}
          {activeView === 'progress' && (
          <motion.div key="progress"
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.3 }}
          >
            <div style={s.greetBanner} className="lh-greet-banner">
              <div>
                <h1 style={s.greetTitle} className="lh-greet-title">My Progress 📈</h1>
                <p style={s.greetSub}>See how far you've come, {firstName}!</p>
              </div>
              <div style={{ ...s.streakChip, background: 'linear-gradient(135deg,#EEF6F8,#D1ECF0)', borderColor: '#1A8FA0', color: '#0D5E6B' }}>
                🏆 Level {level}
              </div>
            </div>

            {/* KPI mini row */}
            <div style={s.progKpiRow} className="lh-kpi-row">
              {[
                { icon: <Trophy size={18} color="#B45309" />, bg: '#FEF3E2', border: '#FCD34D', val: totalGames, lbl: 'Games Played' },
                { icon: <Star size={18} color="#fff" />, bg: '#1A8FA0', border: '#1A8FA0', val: totalWords, lbl: 'Perfect Actions', iconStyle: { color: '#fff' } },
                { icon: <Target size={18} color="#fff" />, bg: '#22C55E', border: '#86EFAC', val: `${avgAccuracy}%`, lbl: 'Avg Accuracy' },
                { icon: <Clock size={18} color="#fff" />, bg: '#6B7280', border: '#D1D5DB', val: `${totalMinutes}m`, lbl: 'Time Played' },
              ].map((k, i) => (
                <motion.div key={i} whileHover={{ y: -4 }} style={{ ...s.progKpiCard, borderColor: k.border }}>
                  <div style={{ ...s.progKpiIcon, background: k.bg }}>{k.icon}</div>
                  <div style={s.progKpiVal}>{loading ? '—' : k.val}</div>
                  <div style={s.progKpiLbl}>{k.lbl}</div>
                </motion.div>
              ))}
            </div>

            {/* Accuracy chart */}
            <div style={s.chartCard}>
              <div style={s.chartHeader}>
                <span style={s.sectionLabel}>Accuracy Over Sessions</span>
                <span style={s.chartNote}>{sessions.length} total sessions</span>
              </div>
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={chartData} margin={{ top: 5, right: 16, bottom: 5, left: -20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F0F5F7" />
                    <XAxis dataKey="session" tick={{ fontSize: 11, fill: '#9CA3AF' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#9CA3AF' }} domain={[0, 100]} />
                    <Tooltip
                      contentStyle={{ borderRadius: 10, border: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.1)', fontSize: 12 }}
                      formatter={(v) => [`${v}%`, 'Accuracy']}
                    />
                    <Line type="monotone" dataKey="accuracy" stroke="#1A8FA0" strokeWidth={2.5}
                      dot={{ r: 4, fill: '#1A8FA0' }} activeDot={{ r: 6 }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div style={s.emptyChart}>No sessions yet — play a game to see your progress! 🎮</div>
              )}
            </div>

            {/* Session history */}
            <div style={s.chartCard}>
              <div style={s.chartHeader}>
                <span style={s.sectionLabel}>Recent Sessions (Last 30 Days)</span>
                <span style={s.chartNote}>{historySessions.length} records · Page {historyPage} of {totalHistoryPages || 1}</span>
              </div>
              {historySessions.length > 0 ? (
                <>
                <table style={s.progTable} className="data-table">
                  <thead>
                    <tr style={s.progThead}>
                      {['Date', 'Game', 'Duration', 'Accuracy', 'Difficulty', 'Perfect Actions'].map(h => (
                        <th key={h} style={s.progTh}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pagedHistory.map((sess, i) => {
                      const finalAcc = getAccuracyScore(sess);
                      return (
                        <tr key={i} style={{ borderBottom: '1px solid #F0F5F7' }}>
                          <td data-label="Date" style={s.progTd}>{sess.start_time?.slice(0, 10) || '—'}</td>
                          <td data-label="Game" style={{ ...s.progTd, fontWeight: 600 }}>
                            {sess.game_name === 'LetterQuest' ? 'LetterQuest' : (sess.game_name || 'LetterQuest')}
                          </td>
                          <td data-label="Duration" style={s.progTd}>{Math.round((parseFloat(sess.duration_seconds) || 0) / 60)} min</td>
                          <td data-label="Accuracy" style={s.progTd}>
                            <span style={{ fontWeight: 700, color: finalAcc > 0.7 ? '#22C55E' : '#F59E0B' }}>
                              {Math.round(finalAcc * 100)}%
                            </span>
                          </td>
                          <td data-label="Difficulty" style={s.progTd}>
                            <span style={{
                              ...s.diffBadge,
                              background: sess.difficulty === 'hard' ? '#FEE2E2' : sess.difficulty === 'medium' ? '#FEF9C3' : '#D1FAE5',
                              color: sess.difficulty === 'hard' ? '#991B1B' : sess.difficulty === 'medium' ? '#92400E' : '#065F46',
                            }}>{sess.difficulty || '—'}</span>
                          </td>
                          <td data-label="Perfect Actions" style={s.progTd}>{parseInt(sess.perfect_grabs, 10) || 0}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {/* Pagination Controls */}
                {totalHistoryPages > 1 && (
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 24 }}>
                    <button
                      disabled={historyPage <= 1}
                      onClick={() => setHistoryPage(p => Math.max(1, p - 1))}
                      style={{ ...s.pageBtn, opacity: historyPage <= 1 ? 0.4 : 1 }}
                    >
                      <ChevronLeft size={16} /> Prev
                    </button>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {Array.from({ length: totalHistoryPages }, (_, i) => (
                        <button
                          key={i}
                          onClick={() => setHistoryPage(i + 1)}
                          style={{
                            ...s.pageDot,
                            ...(historyPage === i + 1 ? s.pageDotActive : {}),
                          }}
                        >
                          {i + 1}
                        </button>
                      ))}
                    </div>
                    <button
                      disabled={historyPage >= totalHistoryPages}
                      onClick={() => setHistoryPage(p => Math.min(totalHistoryPages, p + 1))}
                      style={{ ...s.pageBtn, opacity: historyPage >= totalHistoryPages ? 0.4 : 1 }}
                    >
                      Next <ChevronRight size={16} />
                    </button>
                  </div>
                )}
                </>
              ) : (
                <div style={s.emptyChart}>No recent sessions in the last 30 days. Play a game to see your progress! 🎮</div>
              )}
            </div>
          </motion.div>
          )}

          {/* ─── EXERCISES VIEW ─── */}
          {activeView === 'exercises' && (
            <motion.div key="exercises"
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.3 }}
            >
              <div style={s.greetBanner} className="lh-greet-banner">
                <div>
                  <h1 style={s.greetTitle} className="lh-greet-title">My Exercises 🎯</h1>
                  <p style={s.greetSub}>Complete the activities assigned to you by your specialist.</p>
                </div>
              </div>

              {/* Active Exercises */}
              <div style={{ marginBottom: 32 }}>
                <div style={s.sectionLabel}>Active Exercises</div>
                {prescriptions.filter(p => p.status === 'active' || !p.status).length > 0 ? (
                  <div style={s.gamesGrid} className="lh-games-grid">
                    {prescriptions.filter(p => p.status === 'active' || !p.status).map((pres) => (
                      <div
                        key={pres.id}
                        style={{
                          ...s.gameCard,
                          background: 'linear-gradient(135deg, #FFFDFB 0%, #FFF7ED 100%)',
                          borderColor: '#FDBA74',
                        }}
                      >
                        <div style={{ ...s.gameBadge, background: '#EA580C' }}>
                          Assigned by {pres.specialist ? `${pres.specialist.first_name || ''} ${pres.specialist.last_name || ''}`.trim() : 'Specialist'}
                        </div>
                        <div style={s.gameTop}>
                          <div style={s.gameEmoji}><Video size={42} color="#EA580C" /></div>
                        </div>
                        <div style={{ ...s.gameTitle, color: '#431407' }}>
                          {pres.exercise?.name || 'Exercise'}
                        </div>
                        <div style={{ fontSize: '0.78rem', color: '#7C2D12', fontWeight: 600, marginBottom: 8 }}>
                          Target Reflex: {pres.exercise?.target_reflex || 'General'}
                        </div>
                        {pres.notes && (
                          <div style={{
                            fontSize: '0.78rem', color: '#7C2D12', background: '#FFF8F2',
                            padding: '10px 14px', borderRadius: 12, borderLeft: '3.5px solid #F97316',
                            marginBottom: 16, lineHeight: 1.4
                          }}>
                            💡 {pres.notes}
                          </div>
                        )}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto' }}>
                          <span style={{ fontSize: '0.72rem', color: '#9CA3AF', fontWeight: 600 }}>{pres.exercise?.duration_minutes || 5} min</span>
                          <div style={{ display: 'flex', gap: 8 }}>
                            {pres.exercise?.video_url && (
                              <button
                                onClick={() => {
                                  setActiveVideoUrl(pres.exercise.video_url);
                                  setActiveVideoTitle(pres.exercise.name || 'Exercise Video');
                                }}
                                style={{
                                  display: 'inline-flex', alignItems: 'center', gap: 5,
                                  padding: '8px 14px', borderRadius: 12, border: 'none',
                                  color: '#fff', fontSize: '0.75rem', fontWeight: 700,
                                  background: '#0D5E6B', textDecoration: 'none', cursor: 'pointer'
                                }}
                              >
                                <Play size={12} fill="#fff" color="#fff" /> Watch
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={s.emptyChart}>No active assigned exercises right now. Keep up the good work! 🌟</div>
                )}
              </div>

              {/* Completed Exercises */}
              <div>
                <div style={s.sectionLabel}>Completed Exercises</div>
                {prescriptions.filter(p => p.status === 'completed').length > 0 ? (
                  <div style={s.gamesGrid} className="lh-games-grid">
                    {prescriptions.filter(p => p.status === 'completed').map((pres) => (
                      <div
                        key={pres.id}
                        style={{
                          ...s.gameCard,
                          background: '#F9FAFB',
                          borderColor: '#E5E7EB',
                          opacity: 0.8
                        }}
                      >
                        <div style={{ ...s.gameBadge, background: '#10B981' }}>Completed</div>
                        <div style={s.gameTop}>
                          <div style={s.gameEmoji}>🏆</div>
                        </div>
                        <div style={{ ...s.gameTitle, color: '#374151' }}>
                          {pres.exercise?.name || 'Exercise'}
                        </div>
                        <div style={{ fontSize: '0.78rem', color: '#6B7280', fontWeight: 600, marginBottom: 8 }}>
                          Target Reflex: {pres.exercise?.target_reflex || 'General'}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto' }}>
                          <span style={{ fontSize: '0.72rem', color: '#9CA3AF', fontWeight: 600 }}>Completed</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={s.emptyChart}>Completed exercises will appear here.</div>
                )}
              </div>
            </motion.div>
          )}

          </AnimatePresence>
          <BetaFooter variant="light" />
        </main>
      </div>

      <AnimatePresence>
        {comingSoonGame && (
          <ComingSoonModal
            key="coming-soon"
            game={comingSoonGame}
            onClose={() => setComingSoonGame(null)}
          />
        )}
      </AnimatePresence>

      <VideoModal 
        isOpen={!!activeVideoUrl} 
        videoUrl={activeVideoUrl} 
        title={activeVideoTitle}
        onClose={() => setActiveVideoUrl(null)} 
      />
    </div>
  );
}

/* ══════════ STYLES ══════════ */
const TEAL_DARK = '#0D3D47';
const TEAL = '#0D5E6B';
const TEAL_MID = '#1A8FA0';
const WHITE = '#fff';

const s = {
  root: {
    display: 'flex',
    minHeight: '100dvh',
    background: '#E8F0F3',
    fontFamily: "'Inter', 'Inter', sans-serif",
    padding: 14,
    gap: 14,
    boxSizing: 'border-box',
    alignItems: 'flex-start',
  },

  /* ── sidebar ── */
  sidebar: {
    width: 230,
    minWidth: 230,
    background: `linear-gradient(180deg, ${TEAL_DARK} 0%, #0A2E36 100%)`,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '24px 14px 20px',
    position: 'sticky',
    top: 14,
    overflowY: 'auto',
    borderRadius: 20,
    border: '1px solid rgba(255,255,255,0.06)',
    boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
    zIndex: 10,
    flexShrink: 0,
    alignSelf: 'flex-start',
    minHeight: 'calc(100dvh - 28px)',
  },
  sidebarGlow: {
    position: 'absolute',
    top: -80,
    left: -80,
    width: 240,
    height: 240,
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(26,143,160,0.25) 0%, transparent 70%)',
    pointerEvents: 'none',
  },
  sidebarLogo: {
    width: 48,
    height: 48,
    borderRadius: 16,
    background: 'linear-gradient(135deg, #1A8FA0, #23BFDB)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
    boxShadow: '0 8px 20px rgba(26,143,160,0.4)',
  },
  logoMark: {
    fontFamily: "'Inter', sans-serif",
    fontWeight: 800,
    fontSize: '1.1rem',
    color: WHITE,
    letterSpacing: 1,
  },
  sidebarUser: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    marginBottom: 32,
    textAlign: 'center',
  },
  avatarLg: {
    width: 72,
    height: 72,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #1A8FA0, #23BFDB)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: "'Inter', sans-serif",
    fontWeight: 800,
    fontSize: '2rem',
    color: WHITE,
    marginBottom: 12,
    border: '3px solid rgba(255,255,255,0.15)',
    boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
  },
  userName: {
    fontFamily: "'Inter', sans-serif",
    fontWeight: 700,
    fontSize: '1rem',
    color: WHITE,
    marginBottom: 4,
  },
  userRole: {
    fontSize: '0.75rem',
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
  },
  nav: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  navItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '12px 16px',
    borderRadius: 12,
    fontSize: '0.9rem',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.55)',
    cursor: 'pointer',
    transition: 'all 0.2s',
    border: 'none',
    background: 'transparent',
    width: '100%',
  },
  navActive: {
    background: 'rgba(26,143,160,0.25)',
    color: '#7FDBEA',
    border: '1px solid rgba(26,143,160,0.35)',
  },
  sidebarSpacer: { flex: 1 },
  signOutBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 18px',
    background: 'rgba(255,255,255,0.07)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 12,
    color: 'rgba(255,255,255,0.65)',
    fontSize: '0.85rem',
    fontWeight: 600,
    cursor: 'pointer',
    width: '100%',
    justifyContent: 'center',
    transition: 'all 0.2s',
  },

  /* ── main wrapper ── */
  mainWrapper: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    gap: 14,
    minWidth: 0,
  },

  /* ── header ── */
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    background: WHITE,
    border: '1px solid #DDE8EB',
    borderRadius: 16,
    padding: '12px 24px',
    boxShadow: '0 4px 20px rgba(13,94,107,0.07)',
    zIndex: 5,
    flexWrap: 'wrap',
    flexShrink: 0,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexShrink: 0,
  },
  headerLogo: {
    fontFamily: "'Inter', sans-serif",
    fontWeight: 800,
    fontSize: '1.3rem',
    color: TEAL,
    letterSpacing: '-0.02em',
    lineHeight: 1.2,
  },
  headerSubtitle: {
    fontSize: '0.72rem',
    color: '#9CA3AF',
    fontWeight: 600,
    letterSpacing: '0.04em',
    marginTop: 2,
  },

  /* stat badges row */
  statsRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  statBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 14px',
    borderRadius: 14,
    border: '1.5px solid',
    background: WHITE,
    transition: 'all 0.2s',
    cursor: 'default',
    minWidth: 100,
  },
  statBadgeLevel: {
    borderColor: '#B2DFE6',
    background: 'linear-gradient(135deg, #F0FAFB 0%, #E0F4F7 100%)',
  },
  statBadgeTime: {
    borderColor: '#D1D5DB',
    background: 'linear-gradient(135deg, #F9FAFB 0%, #F3F4F6 100%)',
  },
  statBadgeAcc: {
    borderColor: '#86EFAC',
    background: 'linear-gradient(135deg, #F0FDF4 0%, #DCFCE7 100%)',
  },
  statIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    boxShadow: '0 4px 8px rgba(0,0,0,0.12)',
  },
  statBody: {
    display: 'flex',
    flexDirection: 'column',
  },
  statVal: {
    fontFamily: "'Inter', sans-serif",
    fontWeight: 800,
    fontSize: '1.05rem',
    color: '#1F2937',
    lineHeight: 1.1,
  },
  statLbl: {
    fontSize: '0.65rem',
    fontWeight: 700,
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: '0.07em',
    marginTop: 2,
  },

  /* level progress pill */
  progressPill: {
    padding: '8px 14px',
    background: '#FEF3E2',
    borderRadius: 14,
    border: '1.5px solid #FCD34D',
    minWidth: 130,
  },
  progressPillInner: {},
  progressPillLabel: {
    fontSize: '0.62rem',
    fontWeight: 700,
    color: '#B45309',
    textTransform: 'uppercase',
    letterSpacing: '0.07em',
    marginBottom: 5,
  },
  progressPillBar: {
    height: 6,
    background: 'rgba(252,211,77,0.3)',
    borderRadius: 10,
    overflow: 'hidden',
    marginBottom: 4,
  },
  progressPillFill: {
    height: '100%',
    background: 'linear-gradient(90deg, #F59E0B, #FCD34D)',
    borderRadius: 10,
  },
  progressPillCount: {
    fontSize: '0.68rem',
    fontWeight: 600,
    color: '#D97706',
  },

  /* ── content ── */
  content: {
    flex: 1,
    padding: '32px 36px',
    overflowY: 'auto',
  },

  /* greet */
  greetBanner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 28,
    flexWrap: 'wrap',
    gap: 12,
  },
  greetTitle: {
    fontFamily: "'Inter', sans-serif",
    fontWeight: 800,
    fontSize: '1.9rem',
    color: TEAL,
    margin: 0,
    lineHeight: 1.15,
  },
  greetSub: {
    fontSize: '0.95rem',
    color: '#6B7280',
    margin: '6px 0 0',
  },
  streakChip: {
    padding: '8px 16px',
    background: 'linear-gradient(135deg, #FEF3E2, #FDE68A)',
    border: '1.5px solid #FCD34D',
    borderRadius: 20,
    fontSize: '0.85rem',
    fontWeight: 700,
    color: '#92400E',
  },

  /* games */
  sectionLabel: {
    fontSize: '0.75rem',
    fontWeight: 800,
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: '0.12em',
    marginBottom: 16,
  },
  gamesGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
    gap: 20,
  },
  gameCard: {
    display: 'flex',
    flexDirection: 'column',
    padding: '22px 20px 16px',
    borderRadius: 20,
    border: '2px solid transparent',
    textAlign: 'left',
    transition: 'all 0.25s',
    position: 'relative',
    overflow: 'hidden',
    boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
  },
  gameBadge: {
    position: 'absolute',
    top: 14,
    right: 14,
    fontSize: '0.6rem',
    fontWeight: 800,
    color: WHITE,
    padding: '3px 8px',
    borderRadius: 20,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  },
  gameTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  gameEmoji: { fontSize: '2.4rem', lineHeight: 1 },
  playCircle: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 4px 10px rgba(0,0,0,0.15)',
    padding: '0 0 0 2px',
  },
  gameTitle: {
    fontFamily: "'Inter', sans-serif",
    fontWeight: 700,
    fontSize: '1.1rem',
    marginBottom: 6,
  },
  gameDesc: {
    fontSize: '0.82rem',
    color: '#6B7280',
    lineHeight: 1.45,
    marginBottom: 16,
    flex: 1,
  },
  gameProgressBg: {
    height: 5,
    background: 'rgba(0,0,0,0.08)',
    borderRadius: 10,
    overflow: 'hidden',
  },
  gameProgressFill: {
    height: '100%',
    borderRadius: 10,
    opacity: 0.75,
  },

  /* ── progress view ── */
  progKpiRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 14,
    marginBottom: 20,
  },
  progKpiCard: {
    background: WHITE,
    borderRadius: 16,
    border: '2px solid',
    padding: '18px 14px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    boxShadow: '0 4px 16px rgba(0,0,0,0.05)',
    transition: 'transform 0.2s',
    cursor: 'default',
  },
  progKpiIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    boxShadow: '0 4px 10px rgba(0,0,0,0.12)',
  },
  progKpiVal: {
    fontFamily: "'Inter', sans-serif",
    fontWeight: 800,
    fontSize: '1.8rem',
    color: '#1F2937',
    lineHeight: 1,
  },
  progKpiLbl: {
    fontSize: '0.72rem',
    fontWeight: 700,
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: '0.07em',
    marginTop: 6,
  },
  chartCard: {
    background: WHITE,
    borderRadius: 16,
    border: '1px solid #DDE8EB',
    padding: '20px 22px',
    marginBottom: 16,
    boxShadow: '0 4px 16px rgba(13,94,107,0.05)',
  },
  chartHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 18,
  },
  chartNote: {
    fontSize: '0.75rem',
    color: '#9CA3AF',
    fontWeight: 600,
  },
  emptyChart: {
    textAlign: 'center',
    padding: '40px 20px',
    color: '#9CA3AF',
    fontSize: '0.9rem',
    fontWeight: 500,
  },
  progTable: {
    width: '100%',
    borderCollapse: 'collapse',
  },
  progThead: { textAlign: 'left', color: '#6B7280', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' },
  progTh: { padding: '12px 16px', borderBottom: '2px solid #E5E7EB' },
  progTd: { padding: '16px', fontSize: '0.9rem', color: '#374151', verticalAlign: 'middle' },
  diffBadge: { padding: '4px 8px', borderRadius: 6, fontSize: '0.75rem', fontWeight: 600, textTransform: 'capitalize' },
  pageBtn: { padding: '6px 12px', background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600, fontSize: '0.8rem', color: '#4B5563' },
  pageDot: { width: 30, height: 30, borderRadius: 8, border: '1px solid #E5E7EB', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.85rem', fontWeight: 600, color: '#4B5563' },
  pageDotActive: { background: '#0D5E6B', color: '#fff', borderColor: '#0D5E6B' },
};
