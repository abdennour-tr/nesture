import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { ArrowLeft, Download, Plus, CheckCircle, ChevronLeft, ChevronRight, User, Play } from 'lucide-react';
import Sidebar from '../components/shared/Sidebar';
import ReflexScoreCard from '../components/shared/ReflexScoreCard';
import api from '../services/api';
import toast from 'react-hot-toast';
import { useAuthStore } from '../store';
import BetaFooter from '../components/shared/BetaFooter';
import AtlasProfileTab from '../components/shared/AtlasProfileTab';
import FloatingAskButton from '../components/shared/FloatingAskButton';
import VideoModal from '../components/shared/VideoModal';

import { Users, BarChart2, Activity, FileText, User as UserIcon, AlertTriangle, TrendingUp, Brain, Check } from 'lucide-react';

const NAV = [
  { to: '/ot', label: 'Learner Overview', icon: <Users size={18} />, end: true },
];

export default function LearnerDetail() {
  const { user } = useAuthStore();
  const { learnerId } = useParams();
  const navigate = useNavigate();

  const [learner,   setLearner]   = useState(null);
  const [sessions,  setSessions]  = useState([]);
  const [reflexes,  setReflexes]  = useState([]);
  const [exercises, setExercises] = useState([]);
  const [activeVideoUrl, setActiveVideoUrl] = useState(null);
  const [activeVideoTitle, setActiveVideoTitle] = useState('');
  const [analysis,  setAnalysis]  = useState(null);
  const [prescriptions, setPrescriptions] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [prescribing, setPrescribing] = useState(false);
  const [detailTab, setDetailTab] = useState('sessions'); // 'sessions' | 'atlas' | 'exercises' | 'reports'

  // Refactored History States
  const [historySessions, setHistorySessions] = useState([]);
  const [totalSessions, setTotalSessions] = useState(0);
  const [historyPage, setHistoryPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [diffFilter, setDiffFilter] = useState('all');
  const [dateRange, setDateRange] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [accFilter, setAccFilter] = useState('all');
  const [gameFilter, setGameFilter] = useState('all');
  const [archivedFilter, setArchivedFilter] = useState('active');
  const [viewMode, setViewMode] = useState('pagination'); // 'pagination' or 'progressive'

  useEffect(() => { fetchAll(); }, [learnerId]);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [lRes, sRes, rRes, exRes, presRes] = await Promise.all([
        api.get(`/learners/${learnerId}`),
        api.get(`/sessions/learner/${learnerId}?limit=50`),
        api.get(`/reflexes/learner/${learnerId}/summary`),
        api.get('/exercises/'),
        api.get(`/exercises/prescriptions/${learnerId}`),
      ]);
      setLearner(lRes.data);
      setSessions(sRes.data);
      setReflexes(rRes.data);
      setExercises(exRes.data);
      setPrescriptions(presRes.data);

      if (sRes.data.length > 0) {
        const aRes = await api.get(`/sessions/${sRes.data[0].id}/analysis`);
        setAnalysis(aRes.data);
      }
      
      // Load initial history
      await fetchHistory(learnerId, 1, false);
    } catch { toast.error('Could not load learner data'); }
    finally { setLoading(false); }
  };

  const fetchHistory = async (childId, page = 1, append = false) => {
    try {
      let url = `/sessions/learner/${childId}?limit=${itemsPerPage}&page=${page}`;
      if (gameFilter !== 'all') url += `&game_name=${encodeURIComponent(gameFilter)}`;
      if (archivedFilter !== 'all') url += `&archived=${archivedFilter}`;
      if (diffFilter !== 'all') url += `&difficulty=${diffFilter}`;
      if (accFilter !== 'all') url += `&min_accuracy=${accFilter}`;
      
      if (dateRange === '7') {
        const d = new Date(); d.setDate(d.getDate() - 7);
        url += `&start_date=${d.toISOString().slice(0, 10)}`;
      } else if (dateRange === '30') {
        const d = new Date(); d.setDate(d.getDate() - 30);
        url += `&start_date=${d.toISOString().slice(0, 10)}`;
      } else if (dateRange === '90') {
        const d = new Date(); d.setDate(d.getDate() - 90);
        url += `&start_date=${d.toISOString().slice(0, 10)}`;
      } else if (dateRange === 'custom') {
        if (startDate) url += `&start_date=${startDate}`;
        if (endDate) url += `&end_date=${endDate}`;
      }

      const res = await api.get(url);
      const fetched = res.data.sessions || [];
      const total = res.data.totalCount || 0;

      if (append) {
        setHistorySessions(prev => [...prev, ...fetched]);
      } else {
        setHistorySessions(fetched);
      }
      setTotalSessions(total);
    } catch (err) {
      toast.error('Failed to load session history');
    }
  };

  useEffect(() => {
    if (learnerId && !loading) {
      setHistoryPage(1);
      fetchHistory(learnerId, 1, false);
    }
  }, [gameFilter, archivedFilter, dateRange, startDate, endDate, diffFilter, accFilter, itemsPerPage, viewMode, learnerId]);

  const handlePageChange = (newPage) => {
    setHistoryPage(newPage);
    fetchHistory(learnerId, newPage, false);
  };

  const assignExercise = async (exerciseId) => {
    try {
      const res = await api.post('/exercises/prescribe', {
        learner_id: learnerId,
        exercise_id: exerciseId,
        specialist_id: user?.id,
      });
      toast.success('Exercise assigned!');
      // Add to local prescriptions state
      const ex = exercises.find(e => e.id === exerciseId);
      setPrescriptions(prev => [...prev, { id: res.data.prescription_id, exercise_id: exerciseId, learner_id: learnerId, exercise: ex || {} }]);
    } catch { toast.error('Could not assign exercise'); }
  };

  const downloadReport = async () => {
    if (!sessions[0]) return;
    try {
      const res = await api.get(`/reports/${sessions[0].id}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a'); a.href = url;
      a.download = `Report_${learner?.name?.replace(' ','_')}.pdf`; 
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    } catch { toast.error('Error downloading report'); }
  };

  const chartData = [...sessions].reverse().map((s, i) => ({
    session: `S${i + 1}`,
    accuracy: Math.round(parseFloat(s.accuracy_score || 0) * 100),
    responseTime: parseFloat((parseFloat(s.avg_response_time_ms || 0) / 1000).toFixed(1)),
    lpi: parseInt(s.lpi_score || 0),
  }));

  const needsAttention = reflexes.some(r => r.confidence_level === 'High' && parseInt(r.score) < 40);

  if (loading) {
    return (
      <div className="page-layout">
        <Sidebar navItems={NAV} />
        <div className="main-content" style={{ display:'flex',alignItems:'center',justifyContent:'center' }}>
          <div className="spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className="page-layout">
      <Sidebar navItems={NAV} />
      <main className="main-content">
        {/* Header */}
        <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} style={styles.header} className="ot-detail-header">
          <button onClick={() => navigate('/ot')} style={styles.backBtn}>
            <ArrowLeft size={16} /> All Learners
          </button>
          <div style={styles.headerRight}>
            <div style={{ ...styles.avatar, background: learner?.avatar_color || '#0D5E6B', overflow: 'hidden' }}>
              {learner?.avatar_url ? (
                <img src={learner.avatar_url} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <User size={24} />
              )}
            </div>
            <div>
              <h1 style={styles.learnerName}>{learner?.name}</h1>
              <p style={styles.learnerInfo}>Age {learner?.age} · {learner?.diagnosis}</p>
            </div>
            {needsAttention && <span className="badge badge-danger" style={{ marginLeft: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}><AlertTriangle size={14} /> Needs Attention</span>}
          </div>
          <div style={{ display:'flex', gap:10, marginLeft:'auto' }}>
            <button onClick={downloadReport} className="btn btn-secondary btn-sm">
              <Download size={14} /> Export Report
            </button>
          </div>
        </motion.div>

        {/* PRD v5: Tab navigation — same views as Parent Dashboard */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 20, background: '#F3F4F6', borderRadius: 12, padding: 3 }} className="ot-detail-tabs">
          {[
            { id: 'sessions', label: <span style={{display: 'flex', alignItems: 'center', gap: 6}}><TrendingUp size={16} /> Sessions & Progress</span> },
            { id: 'atlas', label: <span style={{display: 'flex', alignItems: 'center', gap: 6}}><Brain size={16} /> Atlas Profile</span> },
            { id: 'exercises', label: <span style={{display: 'flex', alignItems: 'center', gap: 6}}><Activity size={16} /> Exercises</span> },
            { id: 'reports', label: <span style={{display: 'flex', alignItems: 'center', gap: 6}}><FileText size={16} /> Reports</span> },
          ].map(t => (
            <button key={t.id} onClick={() => setDetailTab(t.id)} style={{
              flex: 1, padding: '10px 12px', border: 'none', borderRadius: 10,
              fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer',
              background: detailTab === t.id ? '#fff' : 'transparent',
              color: detailTab === t.id ? '#0D5E6B' : '#6B7280',
              boxShadow: detailTab === t.id ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
              transition: 'all 0.2s', fontFamily: 'Inter, sans-serif',
            }}>{t.label}</button>
          ))}
        </div>

        {/* ═══ TAB: Atlas Profile ═══ */}
        {detailTab === 'atlas' && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <AtlasProfileTab childId={learnerId} childName={learner?.name || 'Learner'} readOnly={true} />
          </motion.div>
        )}

        {/* ═══ TAB: Sessions & Progress ═══ */}
        {detailTab === 'sessions' && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>

        {/* Charts */}
        <div style={styles.twoCol} className="ot-two-col">
          <div className="card" style={{ padding: 24, minWidth: 0 }}>
            <div className="section-header">
              <span className="section-title">Accuracy & LPI Trend</span>
            </div>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={chartData} margin={{ top:5,right:10,bottom:5,left:-20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                <XAxis dataKey="session" tick={{ fontSize:11, fill:'#9CA3AF' }} />
                <YAxis tick={{ fontSize:11, fill:'#9CA3AF' }} domain={[0,100]} />
                <Tooltip contentStyle={{ borderRadius:10,border:'none',fontSize:12 }} />
                <Line type="monotone" dataKey="accuracy" stroke="#0D5E6B" strokeWidth={2.5}
                  dot={{ r:4 }} name="Accuracy %" />
                <Line type="monotone" dataKey="lpi" stroke="#E8841A" strokeWidth={2}
                  strokeDasharray="4 2" dot={{ r:3 }} name="LPI" />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="card" style={{ padding: 24, minWidth: 0 }}>
            <div className="section-header">
              <span className="section-title">Response Time Trend</span>
            </div>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={chartData} margin={{ top:5,right:10,bottom:5,left:-20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                <XAxis dataKey="session" tick={{ fontSize:11, fill:'#9CA3AF' }} />
                <YAxis tick={{ fontSize:11, fill:'#9CA3AF' }} />
                <Tooltip contentStyle={{ borderRadius:10,border:'none',fontSize:12 }} />
                <Line type="monotone" dataKey="responseTime" stroke="#8B5CF6" strokeWidth={2.5}
                  dot={{ r:4 }} name="Response Time (s)" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Reflex assessment panel */}
        <div className="card" style={{ padding:24, marginTop:16 }}>
          <div className="section-header">
            <span className="section-title">Primitive Reflex Assessment Panel</span>
            <span style={{ fontSize:'0.8rem', color:'#9CA3AF' }}>
              Data from {sessions.length} sessions
            </span>
          </div>
          <div style={styles.reflexGrid} className="ot-reflex-grid">
            {reflexes.map((r) => (
              <ReflexScoreCard
                key={r.reflex_name}
                reflex={r.reflex_name}
                score={r.score}
                confidence={r.confidence_level}
                trend={r.trend}
              />
            ))}
          </div>
          {analysis?.narrative && (
            <div style={styles.aiBox}>
              <span style={{ fontSize:'0.75rem', fontWeight:700, color:'#0D5E6B',
                textTransform:'uppercase', letterSpacing:'0.05em' }}>AI Analysis</span>
              <p style={{ fontSize:'0.875rem', color:'#374151', marginTop:6, lineHeight:1.7 }}>
                {analysis.narrative}
              </p>
            </div>
          )}
        </div>

          </motion.div>
        )}

        {/* ═══ TAB: Exercises ═══ */}
        {detailTab === 'exercises' && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>

        {/* Exercise assignment */}
        <div className="card" style={{ padding:24 }}>
          <div className="section-header">
            <span className="section-title">Exercise Assignment</span>
            <span style={{ fontSize:'0.8rem', color:'#9CA3AF' }}>
              Assign exercises to {learner?.name?.split(' ')[0]}
            </span>
          </div>

          {/* Already assigned exercises */}
          {(() => {
            const assignedIds = new Set(prescriptions.map(p => p.exercise_id));
            const assignedExercises = exercises.filter(e => assignedIds.has(e.id));
            const unassignedExercises = exercises.filter(e => !assignedIds.has(e.id));
            return (
              <>
              {assignedExercises.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#10B981', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 4 }}><Check size={12} /> Assigned ({assignedExercises.length})</div>
                  <div style={styles.exerciseGrid} className="ot-exercise-grid">
                    {assignedExercises.map((ex) => (
                      <div key={ex.id} style={{ ...styles.exCard, border: '2px solid #86EFAC', background: '#F0FDF4' }}>
                        <div style={styles.exCardTop}>
                          <span className="badge badge-teal">{ex.target_reflex}</span>
                          <span style={{ fontSize:'0.7rem', color:'#9CA3AF' }}>{ex.duration_minutes} min</span>
                        </div>
                        <div style={styles.exCardName}>{ex.name}</div>
                        <div style={styles.exCardDesc}>{ex.description.slice(0, 80)}…</div>
                        <div style={styles.exCardFooter}>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <span className={`badge badge-${ex.difficulty_level === 'easy' ? 'success' : 'warning'}`}>
                              {ex.difficulty_level}
                            </span>
                            {ex.video_url && (
                              <button 
                                onClick={() => { setActiveVideoUrl(ex.video_url); setActiveVideoTitle(ex.name); }}
                                style={{ padding: '2px 6px', background: '#EEF6F8', color: '#0D5E6B', border: '1px solid #B2DFE6', borderRadius: 4, fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                              >
                                <Play size={10} /> Watch
                              </button>
                            )}
                          </div>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#10B981', fontSize: '0.75rem', fontWeight: 700 }}>
                            <CheckCircle size={14} /> Assigned
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {unassignedExercises.length > 0 && (
                <div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>Available ({unassignedExercises.length})</div>
                  <div style={styles.exerciseGrid} className="ot-exercise-grid">
                    {unassignedExercises.slice(0, 6).map((ex) => (
                      <div key={ex.id} style={styles.exCard}>
                        <div style={styles.exCardTop}>
                          <span className="badge badge-teal">{ex.target_reflex}</span>
                          <span style={{ fontSize:'0.7rem', color:'#9CA3AF' }}>{ex.duration_minutes} min</span>
                        </div>
                        <div style={styles.exCardName}>{ex.name}</div>
                        <div style={styles.exCardDesc}>{ex.description.slice(0, 80)}…</div>
                        <div style={styles.exCardFooter}>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <span className={`badge badge-${ex.difficulty_level === 'easy' ? 'success' : 'warning'}`}>
                              {ex.difficulty_level}
                            </span>
                            {ex.video_url && (
                              <button 
                                onClick={() => { setActiveVideoUrl(ex.video_url); setActiveVideoTitle(ex.name); }}
                                style={{ padding: '2px 6px', background: '#EEF6F8', color: '#0D5E6B', border: '1px solid #B2DFE6', borderRadius: 4, fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                              >
                                <Play size={10} /> Watch
                              </button>
                            )}
                          </div>
                          <button onClick={() => assignExercise(ex.id)} style={styles.prescribeBtn}>
                            <Plus size={12} /> Assign
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              </>
            );
          })()}
        </div>

          </motion.div>
        )}

        {/* ═══ TAB: Reports ═══ */}
        {detailTab === 'reports' && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            {/* Session history */}
            {(() => {
              const totalPages = Math.ceil(totalSessions / itemsPerPage);
              const activePage = Math.min(historyPage, Math.max(1, totalPages));
              return (
            <div className="card" style={{ marginTop:16 }}>
              {/* Header */}
              <div style={{ padding: '20px 24px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, borderBottom: '1px solid #F3F4F6' }}>
                <div>
                  <span className="section-title">Session History (IEP Reference)</span>
                  <span style={{ fontSize: '0.78rem', color: '#9CA3AF', marginLeft: 12 }}>
                    Showing {totalSessions} session{totalSessions !== 1 ? 's' : ''} (from {sessions.length} total)
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  {/* View Mode Segmented Selector */}
                  <div style={{ display: 'flex', background: '#F3F4F6', borderRadius: 8, padding: 3, border: '1px solid #E5E7EB' }}>
                    <button
                      type="button"
                      onClick={() => { setViewMode('pagination'); setHistoryPage(1); }}
                      style={{
                        padding: '4px 10px', fontSize: '0.7rem', fontWeight: 700, borderRadius: 6, cursor: 'pointer', border: 'none',
                        background: viewMode === 'pagination' ? '#fff' : 'transparent',
                        color: viewMode === 'pagination' ? '#0D5E6B' : '#6B7280',
                        boxShadow: viewMode === 'pagination' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                      }}
                    >
                      Page Navigation
                    </button>
                    <button
                      type="button"
                      onClick={() => { setViewMode('progressive'); setHistoryPage(1); }}
                      style={{
                        padding: '4px 10px', fontSize: '0.7rem', fontWeight: 700, borderRadius: 6, cursor: 'pointer', border: 'none',
                        background: viewMode === 'progressive' ? '#fff' : 'transparent',
                        color: viewMode === 'progressive' ? '#0D5E6B' : '#6B7280',
                        boxShadow: viewMode === 'progressive' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                      }}
                    >
                      Load More
                    </button>
                  </div>

                  {viewMode === 'pagination' && (
                    <>
                      <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#6B7280' }}>Sessions per page:</span>
                      <select 
                        value={itemsPerPage} 
                        onChange={e => setItemsPerPage(parseInt(e.target.value, 10))}
                        style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #D1D5DB', fontSize: '0.75rem', outline: 'none' }}
                      >
                        <option value={5}>5</option>
                        <option value={10}>10</option>
                        <option value={25}>25</option>
                        <option value={50}>50</option>
                      </select>
                      <span style={{ fontSize: '0.78rem', color: '#9CA3AF' }}>Page {activePage} of {totalPages || 1}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Dynamic Filters Bar */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, padding: '14px 24px', background: '#F9FAFB', borderBottom: '1px solid #F3F4F6', alignItems: 'center' }}>
                {/* Date Range Selector */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: '0.65rem', fontWeight: 800, color: '#4B5563', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Date Range</label>
                  <select 
                    value={dateRange} 
                    onChange={e => setDateRange(e.target.value)}
                    style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: '0.78rem', outline: 'none', background: '#fff' }}
                  >
                    <option value="all">All Time</option>
                    <option value="7">Last 7 Days</option>
                    <option value="30">Last 30 Days</option>
                    <option value="90">Last 90 Days</option>
                    <option value="custom">Custom Range</option>
                  </select>
                </div>

                {dateRange === 'custom' && (
                  <>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <label style={{ fontSize: '0.65rem', fontWeight: 800, color: '#4B5563', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Start Date</label>
                      <input 
                        type="date" 
                        value={startDate} 
                        onChange={e => setStartDate(e.target.value)}
                        style={{ padding: '5px 8px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: '0.78rem', outline: 'none' }} 
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <label style={{ fontSize: '0.65rem', fontWeight: 800, color: '#4B5563', textTransform: 'uppercase', letterSpacing: '0.05em' }}>End Date</label>
                      <input 
                        type="date" 
                        value={endDate} 
                        onChange={e => setEndDate(e.target.value)}
                        style={{ padding: '5px 8px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: '0.78rem', outline: 'none' }} 
                      />
                    </div>
                  </>
                )}

                {/* Game (Jeu) Selector */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: '0.65rem', fontWeight: 800, color: '#4B5563', textTransform: 'uppercase', letterSpacing: '0.05em' }}>NesturePlay (Games)</label>
                  <select 
                    value={gameFilter} 
                    onChange={e => setGameFilter(e.target.value)}
                    style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: '0.78rem', outline: 'none', background: '#fff' }}
                  >
                    <option value="all">All Activities</option>
                    <option value="LetterQuest">LetterQuest</option>
                    <option value="Magic Finger Copy">Magic Finger Copy</option>
                    <option value="MatchFinger">MatchFinger</option>
                    <option value="Path Tracing">Path Tracing</option>
                    <option value="Magic Finger Copy">Magic Finger Copy</option>
                  </select>
                </div>

                {/* Archiving Status Selector */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: '0.65rem', fontWeight: 800, color: '#4B5563', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Timeframe</label>
                  <select 
                    value={archivedFilter} 
                    onChange={e => setArchivedFilter(e.target.value)}
                    style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: '0.78rem', outline: 'none', background: '#fff' }}
                  >
                    <option value="active">Recent Activities (Last 30 days)</option>
                    <option value="archived">Older Activities (Older than 30 days)</option>
                    <option value="all">All Activities</option>
                  </select>
                </div>

                {/* Difficulty Selector */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: '0.65rem', fontWeight: 800, color: '#4B5563', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Difficulty</label>
                  <select 
                    value={diffFilter} 
                    onChange={e => setDiffFilter(e.target.value)}
                    style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: '0.78rem', outline: 'none', background: '#fff' }}
                  >
                    <option value="all">All Difficulties</option>
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                </div>

                {/* Min Accuracy Selector */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: '0.65rem', fontWeight: 800, color: '#4B5563', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Minimum Success Rate</label>
                  <select 
                    value={accFilter} 
                    onChange={e => setAccFilter(e.target.value)}
                    style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: '0.78rem', outline: 'none', background: '#fff' }}
                  >
                    <option value="all">All Activities</option>
                    <option value="70">70% Success or above</option>
                    <option value="90">90% Success or above</option>
                  </select>
                </div>
              </div>

              <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th><th>NesturePlay (Games)</th><th>Duration</th><th>Success Rate</th>
                    <th>Attempts</th><th>Perfect</th><th>LPI</th>
                    <th>Scenario</th><th>Report</th>
                  </tr>
                </thead>
                <tbody>
                  {historySessions.map((s) => (
                    <tr key={s.id} style={{ opacity: s.is_archived ? 0.65 : 1 }}>
                      <td>{s.start_time?.slice(0,10)}</td>
                      <td>
                        <span style={{ fontWeight: 700, fontSize: '0.75rem', color: s.game_name === 'Path Tracing' ? '#8B5CF6' : (s.game_name?.includes('Finger') || s.game_name?.includes('Match')) ? '#EC4899' : '#0D5E6B' }}>
                          {s.game_name || 'LetterQuest'}
                        </span>
                        {s.is_archived && (
                          <span style={{ marginLeft: 6, fontSize: '0.65rem', background: '#E5E7EB', color: '#4B5563', padding: '1px 4px', borderRadius: 4, fontWeight: 800 }}>ARCHIVED</span>
                        )}
                      </td>
                      <td>{Math.round(parseInt(s.duration_seconds||0)/60)} min</td>
                      <td>
                        <span style={{ fontWeight:600, color: parseFloat(s.accuracy_score)>0.7 ? '#10B981' : '#F59E0B' }}>
                          {Math.round(parseFloat(s.accuracy_score||0)*100)}%
                        </span>
                      </td>
                      <td>{s.total_attempts}</td>
                      <td style={{ color:'#10B981', fontWeight:600 }}>{s.perfect_grabs}</td>
                      <td style={{ fontFamily:'Inter,sans-serif', fontWeight:700, color:'#0D5E6B' }}>
                        {s.game_name === 'Magic Finger Copy' ? '-' : s.lpi_score}
                      </td>
                      <td>
                        {s.game_name === 'Magic Finger Copy' ? '-' : (
                          <span className={`badge badge-${s.scenario === 'happy_path' ? 'success' : 'warning'}`}>
                            {s.scenario === 'happy_path' ? 'On Track' : 'Attention'}
                          </span>
                        )}
                      </td>
                      <td>
                        {s.game_name === 'Magic Finger Copy' ? '-' : (
                          <button
                            onClick={async () => {
                              try {
                                const res = await api.get(`/reports/${s.id}/pdf`, { responseType:'blob' });
                                const url = URL.createObjectURL(new Blob([res.data], { type:'application/pdf' }));
                                const a = document.createElement('a'); a.href = url;
                                a.download = `Report_${s.id.slice(0,8)}.pdf`; 
                                document.body.appendChild(a); a.click(); document.body.removeChild(a);
                              } catch { toast.error('Error downloading report'); }
                            }}
                            style={{ color:'#0D5E6B', background:'none', border:'none', cursor:'pointer', fontWeight:600, fontSize:'0.8rem' }}
                          >⬇ PDF</button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {historySessions.length === 0 && (
                    <tr>
                      <td colSpan="9" style={{ textAlign: 'center', padding: '24px', color: '#9CA3AF', fontStyle: 'italic' }}>
                        No sessions found matching filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              </div>

              {/* Progressive Loading - Load More Button */}
              {viewMode === 'progressive' && historySessions.length < totalSessions && (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 24px', borderTop: '1px solid #F3F4F6' }}>
                  <button
                    onClick={() => {
                      const nextPage = historyPage + 1;
                      setHistoryPage(nextPage);
                      fetchHistory(learnerId, nextPage, true);
                    }}
                    style={{
                      padding: '8px 20px', background: '#0D5E6B', color: '#fff', border: 'none', borderRadius: 8,
                      fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 8px rgba(13,94,107,0.15)'
                    }}
                  >
                    Load More Sessions ({totalSessions - historySessions.length} remaining)
                  </button>
                </div>
              )}

              {/* Pagination controls */}
              {viewMode === 'pagination' && totalPages > 1 && (
                <div style={styles.pagination}>
                  <button
                    disabled={activePage <= 1}
                    onClick={() => handlePageChange(Math.max(1, activePage - 1))}
                    style={{ ...styles.pageBtn, opacity: activePage <= 1 ? 0.4 : 1 }}
                  >
                    <ChevronLeft size={14} /> Previous
                  </button>
                  <div style={styles.pageIndicator}>
                    {Array.from({ length: totalPages }, (_, i) => (
                      <button
                        key={i}
                        onClick={() => handlePageChange(i + 1)}
                        style={{
                          ...styles.pageDot,
                          ...(activePage === i + 1 ? styles.pageDotActive : {}),
                        }}
                      >
                        {i + 1}
                      </button>
                    ))}
                  </div>
                  <button
                    disabled={activePage >= totalPages}
                    onClick={() => handlePageChange(Math.min(totalPages, activePage + 1))}
                    style={{ ...styles.pageBtn, opacity: activePage >= totalPages ? 0.4 : 1 }}
                  >
                    Next <ChevronRight size={14} />
                  </button>
                </div>
              )}
            </div>
              );
            })()}
          </motion.div>
        )}

        <FloatingAskButton childName={learner?.name || learner?.first_name || 'your learner'} childId={learnerId} />
        <VideoModal isOpen={!!activeVideoUrl} videoUrl={activeVideoUrl} title={activeVideoTitle} onClose={() => setActiveVideoUrl(null)} />
        <BetaFooter variant="light" />
      </main>
    </div>
  );
}

const styles = {
  header: { display:'flex', alignItems:'center', gap:16, marginBottom:24, flexWrap:'wrap' },
  backBtn: {
    display:'flex', alignItems:'center', gap:6,
    padding:'8px 14px', background:'#EEF6F8',
    border:'1.5px solid #C8E8ED', borderRadius:8,
    color:'#0D5E6B', fontSize:'0.82rem', fontWeight:600, cursor:'pointer',
  },
  headerRight: { display:'flex', alignItems:'center', gap:14 },
  avatar: {
    width:48, height:48, borderRadius:'50%',
    display:'flex', alignItems:'center', justifyContent:'center',
    fontFamily:'Inter,sans-serif', fontWeight:800, fontSize:'1.2rem', color:'#fff',
  },
  learnerName: { fontFamily:'Inter,sans-serif', fontWeight:800, fontSize:'1.3rem', color:'#0D5E6B' },
  learnerInfo: { fontSize:'0.8rem', color:'#9CA3AF', marginTop:2 },
  twoCol: { display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:0 },
  reflexGrid: { display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, marginBottom:16 },
  aiBox: {
    background:'#EEF6F8', borderRadius:12, padding:'14px 16px',
    border:'1px solid #C8E8ED',
  },
  exerciseGrid: { display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12 },
  exCard: {
    background:'#F9FAFB', borderRadius:12, padding:'14px',
    border:'1px solid #E5E7EB', display:'flex', flexDirection:'column', gap:6,
  },
  exCardTop: { display:'flex', justifyContent:'space-between', alignItems:'center' },
  exCardName: { fontWeight:700, fontSize:'0.875rem', color:'#1F2937' },
  exCardDesc: { fontSize:'0.75rem', color:'#6B7280', lineHeight:1.5 },
  exCardFooter: { display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:4 },
  prescribeBtn: {
    display:'flex', alignItems:'center', gap:4,
    padding:'5px 12px', background:'#0D5E6B', color:'#fff',
    border:'none', borderRadius:7, fontSize:'0.75rem', fontWeight:600, cursor:'pointer',
  },
  pagination: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    gap: 12, padding: '16px 24px', borderTop: '1px solid #E5E7EB',
  },
  pageBtn: {
    display: 'flex', alignItems: 'center', gap: 4,
    padding: '7px 14px', background: '#EEF6F8', color: '#0D5E6B',
    border: '1px solid #C8E8ED', borderRadius: 8,
    fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
  },
  pageIndicator: { display: 'flex', gap: 6 },
  pageDot: {
    width: 32, height: 32, borderRadius: 8,
    background: '#F3F4F6', color: '#6B7280',
    border: '1px solid #E5E7EB',
    fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  pageDotActive: {
    background: '#0D5E6B', color: '#fff', border: '1px solid #0D5E6B',
  },
};
