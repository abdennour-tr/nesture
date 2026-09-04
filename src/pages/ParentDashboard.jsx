import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid
} from 'recharts';
import { Download, Mail, Play, Trash2, ChevronLeft, ChevronRight, UserCheck, User, Lock, Calendar, Activity, X, Shield, Settings, Save, AlertTriangle, Edit3, Brain, LineChart as LineChartIcon, Users, Sparkles, Construction, Camera, Handshake, Eye, EyeOff, Video, CreditCard } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import Sidebar from '../components/shared/Sidebar';
import ReflexScoreCard from '../components/shared/ReflexScoreCard';
import api from '../services/api';
import { useAuthStore } from '../store';
import { validateName, validateNickname, sanitizeInput, validatePassword } from '../utils/security';

import AtlasProfileTab from '../components/shared/AtlasProfileTab';
import BetaFooter from '../components/shared/BetaFooter';
import SmartNotifications from '../components/shared/SmartNotifications';
import NestureAIHub from '../components/shared/NestureAIHub';
import TodayHomePlan from '../components/shared/TodayHomePlan';
import ConsentSettingsModal from '../components/shared/ConsentSettingsModal';
import FloatingAskButton from '../components/shared/FloatingAskButton';
import AddChildModal from '../components/shared/AddChildModal';
import Atlas360Questionnaire from '../components/shared/Atlas360Questionnaire';
import ConnectionModal from '../components/shared/ConnectionModal';
import NestureConnect from '../components/shared/NestureConnect';
import NestureLearn from '../components/shared/NestureLearn';
import AssignedExercises from '../components/shared/AssignedExercises';
import ParentDashboardHeader from '../components/dashboards/ParentDashboardHeader';
import SubscriptionTab from '../components/dashboards/SubscriptionTab';
import { supabase, supabaseUrl } from '../services/supabaseClient';

const NAV = [
  { id: 'atlas',        label: 'Atlas Profile', icon: <Brain size={18} />, end: true },
  { id: 'sessions',     label: 'Sessions & Progress', icon: <LineChartIcon size={18} /> },
  { id: 'connect',      label: 'NestureConnect', icon: <Handshake size={18} /> },
  { id: 'exercises',    label: 'Assigned Exercises', icon: <Video size={18} /> },
  { id: 'learn',        label: 'NestureLearn', icon: <Sparkles size={18} /> },
  { id: 'subscription', label: 'Subscription & Plans', icon: <CreditCard size={18} /> },
  { id: 'settings',     label: 'Settings', icon: <Settings size={18} /> },
];


// --- Link Specialist Modal Component ---
function LinkSpecialistModal({ isOpen, onClose, onLink, professionals, childName }) {
  const [selectedOT, setSelectedOT] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedOT) return;
    setLoading(true);
    try {
      await onLink(selectedOT);
      setSelectedOT('');
      onClose();
    } catch (err) {
      toast.error('Failed to link specialist');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} style={{ background: '#fff', borderRadius: 20, padding: 32, width: '100%', maxWidth: 400, boxShadow: '0 20px 40px rgba(0,0,0,0.15)' }}>
        <h2 style={{ fontFamily: 'Inter, sans-serif', color: '#0D5E6B', fontSize: '1.4rem', fontWeight: 800, marginTop: 0 }}>Link Specialist</h2>
        <p style={{ fontSize: '0.85rem', color: '#6B7280', marginTop: 4, marginBottom: 20 }}>Select a specialist to grant them access to {childName}'s profile and session data.</p>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#374151', marginBottom: 4 }}>Select Specialist</label>
            <select required value={selectedOT} onChange={e => setSelectedOT(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1.5px solid #D1D5DB', background: '#fff' }}>
              <option value="" disabled>Select a specialist...</option>
              {professionals.map(ot => (
                <option key={ot.id} value={ot.id}>{ot.name}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            <button type="button" onClick={onClose} style={{ flex: 1, padding: '12px', background: '#F3F4F6', color: '#374151', borderRadius: 10, fontWeight: 600, border: 'none', cursor: 'pointer' }}>Cancel</button>
            <button type="submit" disabled={loading || !selectedOT} style={{ flex: 1, padding: '12px', background: 'linear-gradient(135deg, #0D5E6B, #1A8FA0)', color: '#fff', borderRadius: 10, fontWeight: 700, border: 'none', cursor: 'pointer', opacity: (loading || !selectedOT) ? 0.7 : 1 }}>
              {loading ? 'Linking...' : 'Link Specialist'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

export default function ParentDashboard() {
  const { user, profile, updateProfile, originalProfile } = useAuthStore();
  const userId = profile?.id || user?.id;
  const [activeTab, setActiveTab]   = useState('atlas');
  const [children, setChildren]     = useState([]);
  const [sessions, setSessions]     = useState([]);
  const [reflexes, setReflexes]     = useState([]);
  const [exercises, setExercises]   = useState([]);
  const [analysis, setAnalysis]     = useState(null);
  const [prescriptions, setPrescriptions] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [childLoading, setChildLoading] = useState(false);
  const [reportPage, setReportPage] = useState(1);
  const [historySessions, setHistorySessions] = useState([]);
  const [totalSessions, setTotalSessions] = useState(0);
  const [historyPage, setHistoryPage] = useState(1);
  const [overviewHistoryPage, setOverviewHistoryPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [diffFilter, setDiffFilter] = useState('all');
  const [dateRange, setDateRange] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [accFilter, setAccFilter] = useState('all');
  const [gameFilter, setGameFilter] = useState('all');
  const [archivedFilter, setArchivedFilter] = useState('active');
  const [viewMode, setViewMode] = useState('pagination'); // 'pagination' or 'progressive'

  const [activeChildId, setActiveChildId] = useState(null);
  const [showAddChildModal, setShowAddChildModal] = useState(false);
  const [showLinkSpecialistModal, setShowLinkSpecialistModal] = useState(false);
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [activeQuestionnaireChildId, setActiveQuestionnaireChildId] = useState(null);
  const [showQuestionnaireModal, setShowQuestionnaireModal] = useState(false);
  const [professionalsList, setProfessionalsList] = useState([]);
  const [activeConnections, setActiveConnections] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [atlasRefresh, setAtlasRefresh] = useState(0);
  const [inProgressQuestionnaires, setInProgressQuestionnaires] = useState({});
  const [currentSubscription, setCurrentSubscription] = useState(null);

  // Settings state
  const [parentForm, setParentForm] = useState({ first_name: '', last_name: '' });
  const [parentSaving, setParentSaving] = useState(false);
  const [childForms, setChildForms] = useState({});
  const [childSaving, setChildSaving] = useState({});

  // Security state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showCurrentPwd, setShowCurrentPwd] = useState(false);
  const [showNewPwd, setShowNewPwd] = useState(false);
  const [showConfirmPwd, setShowConfirmPwd] = useState(false);
  const [securitySaving, setSecuritySaving] = useState(false);
  const [editingChildId, setEditingChildId] = useState(null);

  // Child password reset state
  const [resetPwdChildId, setResetPwdChildId] = useState(null);
  const [resetPwdNewPwd, setResetPwdNewPwd] = useState('');
  const [resetPwdConfirmPwd, setResetPwdConfirmPwd] = useState('');
  const [resetPwdError, setResetPwdError] = useState('');
  const [resetPwdSaving, setResetPwdSaving] = useState(false);
  const [resetPwdShowNew, setResetPwdShowNew] = useState(false);
  const [resetPwdShowConfirm, setResetPwdShowConfirm] = useState(false);

  const navigate = useNavigate();

  // ── Subscription Limit Logic ──────────────────────────────────────────
  const getChildLimit = (sub) => {
    if (!sub) return 0; // No subscription = no children allowed
    const tier = sub.tier?.toLowerCase();
    if (tier === 'family' || tier === 'annual_family' || tier === 'growth' || tier === 'enterprise') {
      return Infinity; // Unlimited children
    }
    // 7day_pass, premium, starter = 1 child
    return 1;
  };

  const childLimit = getChildLimit(currentSubscription);

  const openAddChildWithCheck = () => {
    if (!currentSubscription) {
      toast.error(
        "You must first subscribe to a plan to add a child.",
        { duration: 5000, icon: '🔒' }
      );
      navigate('/pricing');
      return;
    }
    if (children.length >= childLimit) {
      toast.error(
        `Limit reached (${childLimit} child${childLimit > 1 ? 'ren' : ''}). Upgrade to the Family plan to add more children.`,
        { duration: 5000, icon: '⚠️' }
      );
      return;
    }
    setShowAddChildModal(true);
  };

  // Sync parent form when profile loads
  useEffect(() => {
    if (profile) {
      setParentForm({ first_name: profile.first_name || '', last_name: profile.last_name || '' });
    }
  }, [profile]);

  // Handle payment success from Stripe redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('payment') === 'success' || params.get('session_id')) {
      toast.success('🎉 Payment successful! Your subscription is now active.', { duration: 6000 });
      // Clean query params from URL without reloading
      window.history.replaceState({}, document.title, window.location.pathname);
      
      // Polling: Webhook might take a few seconds to update DB. Refetch a few times.
      let attempts = 0;
      const interval = setInterval(() => {
        attempts++;
        if (typeof fetchAll === 'function') {
          fetchAll();
        }
        // Stop polling after 4 attempts (8 seconds)
        if (attempts >= 4) {
          clearInterval(interval);
        }
      }, 2000);

      return () => clearInterval(interval);
    }
  }, []);

  // Sync child forms when children load
  useEffect(() => {
    const forms = {};
    children.forEach(c => {
      forms[c.id] = { first_name: c.first_name || '', last_name: c.last_name || '', diagnosis: c.diagnosis || '' };
    });
    setChildForms(forms);
  }, [children]);

  const handleSaveChild = async (data) => {
    // Create fake email from pseudonym for Supabase Auth
    const nickname = data.login?.nickname ? sanitizeInput(data.login.nickname, 30) : 'learner';
    const childPassword = data.login?.password ? sanitizeInput(data.login.password, 72) : '123456';
    const childEmail = `${nickname.toLowerCase()}@learner.nestureai.com`;
    
    const [firstName, ...lastNames] = (data.details?.fullName || '').split(' ');
    const cleanFirst = sanitizeInput(firstName, 50);
    const cleanLast = sanitizeInput(lastNames.join(' '), 50);
    const cleanDiag = sanitizeInput(data.details?.diagnosis || '', 100);

    validateName(cleanFirst, 'First name');
    if (cleanLast !== '') {
      validateName(cleanLast, 'Last name');
    }
    if (data.login?.nickname) {
      validateNickname(nickname);
    }

    let finalAge = null;
    if (data.details?.dob) {
      const birthDate = new Date(data.details.dob);
      const today = new Date();
      let age = today.getFullYear() - birthDate.getFullYear();
      const m = today.getMonth() - birthDate.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
      finalAge = age;
    } else if (data.verification?.ageYears !== undefined && data.verification?.ageYears !== null) {
      finalAge = parseInt(data.verification.ageYears, 10);
    } else if (data.verification?.age) {
      finalAge = parseInt(data.verification.age, 10);
    }

    const payload = { 
      parent_id: userId,
      first_name: cleanFirst || nickname,
      last_name: cleanLast,
      age: (finalAge !== null && !isNaN(finalAge)) ? finalAge : null,
      diagnosis: cleanDiag,
      email: childEmail,
      password: childPassword,
      completeness_percentage: 20
    };

    const res = await api.post('/learners', payload);
    const newChild = res.data;

    // Create an initial Atlas Profile with the questionnaire data
    try {
      const { error: atlasErr } = await supabase.from('atlas_profiles').insert([{
        child_id: newChild.id,
        completeness_percentage: 20, // Starting point
        strengths: [{ label: 'Communication method: ' + (data.details?.communication || 'Not selected') }, { label: 'Literacy: ' + (data.verification?.literacy || 'Not evaluated yet') }],
        challenges: [{ label: 'Parent Hope: ' + (data.verification?.hope || 'Not specified') }]
      }]);
      if (atlasErr) console.error("Atlas Insert Error:", atlasErr);

      // Also ensure completeness_percentage is set in children table in Supabase
      await supabase.from('children').update({ completeness_percentage: 20 }).eq('id', newChild.id);
    } catch (err) {
      console.warn('Could not save initial atlas profile questionnaire', err);
    }

    return newChild;
  };



  const handleLinkSpecialist = async (otId) => {
    if (!activeChildId) return;
    try {
      await api.post('/learners/link-ot', { childId: activeChildId, otId });
      toast.success('Specialist linked successfully!');
      // Update local state so it doesn't revert
      setChildren(prev => prev.map(c => c.id === activeChildId ? { ...c, ot_id: otId } : c));
    } catch (e) {
      throw e;
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    setLoading(true);
    if (process.env.NODE_ENV === 'development' || window.location.hostname === 'localhost') {
      console.log(`[ParentDashboard Fetch] Fetching children for parentId: ${userId} | Impersonating: ${!!originalProfile}`);
    }
    try {
      const [learnersRes, profRes, subRes] = await Promise.all([
        api.get(`/learners/by-parent/${userId}`),
        api.get('/users/professionals').catch(() => ({ data: [] })),
        supabase
          .from('subscriptions')
          .select('*')
          .eq('parent_id', userId)
          .in('status', ['active', 'trialing'])
          .order('created_at', { ascending: false })
          .limit(1)
      ]);
      const kids = learnersRes.data;
      setChildren(kids);
      setProfessionalsList(profRes.data || []);

      // Set subscription state
      if (subRes.data && subRes.data.length > 0) {
        setCurrentSubscription(subRes.data[0]);
      } else {
        setCurrentSubscription(null);
      }

      // Fetch in-progress questionnaires for all children
      if (kids.length > 0) {
        const childIds = kids.map(k => k.id);
        const { data: qData } = await supabase
          .from('atlas_questionnaire_responses')
          .select('child_id, status, last_completed_step')
          .in('child_id', childIds)
          .eq('status', 'in_progress');
        const qMap = {};
        (qData || []).forEach(q => { qMap[q.child_id] = q; });
        setInProgressQuestionnaires(qMap);
      }

      if (kids.length === 0) { setLoading(false); return; }
      const childId = kids[0].id;
      setActiveChildId(childId);
      await loadChildData(childId);
    } catch (e) {
      console.error('[PARENT_DASHBOARD_FETCH_ERROR]', e);
      toast.error('Could not load dashboard data');
    } finally {
      setLoading(false);
    }
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
    if (activeChildId && !loading && !childLoading) {
      setHistoryPage(1);
      fetchHistory(activeChildId, 1, false);
    }
  }, [gameFilter, archivedFilter, dateRange, startDate, endDate, diffFilter, accFilter, itemsPerPage, viewMode]);

  const handlePageChange = (newPage) => {
    setHistoryPage(newPage);
    fetchHistory(activeChildId, newPage, false);
  };

  const loadChildData = async (childId) => {
    setChildLoading(true);
    try {
      const [sessRes, reflexRes, exRes, prescRes, connRes, pendingRes] = await Promise.all([
        api.get(`/sessions/learner/${childId}?limit=50`),
        api.get(`/reflexes/learner/${childId}/summary`),
        api.get('/exercises/'),
        api.get(`/exercises/prescriptions/${childId}`),
        api.get(`/connections/active/${childId}`).catch(() => ({ data: [] })),
        api.get(`/connections/pending/${userId}`).catch(() => ({ data: [] })),
      ]);
      setSessions(sessRes.data);
      setReflexes(reflexRes.data);
      setExercises(exRes.data);
      setPrescriptions(prescRes.data);
      setActiveConnections(connRes.data || []);
      setPendingRequests(pendingRes.data || []);
      
      // Load paginated history
      await fetchHistory(childId, 1, false);

      if (sessRes.data.length > 0) {
        const aRes = await api.get(`/sessions/${sessRes.data[0].id}/analysis`);
        setAnalysis(aRes.data);
      } else {
        setAnalysis(null);
      }
    } catch (e) {
      console.error('[PARENT_DASHBOARD_CHILD_ERROR]', e);
      toast.error('Could not load child data');
    } finally {
      setChildLoading(false);
    }
  };

  const selectChild = async (childId) => {
    setActiveChildId(childId);
    await loadChildData(childId);
  };

  const handleEditActiveChild = (childId) => {
    const targetId = childId || activeChildId;
    if (!targetId) return;
    setActiveTab('settings');
    setEditingChildId(targetId);
    setTimeout(() => {
      const el = document.getElementById(`edit-child-${targetId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 150);
  };


  const downloadReport = async () => {
    if (!sessions[0]) return;
    try {
      const res = await api.get(`/reports/${sessions[0].id}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url; a.download = 'NestureAI_Report.pdf'; 
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Report downloaded!');
    } catch { toast.error('Error downloading report'); }
  };

  const emailReport = () => {
    toast.success('Report sent! (Email simulation)', { icon: '📧' });
  };

  const handleUpdatePassword = async () => {
    if (!currentPassword) {
      toast.error('Current password is required.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      toast.error('New passwords do not match.');
      return;
    }
    try {
      validatePassword(newPassword);
    } catch (err) {
      toast.error(err.message);
      return;
    }

    setSecuritySaving(true);
    try {
      // 1. Validate the current session by re-authenticating
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword
      });
      if (signInErr) {
        throw new Error('Current password is incorrect. Session validation failed.');
      }

      // 2. Perform the update
      const { error: updateErr } = await supabase.auth.updateUser({
        password: newPassword
      });
      if (updateErr) throw updateErr;

      toast.success('Password changed successfully!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
    } catch (err) {
      toast.error(err.message || 'Failed to update password.');
    } finally {
      setSecuritySaving(false);
    }
  };

  /* accuracy_score is written by five different games and is NOT stored in one
     unit: some rows hold a 0-1 fraction, others a 0-100 percentage. Blindly
     multiplying by 100 is what produced "6900%" in the history table. Anything
     above 1 is already a percentage; anything at or below 1 is a fraction.
     (A genuine 1 is 100% either way, so the ambiguity is harmless.) */
  const toPercent = (raw) => {
    const v = parseFloat(raw);
    if (!Number.isFinite(v) || v <= 0) return 0;
    return Math.min(100, Math.round(v > 1 ? v : v * 100));
  };

  const chartData = [...sessions].reverse().map((s, i) => ({
    session: `S${i + 1}`,
    accuracy: toPercent(s.accuracy_score),
    responseTime: Math.round(parseFloat(s.avg_response_time_ms || 0) / 100) / 10,
    lpi: parseInt(s.lpi_score || 0),
  }));

  const generateNotifications = () => {
    if (loading || childLoading) return [];
    const notifs = [];
    const child = children.find(c => c.id === activeChildId);
    const childName = child?.name || child?.first_name || 'your child';
    
    // 1. Welcome notification (always present)
    notifs.push({
      id: 'welcome_parent',
      title: 'Welcome to NestureAI',
      message: `Track ${childName}'s progress and manage settings from your dashboard.`,
      time: 'Always',
      icon: 'Star',
      bg: '#EEF6F8'
    });

    // 2. Session count milestone
    if (sessions.length > 0) {
      notifs.push({
        id: `sessions_count_${sessions.length}`,
        title: `${sessions.length} Session${sessions.length > 1 ? 's' : ''} Completed`,
        message: `${childName} has completed ${sessions.length} session${sessions.length > 1 ? 's' : ''} so far. Keep going!`,
        time: sessions[0]?.start_time?.slice(0, 10) || 'Recently',
        icon: 'Activity',
        bg: '#D1FAE5'
      });
    }

    // 3. High accuracy milestone
    const latest = sessions[0];
    if (latest && toPercent(latest.accuracy_score) >= 90) {
      notifs.push({
        id: `acc_${latest.id}`,
        title: 'Milestone Achieved! 🎉',
        message: `${childName} achieved over 90% accuracy in their latest session!`,
        time: latest.start_time?.slice(0, 10) || 'Recently',
        icon: 'Star',
        bg: '#FEF3C7'
      });
    }

    // 4. Latest session info
    if (latest) {
      const acc = toPercent(latest.accuracy_score);
      notifs.push({
        id: `latest_sess_${latest.id}`,
        title: 'Latest Session',
        message: `Last session on ${latest.start_time?.slice(0, 10) || 'N/A'} with ${acc}% accuracy.`,
        time: latest.start_time?.slice(0, 10) || 'Recently',
        icon: 'Activity',
        bg: '#F3F4F6'
      });
    }

    // 5. Progress detected (LPI improvement)
    const prev = sessions[1];
    if (latest && prev && latest.lpi_score > prev.lpi_score) {
      notifs.push({
        id: `lpi_${latest.id}`,
        title: 'Progress Detected',
        message: `LPI score improved from ${prev.lpi_score} to ${latest.lpi_score}. Motor pathways are strengthening.`,
        time: latest.start_time?.slice(0, 10) || 'Recently',
        icon: 'Activity',
        bg: '#D1FAE5'
      });
    }

    // 6. Atlas Insights
    if (analysis && analysis.recommendations?.length > 0) {
      const rec = analysis.recommendations[0];
      const message = typeof rec === 'string' ? rec : (rec.reason || rec.label || 'New profile insight available');
      notifs.push({
        id: `atlas_insight_${latest?.id || 'gen'}`,
        title: 'Atlas AI Insight',
        message: message,
        time: 'New insight',
        icon: 'BrainCircuit',
        bg: '#EEF6F8'
      });
    }

    // 7. Professional connection
    if (activeConnections && activeConnections.length > 0) {
      notifs.push({
        id: `conn_${activeConnections[0].practitioner_id}`,
        title: 'Professional Connected',
        message: `Your data is being shared with ${activeConnections[0].practitioner?.first_name || 'your Specialist'}.`,
        time: 'Active',
        icon: 'Shield',
        bg: '#F3F4F6'
      });
    } else {
      notifs.push({
        id: 'no_ot_tip',
        title: 'Connect a Professional',
        message: 'Link a Specialist or educator to share progress data and get tailored recommendations.',
        time: 'Tip',
        icon: 'Shield',
        bg: '#FEF3C7'
      });
    }

    return notifs.slice(0, 7);
  };

  const realNotifications = generateNotifications();

  const latestSession = sessions[0];
  const latestAcc = latestSession ? toPercent(latestSession.accuracy_score) : 0;
  const prevAcc   = sessions[1]   ? toPercent(sessions[1].accuracy_score) : 0;
  const accChange = latestAcc - prevAcc;

  const renderComingSoon = (title) => (
    <motion.div initial={{ opacity:0,y:10 }} animate={{ opacity:1,y:0 }} style={styles.comingSoon}>
      <div style={styles.csIcon}><Construction size={32} color="#F59E0B" /></div>
      <h2 style={styles.csTitle}>{title}</h2>
      <p style={styles.csText}>We're working hard to bring this feature to you in the next update!</p>
    </motion.div>
  );

  if (loading) {
    return (
      <div className="page-layout">
        <Sidebar navItems={NAV} activeId={activeTab} onNavClick={setActiveTab} />
        <div className="main-content" style={{ display:'flex',alignItems:'center',justifyContent:'center' }}>
          <div className="spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className="page-layout">
      <AddChildModal 
        isOpen={showAddChildModal} 
        onClose={() => setShowAddChildModal(false)} 
        onSaveChild={async (data) => {
          const newChild = await handleSaveChild(data);
          setChildren(prev => [...prev, newChild]);
          selectChild(newChild.id);
          toast.success('Child profile created successfully!');
          // Automatically trigger intake questionnaire
          setActiveQuestionnaireChildId(newChild.id);
          setShowQuestionnaireModal(true);
        }} 
      />
      <Atlas360Questionnaire
        isOpen={showQuestionnaireModal}
        onClose={() => {
          setShowQuestionnaireModal(false);
          // Re-fetch in-progress status after closing (user may have saved progress)
          if (children.length > 0) {
            const childIds = children.map(k => k.id);
            supabase
              .from('atlas_questionnaire_responses')
              .select('child_id, status, last_completed_step')
              .in('child_id', childIds)
              .eq('status', 'in_progress')
              .then(({ data }) => {
                const qMap = {};
                (data || []).forEach(q => { qMap[q.child_id] = q; });
                setInProgressQuestionnaires(qMap);
              });
          }
        }}
        childId={activeQuestionnaireChildId}
        childName={children.find(c => c.id === activeQuestionnaireChildId)?.first_name || "Child"}
        onComplete={() => {
          // Clear in-progress entry for completed child
          setInProgressQuestionnaires(prev => {
            const next = { ...prev };
            delete next[activeQuestionnaireChildId];
            return next;
          });
          setAtlasRefresh(prev => prev + 1);
          fetchAll();
        }}
      />
      <ConsentSettingsModal
        isOpen={showConsentModal}
        onClose={() => setShowConsentModal(false)}
      />
      <ConnectionModal
        isOpen={showLinkSpecialistModal}
        onClose={() => { setShowLinkSpecialistModal(false); fetchAll(); }}
        role="parent"
        childId={activeChildId}
      />
      <Sidebar navItems={children.length > 0 ? NAV : NAV.filter(item => item.id === 'settings' || item.id === 'subscription')} activeId={activeTab} onNavClick={setActiveTab} />
      <main className="main-content">
        {/* Header */}
        <motion.div initial={{ opacity:0,y:-12 }} animate={{ opacity:1,y:0 }} style={styles.pageHeader}>
          <div>
            <h1 style={styles.pageTitle}>Parent Dashboard</h1>
            <p style={styles.pageSubtitle}>Welcome back, {profile?.first_name || 'User'} · {new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})}</p>
          </div>
          {children.length > 0 && (
            <div style={styles.headerActions}>
              <SmartNotifications notifications={realNotifications} />
              <button onClick={() => setShowConsentModal(true)} className="btn btn-secondary btn-sm" style={{ padding: '6px 10px' }} title="Privacy & Consent">
                <Shield size={14} />
              </button>
              <button onClick={() => setShowLinkSpecialistModal(true)} className="btn btn-primary btn-sm">
                <UserCheck size={14} /> Connect
              </button>
            </div>
          )}
        </motion.div>

        {/* Parent Subscription Header with Payment Button */}
        <ParentDashboardHeader parentId={userId} children={children} currentSubscription={currentSubscription} />

        {/* ── Child Selector ── */}
        {children.length > 0 && (
          <motion.div initial={{ opacity:0,y:8 }} animate={{ opacity:1,y:0 }} transition={{ delay:0.1 }}
            style={{ display:'flex', gap:12, marginBottom:24, flexWrap:'wrap' }}>
            {children.map((child) => {
              const isActive = child.id === activeChildId;
              const initials = (child.name || child.first_name || '?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
              const avatarColor = child.avatar_color || '#0D5E6B';
              return (
                <motion.div key={child.id} onClick={() => selectChild(child.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') selectChild(child.id); }}
                  whileHover={{ y:-2 }} whileTap={{ scale:0.97 }}
                  style={{
                    display:'flex', alignItems:'center', gap:12, padding:'12px 16px',
                    background: isActive ? '#EEF6F8' : '#fff',
                    border: isActive ? `2px solid #0D5E6B` : '2px solid #E5E7EB',
                    borderRadius:14, cursor:'pointer', textAlign:'left',
                    boxShadow: isActive ? '0 0 0 3px rgba(13,94,107,0.12)' : '0 1px 4px rgba(0,0,0,0.06)',
                    transition:'all 0.2s',
                    opacity: childLoading && !isActive ? 0.6 : 1,
                  }}>
                  <div style={{
                    width:40, height:40, borderRadius:'50%',
                    background: avatarColor,
                    display:'flex', alignItems:'center', justifyContent:'center',
                    color:'#fff', fontWeight:800, fontSize:'1rem', flexShrink:0,
                    overflow: 'hidden'
                  }}>
                    {child.avatar_url ? (
                      <img src={child.avatar_url} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <User size={20} />
                    )}
                  </div>
                  <div>
                    <div style={{ fontFamily:'Inter,sans-serif', fontWeight:700, fontSize:'0.9rem', color:'#111827' }}>
                      {child.name || child.first_name}
                    </div>
                    <div style={{ fontSize:'0.73rem', color:'#6B7280' }}>
                      {child.age ? `Age ${child.age}` : ''}{child.diagnosis ? ` · ${child.diagnosis.split(',')[0]}` : ''}
                    </div>
                  </div>
                  {isActive && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
                      <div style={{ fontSize:'0.68rem', fontWeight:700, color:'#0D5E6B',
                        background:'#D1FAE5', padding:'2px 8px', borderRadius:20 }}>
                        Selected
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEditActiveChild(child.id);
                        }}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center',
                          color: '#0D5E6B', padding: 4, borderRadius: '50%'
                        }}
                        title="Edit Child Profile"
                      >
                        <Edit3 size={16} />
                      </button>
                    </div>
                  )}
                </motion.div>
              );
            })}
            {activeChildId && (
              <motion.button
                onClick={() => handleEditActiveChild(activeChildId)}
                whileHover={{ y:-2 }} whileTap={{ scale:0.97 }}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  padding: '12px 20px', background: '#EEF6F8', border: '2px solid #C8E8ED',
                  borderRadius: 14, cursor: 'pointer', color: '#0D5E6B', fontWeight: 600,
                  fontSize: '0.9rem', transition: 'all 0.2s'
                }}
              >
                <Edit3 size={15} /> Edit Profile
              </motion.button>
            )}
            <motion.button
              onClick={openAddChildWithCheck}
              whileHover={{ y:-2 }} whileTap={{ scale:0.97 }}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '12px 20px', background: '#F3F4F6', border: '2px dashed #D1D5DB',
                borderRadius: 14, cursor: 'pointer', color: '#6B7280', fontWeight: 600,
                fontSize: '0.9rem', transition: 'all 0.2s'
              }}
            >
              <span style={{ fontSize: '1.2rem' }}>+</span> Add Child
            </motion.button>
          </motion.div>
        )}

        {/* ── Continue Questionnaire Banner ── */}
        {activeChildId && inProgressQuestionnaires[activeChildId] && (
          <motion.div 
            initial={{ opacity: 0, y: 8 }} 
            animate={{ opacity: 1, y: 0 }} 
            transition={{ delay: 0.15 }}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: 16, padding: '16px 24px', marginBottom: 24,
              background: 'linear-gradient(135deg, #FFFBEB, #FEF3C7)',
              border: '1.5px solid #F59E0B',
              borderRadius: 16,
              boxShadow: '0 2px 12px rgba(245, 158, 11, 0.15)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{
                width: 42, height: 42, borderRadius: 12,
                background: 'linear-gradient(135deg, #F59E0B, #D97706)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0
              }}>
                <Brain size={22} color="#fff" />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#92400E', fontFamily: 'Inter, sans-serif' }}>
                  Continue Atlas 360° — Step {(inProgressQuestionnaires[activeChildId].last_completed_step || 0) + 1} of 11
                </div>
                <div style={{ fontSize: '0.82rem', color: '#B45309', marginTop: 2 }}>
                  {children.find(c => c.id === activeChildId)?.first_name || 'Your child'}'s questionnaire is partially completed. Pick up where you left off.
                </div>
              </div>
            </div>
            <button
              onClick={() => {
                setActiveQuestionnaireChildId(activeChildId);
                setShowQuestionnaireModal(true);
              }}
              style={{
                padding: '10px 20px',
                background: 'linear-gradient(135deg, #F59E0B, #D97706)',
                color: '#fff', border: 'none', borderRadius: 12,
                fontWeight: 700, fontSize: '0.88rem', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 8,
                whiteSpace: 'nowrap', flexShrink: 0,
                boxShadow: '0 2px 8px rgba(245, 158, 11, 0.3)',
                transition: 'opacity 0.2s'
              }}
            >
              Continue →
            </button>
          </motion.div>
        )}

        {/* ── Active Connections (Premium UI) ── */}
        {children.length > 0 && activeConnections.length > 0 && (activeTab === 'connect' || activeTab === 'atlas') && (
          <motion.div initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} transition={{ delay:0.2 }}
            style={{ marginBottom: 24 }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
              Connected Specialists
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {activeConnections.map(c => (
                <div key={c.practitioner_id} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
                  background: '#F0FDF4', border: '1.5px solid #86EFAC', borderRadius: 14,
                  boxShadow: '0 2px 8px rgba(16, 185, 129, 0.1)', flex: '1 1 300px', maxWidth: 400
                }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 12, background: c.practitioner?.avatar_url ? 'transparent' : 'linear-gradient(135deg, #0D5E6B, #1A8FA0)',
                    color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 800, fontSize: '1rem', flexShrink: 0, overflow: 'hidden'
                  }}>
                    {c.practitioner?.avatar_url ? (
                      <img src={c.practitioner.avatar_url} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      c.practitioner?.first_name?.[0] || 'P'
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#065F46', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {c.practitioner?.first_name} {c.practitioner?.last_name}
                    </div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#059669', marginTop: 2 }}>
                      {c.practitioner?.practice_name ? `${c.practitioner.practice_name} · ` : ''}Access granted
                    </div>
                  </div>
                  <button
                    onClick={async () => {
                      if (!window.confirm(`Are you sure you want to disconnect ${c.practitioner?.first_name}? They will no longer have access to your child's data.`)) return;
                      try {
                        await api.post('/connections/revoke', { practitionerId: c.practitioner_id, childId: activeChildId });
                        setActiveConnections(prev => prev.filter(conn => conn.practitioner_id !== c.practitioner_id));
                        toast.success('Specialist disconnected successfully.');
                      } catch { toast.error('Error during disconnection'); }
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px',
                      background: '#FEE2E2', color: '#991B1B', border: '1px solid #FECACA',
                      borderRadius: 10, fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer',
                      transition: 'all 0.2s', flexShrink: 0
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#FECACA'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = '#FEE2E2'; }}
                  >
                    Disconnect
                  </button>
                </div>
              ))}
            </div>
          </motion.div>
        )}


        {/* No children state */}
        {!loading && children.length === 0 && activeTab !== 'settings' && activeTab !== 'subscription' && (
          <div style={{ textAlign:'center', padding:'48px 24px', color:'#6B7280' }}>
            <div style={{ fontSize:'3rem', marginBottom:12 }}><Users size={64} color="#0D5E6B" /></div>
            {currentSubscription ? (
              <>
                <h3 style={{ fontFamily:'Inter,sans-serif', color:'#374151', marginBottom: 8 }}>No children added yet</h3>
                <p style={{ fontSize:'0.875rem', marginBottom: 24 }}>Add your child's profile to start tracking their progress.</p>
                <button
                  onClick={openAddChildWithCheck}
                  style={{
                    padding: '12px 24px', background: 'linear-gradient(135deg, #0D5E6B, #1A8FA0)',
                    color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700,
                    fontSize: '0.95rem', cursor: 'pointer', fontFamily: 'Inter, sans-serif'
                  }}
                >
                  Add your first child
                </button>
              </>
            ) : (
              <>
                <h3 style={{ fontFamily:'Inter,sans-serif', color:'#374151', marginBottom: 8 }}>Choisissez un abonnement</h3>
                <p style={{ fontSize:'0.875rem', marginBottom: 24 }}>Vous devez souscrire à un abonnement pour ajouter un enfant et accéder à toutes les fonctionnalités.</p>
                <button
                  onClick={() => navigate('/pricing')}
                  style={{
                    padding: '14px 28px', background: 'linear-gradient(135deg, #F59E0B, #D97706)',
                    color: '#fff', border: 'none', borderRadius: 12, fontWeight: 700,
                    fontSize: '1rem', cursor: 'pointer', fontFamily: 'Inter, sans-serif',
                    boxShadow: '0 4px 14px rgba(245, 158, 11, 0.35)',
                    display: 'inline-flex', alignItems: 'center', gap: 8
                  }}
                >
                  🔒 Voir les abonnements
                </button>
              </>
            )}
          </div>
        )}

        {(children.length > 0 || activeTab === 'settings') && (
          activeTab === 'sessions' ? (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              {/* KPI row */}
              <div style={styles.kpiRow} className="kpi-grid-4">
                {[
                  { label: 'Total Sessions', value: sessions.length, change: 'All time', up: true, color: '#0D5E6B' },
                  { label: 'Latest Accuracy', value: `${latestAcc}%`,
                    change: accChange >= 0 ? `+${accChange}% vs prev` : `${accChange}% vs prev`,
                    up: accChange >= 0, color: '#E8841A' },
                  { label: 'LPI Score', value: latestSession?.lpi_score || '—', change: 'Learner Progress Index', up: true, color: '#8B5CF6' },
                  { label: 'Avg Accuracy', value: sessions.length > 0
                    ? `${Math.round(sessions.reduce((a, s) => a + toPercent(s.accuracy_score), 0) / sessions.length)}%`
                    : '—', change: 'Across all sessions', up: true, color: '#10B981' },
                ].map((k) => (
                  <motion.div key={k.label} className="card" style={styles.kpiCard}
                    whileHover={{ y: -2 }} transition={{ duration: 0.15 }}>
                    <div style={{ ...styles.kpiValue, color: k.color }}>{k.value}</div>
                    <div style={styles.kpiLabel}>{k.label}</div>
                    <div style={{ ...styles.kpiChange, color: k.up ? '#10B981' : '#EF4444' }}>{k.change}</div>
                  </motion.div>
                ))}
              </div>

              {/* Charts row */}
              <div style={styles.twoCol} className="resp-two-col">
                {/* Accuracy + LPI over time */}
                <div className="card" style={styles.chartCard}>
                  <div className="section-header">
                    <span className="section-title">Accuracy & LPI Over Time</span>
                    <span className="badge badge-teal">{sessions.length} sessions</span>
                  </div>
                  <ResponsiveContainer width="100%" height={210}>
                    <LineChart data={chartData} margin={{ top: 5, right: 16, bottom: 5, left: -20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                      <XAxis dataKey="session" tick={{ fontSize: 11, fill: '#9CA3AF' }} />
                      <YAxis tick={{ fontSize: 11, fill: '#9CA3AF' }} domain={[0, 100]} />
                      <Tooltip contentStyle={{ borderRadius: 10, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', fontSize: 12 }} />
                      <Line type="monotone" dataKey="accuracy" stroke="#0D5E6B" strokeWidth={2.5}
                        dot={{ r: 4, fill: '#0D5E6B' }} activeDot={{ r: 6 }} name="Accuracy %" />
                      <Line type="monotone" dataKey="lpi" stroke="#E8841A" strokeWidth={2}
                        dot={{ r: 3, fill: '#E8841A' }} strokeDasharray="4 2" name="LPI" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                {/* Difficulty breakdown */}
                <div className="card" style={styles.chartCard}>
                  <div className="section-header">
                    <span className="section-title">Difficulty Breakdown</span>
                  </div>
                  {(() => {
                    const counts = { easy: 0, medium: 0, hard: 0 };
                    sessions.forEach(s => { if (counts[s.difficulty] !== undefined) counts[s.difficulty]++; });
                    const total = sessions.length || 1;
                    return (
                      <div style={{ paddingTop: 10 }}>
                        {[
                          { key: 'easy',   label: 'Easy',   color: '#10B981', bg: '#D1FAE5' },
                          { key: 'medium', label: 'Medium', color: '#F59E0B', bg: '#FEF9C3' },
                          { key: 'hard',   label: 'Hard',   color: '#EF4444', bg: '#FEE2E2' },
                        ].map(d => (
                          <div key={d.key} style={{ marginBottom: 16 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#374151' }}>{d.label}</span>
                              <span style={{ fontSize: '0.82rem', fontWeight: 700, color: d.color }}>{counts[d.key]} sessions ({Math.round(counts[d.key]/total*100)}%)</span>
                            </div>
                            <div style={{ height: 10, background: '#F3F4F6', borderRadius: 5, overflow: 'hidden' }}>
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${Math.round(counts[d.key]/total*100)}%` }}
                                transition={{ duration: 1, ease: 'easeOut' }}
                                style={{ height: '100%', background: d.color, borderRadius: 5 }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Full session history with Report & Actions */}
              {(() => {
                const totalPages = Math.ceil(totalSessions / itemsPerPage);
                const activePage = Math.min(historyPage, Math.max(1, totalPages));
                return (
              <div className="card" style={{ marginTop: 20 }}>
                {/* Header */}
                <div style={{ padding: '20px 24px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, borderBottom: '1px solid #F3F4F6' }}>
                  <div>
                    <span className="section-title">Full Session History</span>
                    <span style={{ fontSize: '0.78rem', color: '#9CA3AF', marginLeft: 12 }}>
                      Showing {historySessions.length} of {totalSessions} session{totalSessions !== 1 ? 's' : ''}
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
                      <th>Date</th><th>NesturePlay (Games)</th><th>Duration</th>
                      <th title="Composite occupational-therapy score, comparable across every game">OT Score</th>
                      <th title="Average time to respond during the session">Avg Response</th>
                      <th>Difficulty</th><th>LPI</th><th>Report</th><th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historySessions.map((s) => (
                      <tr key={s.id} style={{ opacity: s.is_archived ? 0.65 : 1 }}>
                        <td data-label="Date">{s.start_time?.slice(0, 10)}</td>
                        <td data-label="NesturePlay (Games)">
                          <span style={{ fontWeight: 700, fontSize: '0.75rem', color: s.game_name === 'Path Tracing' ? '#8B5CF6' : (s.game_name?.includes('Finger') || s.game_name?.includes('Match')) ? '#EC4899' : '#0D5E6B' }}>
                            {s.game_name || 'LetterQuest'}
                          </span>
                          {s.is_archived && (
                            <span style={{ marginLeft: 6, fontSize: '0.65rem', background: '#E5E7EB', color: '#4B5563', padding: '1px 4px', borderRadius: 4, fontWeight: 800 }}>ARCHIVED</span>
                          )}
                        </td>
                        <td data-label="Duration">{(() => {
                          /* Sessions under a minute were all rendering as "0 min". */
                          const sec = parseInt(s.duration_seconds || 0, 10);
                          return sec < 60 ? `${sec}s` : `${Math.round(sec / 60)} min`;
                        })()}</td>
                        <td data-label="OT Score">{(() => {
                          const pct = toPercent(s.accuracy_score);
                          const color = pct >= 80 ? '#10B981' : pct >= 60 ? '#F59E0B' : '#EF4444';
                          return <span style={{ fontWeight: 700, color }}>{pct}%</span>;
                        })()}</td>
                        <td data-label="Avg Response">{(() => {
                          const ms = parseFloat(s.avg_response_time_ms || 0);
                          return ms > 0 ? `${(ms / 1000).toFixed(1)}s` : '—';
                        })()}</td>
                        <td data-label="Difficulty"><span className={`badge badge-${s.difficulty==='hard'?'danger':s.difficulty==='medium'?'warning':'success'}`}>{s.difficulty}</span></td>
                        <td data-label="LPI" style={{ fontWeight: 600, color: '#0D5E6B' }}>{(() => {
                          /* Every game computes an LPI now, so there is no
                             per-game exception left. A missing one shows as a
                             dash rather than a zero. */
                          const lpi = parseInt(s.lpi_score || 0, 10);
                          return lpi > 0 ? lpi : '—';
                        })()}</td>
                        <td data-label="Report">
                          {s.game_name === 'Magic Finger Copy' ? '-' : (
                            <button
                              onClick={async () => {
                                try {
                                  const res = await api.get(`/reports/${s.id}/pdf`, { responseType: 'blob' });
                                  const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
                                  const a = document.createElement('a'); a.href = url;
                                  a.download = `NestureAI_Report_${s.start_time?.slice(0,10)}.pdf`;
                                  document.body.appendChild(a); a.click(); document.body.removeChild(a);
                                  URL.revokeObjectURL(url);
                                  toast.success('Report downloaded!');
                                } catch { toast.error('Error generating report'); }
                              }}
                              style={{display:"flex", alignItems:"center", gap:6, background: '#EEF6F8', color: '#0D5E6B', border: '1px solid #B2DFE6', borderRadius: 7, padding: '4px 10px', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer'}}><Download size={14} /> PDF</button>
                          )}
                        </td>
                        <td data-label="Actions">
                          <button
                            onClick={async () => {
                              if (!window.confirm(`Delete session from ${s.start_time?.slice(0,10)}? This cannot be undone.`)) return;
                              try {
                                await api.delete(`/sessions/${s.id}`);
                                toast.success('Session deleted');
                                setHistorySessions(prev => prev.filter(x => x.id !== s.id));
                              } catch { toast.error('Error deleting session'); }
                            }}
                            style={styles.deleteBtn}
                            title="Delete this session"
                          >
                            <Trash2 size={13} />
                          </button>
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
                        fetchHistory(activeChildId, nextPage, true);
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
          ) : activeTab === 'atlas' ? (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <AtlasProfileTab 
                childId={activeChildId} 
                childName={children.find(c => c.id === activeChildId)?.name || children.find(c => c.id === activeChildId)?.first_name || 'your child'} 
                refreshTrigger={atlasRefresh}
                onNavigateTab={setActiveTab}
              />
            </motion.div>
          ) : activeTab === 'connect' ? (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <NestureConnect
                childName={children.find(c => c.id === activeChildId)?.name || children.find(c => c.id === activeChildId)?.first_name || 'your child'}
                childId={activeChildId}
                parentId={userId}
                connectedIds={activeConnections.map(c => c.practitioner_id)}
                pendingIds={pendingRequests.map(r => r.practitioner_id)}
              />
            </motion.div>
          ) : activeTab === 'exercises' ? (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <AssignedExercises childId={activeChildId} />
            </motion.div>
          ) : activeTab === 'learn' ? (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <NestureLearn
                childId={activeChildId}
                childName={children.find(c => c.id === activeChildId)?.name || children.find(c => c.id === activeChildId)?.first_name || 'your child'}
              />
            </motion.div>
          ) : activeTab === 'subscription' ? (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <SubscriptionTab parentId={userId} currentSubscription={currentSubscription} />
            </motion.div>
          ) : activeTab === 'settings' ? (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              {/* ══════ SETTINGS: PARENT PROFILE ══════ */}
              <div className="card" style={{ padding: 28, marginBottom: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
                  <div style={{ position: 'relative', display: 'inline-block' }}>
                    <div style={{ 
                      width: 56, height: 56, borderRadius: 14, background: '#EEF6F8', 
                      display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                      border: '2px solid #C8E8ED'
                    }}>
                      {profile?.avatar_url ? (
                        <img src={profile.avatar_url} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <span style={{ fontWeight: 800, fontSize: '1.4rem', color: '#0D5E6B' }}>
                          {profile?.first_name?.[0]?.toUpperCase() || 'P'}
                        </span>
                      )}
                    </div>
                    <label style={{
                      position: 'absolute', bottom: -6, right: -6,
                      background: '#fff', border: '1.5px solid #E5E7EB',
                      borderRadius: '50%', padding: 4, cursor: 'pointer',
                      boxShadow: '0 2px 6px rgba(0,0,0,0.1)'
                    }}>
                      <span style={{ fontSize: '0.7rem' }}><Camera size={14} /></span>
                      <input type="file" accept="image/*" style={{ display: 'none' }} onChange={async (e) => {
                        const file = e.target.files[0];
                        if (!file) return;
                        const tId = toast.loading('Uploading avatar...');
                        try {
                          const fileExt = file.name.split('.').pop();
                          const filePath = `parent_${userId}_${Date.now()}.${fileExt}`;
                          const { error: upErr } = await supabase.storage.from('avatars').upload(filePath, file, { upsert: true });
                          if (upErr) throw upErr;
                          
                          const { data } = supabase.storage.from('avatars').getPublicUrl(filePath);
                          const { error: updateErr } = await supabase.from('users').update({ avatar_url: data.publicUrl }).eq('id', userId);
                          if (updateErr) throw updateErr;
                          
                          updateProfile({ avatar_url: data.publicUrl });
                          toast.success('Profile photo updated!', { id: tId });
                        } catch (err) {
                          toast.error('Failed to upload photo: ' + err.message, { id: tId });
                        }
                      }} />
                    </label>
                  </div>
                  <div>
                    <div style={{ fontFamily: 'Inter, sans-serif', fontWeight: 700, fontSize: '1.1rem', color: '#0D5E6B' }}>My Profile</div>
                    <div style={{ fontSize: '0.78rem', color: '#9CA3AF' }}>Update your personal information & photo</div>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                  <div>
                    <label style={styles.settingsLabel}>First Name</label>
                    <input value={parentForm.first_name} onChange={e => setParentForm(prev => ({ ...prev, first_name: e.target.value }))}
                       style={styles.settingsInput} placeholder="First name" maxLength={50} />
                  </div>
                  <div>
                    <label style={styles.settingsLabel}>Last Name</label>
                    <input value={parentForm.last_name} onChange={e => setParentForm(prev => ({ ...prev, last_name: e.target.value }))}
                       style={styles.settingsInput} placeholder="Last name" maxLength={50} />
                  </div>
                </div>
                <div style={{ marginBottom: 16 }}>
                  <label style={styles.settingsLabel}>Email</label>
                  <input value={user?.email || ''} disabled style={{ ...styles.settingsInput, background: '#F3F4F6', color: '#9CA3AF', cursor: 'not-allowed' }} />
                  <p style={{ fontSize: '0.72rem', color: '#9CA3AF', marginTop: 4 }}>Email cannot be changed from here.</p>
                </div>
                <button
                  disabled={parentSaving}
                  onClick={async () => {
                    try {
                      const cleanFirst = sanitizeInput(parentForm.first_name, 50);
                      const cleanLast = sanitizeInput(parentForm.last_name, 50);
                      validateName(cleanFirst, 'First name');
                      if (cleanLast !== '') {
                        validateName(cleanLast, 'Last name');
                      }

                      setParentSaving(true);
                      await api.put(`/users/${userId}`, { first_name: cleanFirst, last_name: cleanLast });
                      updateProfile({ first_name: cleanFirst, last_name: cleanLast });
                      toast.success('Profile updated!');
                    } catch (e) {
                      toast.error(e.message || 'Failed to update profile');
                    } finally {
                      setParentSaving(false);
                    }
                  }}
                  style={styles.settingsSaveBtn}
                >
                  <Save size={14} /> {parentSaving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>

              {/* ══════ SETTINGS: SECURITY & PASSWORD ══════ */}
              <div className="card" style={{ padding: 28, marginBottom: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 10, background: '#EFF6FF', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Lock size={20} color="#1D4ED8" />
                  </div>
                  <div>
                    <div style={{ fontFamily: 'Inter, sans-serif', fontWeight: 700, fontSize: '1.1rem', color: '#0D5E6B' }}>Security & Password</div>
                    <div style={{ fontSize: '0.78rem', color: '#9CA3AF' }}>Verify your identity and update your password</div>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 24 }}>
                  <div>
                    <label style={styles.settingsLabel}>Current Password</label>
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                      <input 
                        type={showCurrentPwd ? 'text' : 'password'}
                        value={currentPassword} 
                        onChange={e => setCurrentPassword(e.target.value)}
                        style={{ ...styles.settingsInput, width: '100%', paddingRight: 40 }} 
                        placeholder="Enter current password" 
                      />
                      <button 
                        type="button" 
                        onClick={() => setShowCurrentPwd(!showCurrentPwd)} 
                        style={{ position: 'absolute', right: 12, background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', display: 'flex', alignItems: 'center' }}
                      >
                        {showCurrentPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    <div>
                      <label style={styles.settingsLabel}>New Password</label>
                      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                        <input 
                          type={showNewPwd ? 'text' : 'password'}
                          value={newPassword} 
                          onChange={e => setNewPassword(e.target.value)}
                          style={{ ...styles.settingsInput, width: '100%', paddingRight: 40 }} 
                          placeholder="Min. 8 characters" 
                        />
                        <button 
                          type="button" 
                          onClick={() => setShowNewPwd(!showNewPwd)} 
                          style={{ position: 'absolute', right: 12, background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', display: 'flex', alignItems: 'center' }}
                        >
                          {showNewPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label style={styles.settingsLabel}>Confirm New Password</label>
                      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                        <input 
                          type={showConfirmPwd ? 'text' : 'password'}
                          value={confirmNewPassword} 
                          onChange={e => setConfirmNewPassword(e.target.value)}
                          style={{ ...styles.settingsInput, width: '100%', paddingRight: 40 }} 
                          placeholder="Confirm new password" 
                        />
                        <button 
                          type="button" 
                          onClick={() => setShowConfirmPwd(!showConfirmPwd)} 
                          style={{ position: 'absolute', right: 12, background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', display: 'flex', alignItems: 'center' }}
                        >
                          {showConfirmPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <button
                  disabled={securitySaving}
                  onClick={handleUpdatePassword}
                  style={styles.settingsSaveBtn}
                >
                  <Lock size={14} /> {securitySaving ? 'Updating...' : 'Update Password'}
                </button>
              </div>

              {/* ══════ SETTINGS: CHILDREN MANAGEMENT ══════ */}
              <div className="card" style={{ padding: 28 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: '#FEF3C7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Settings size={18} color="#B45309" />
                  </div>
                  <div>
                    <div style={{ fontFamily: 'Inter, sans-serif', fontWeight: 700, fontSize: '1.1rem', color: '#0D5E6B' }}>Children Management</div>
                    <div style={{ fontSize: '0.78rem', color: '#9CA3AF' }}>Edit or remove your children's profiles</div>
                  </div>
                </div>

                {children.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 32, color: '#9CA3AF' }}>No children added yet.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {children.map(child => {
                      const isEditing = editingChildId === child.id;
                      const form = childForms[child.id] || { first_name: '', last_name: '', diagnosis: '' };
                      const isSaving = childSaving[child.id];
                      return (
                        <motion.div key={child.id} id={`edit-child-${child.id}`} layout style={{
                          border: isEditing ? '2px solid #0D5E6B' : '1.5px solid #E5E7EB',
                          borderRadius: 16, padding: '18px 20px', background: isEditing ? '#FAFEFE' : '#fff',
                          transition: 'all 0.2s',
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isEditing ? 16 : 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                              <div style={{
                                width: 38, height: 38, borderRadius: '50%',
                                background: child.avatar_color || '#0D5E6B',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                color: '#fff', fontWeight: 800, fontSize: '0.9rem',
                                overflow: 'hidden'
                              }}>
                                {child.avatar_url ? (
                                  <img src={child.avatar_url} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                ) : (
                                  <User size={20} />
                                )}
                              </div>
                              <div>
                                <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#111827' }}>
                                  {child.name || child.first_name}
                                </div>
                                <div style={{ fontSize: '0.73rem', color: '#6B7280' }}>
                                  {child.age ? `Age ${child.age}` : ''}{child.diagnosis ? ` · ${child.diagnosis}` : ''}
                                </div>
                                {child.email && (
                                  <div style={{ fontSize: '0.73rem', color: '#6B7280', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <Mail size={12} /> {child.email.split('@')[0]}
                                  </div>
                                )}
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: 8 }}>
                              <button
                                onClick={() => setEditingChildId(isEditing ? null : child.id)}
                                style={{
                                  padding: '6px 14px', borderRadius: 8, border: '1px solid #D1D5DB',
                                  background: isEditing ? '#0D5E6B' : '#F9FAFB', color: isEditing ? '#fff' : '#374151',
                                  fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
                                  display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.2s',
                                }}
                              >
                                <Edit3 size={13} /> {isEditing ? 'Close' : 'Edit'}
                              </button>
                              <button
                                onClick={async () => {
                                  if (!window.confirm(`Are you sure you want to delete ${child.name || child.first_name}'s profile? This will permanently remove all sessions, progress data, and Atlas profile. This action cannot be undone.`)) return;
                                  try {
                                    // Make sure we use the API to trigger backend deletes, but API handles it via supabaseDB
                                    await api.delete(`/learners/${child.id}`);
                                    setChildren(prev => prev.filter(c => c.id !== child.id));
                                    if (activeChildId === child.id) {
                                      const remaining = children.filter(c => c.id !== child.id);
                                      setActiveChildId(remaining.length > 0 ? remaining[0].id : null);
                                    }
                                    toast.success(`${child.name || child.first_name}'s profile deleted.`);
                                  } catch (e) { toast.error('Failed to delete child profile'); }
                                }}
                                style={{
                                  padding: '6px 10px', borderRadius: 8, border: '1px solid #FECACA',
                                  background: '#FEE2E2', color: '#991B1B', cursor: 'pointer',
                                  display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8rem', fontWeight: 600,
                                  transition: 'all 0.2s',
                                }}
                                title="Delete this child's profile"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </div>

                          {/* Expanded edit form */}
                          <AnimatePresence>
                            {isEditing && (
                              <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                style={{ overflow: 'hidden' }}
                              >
                                <div style={{ marginBottom: 14 }}>
                                  <label style={styles.settingsLabel}>Profile Image (Avatar)</label>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <div style={{
                                      width: 48, height: 48, borderRadius: '50%', background: child.avatar_color || '#0D5E6B',
                                      display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', color: '#fff', fontWeight: 'bold'
                                    }}>
                                      {child.avatar_url ? <img src={child.avatar_url} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <User size={24} />}
                                    </div>
                                    <label style={{ cursor: 'pointer', background: '#F3F4F6', padding: '6px 12px', borderRadius: 8, fontSize: '0.8rem', fontWeight: 600, color: '#374151', border: '1px solid #D1D5DB' }}>
                                      Upload Image
                                      <input type="file" accept="image/*" style={{ display: 'none' }} onChange={async (e) => {
                                        const file = e.target.files[0];
                                        if (!file) return;
                                        const tId = toast.loading('Uploading avatar...');
                                        try {
                                          const fileExt = file.name.split('.').pop();
                                          const filePath = `${child.id}_${Date.now()}.${fileExt}`;
                                          const { error: upErr } = await supabase.storage.from('avatars').upload(filePath, file, { upsert: true });
                                          if (upErr) throw upErr;
                                          const { data } = supabase.storage.from('avatars').getPublicUrl(filePath);
                                          const updated = await api.put(`/learners/${child.id}`, { avatar_url: data.publicUrl });
                                          setChildren(prev => prev.map(c => c.id === child.id ? { ...c, ...updated.data } : c));
                                          toast.success('Avatar updated!', { id: tId });
                                        } catch (err) {
                                          toast.error('Failed to upload avatar', { id: tId });
                                          console.error(err);
                                        }
                                      }} />
                                    </label>
                                  </div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
                                  <div>
                                    <label style={styles.settingsLabel}>First Name</label>
                                    <input value={form.first_name}
                                      onChange={e => setChildForms(prev => ({ ...prev, [child.id]: { ...prev[child.id], first_name: e.target.value } }))}
                                      style={styles.settingsInput} maxLength={50} />
                                  </div>
                                  <div>
                                    <label style={styles.settingsLabel}>Last Name</label>
                                    <input value={form.last_name}
                                      onChange={e => setChildForms(prev => ({ ...prev, [child.id]: { ...prev[child.id], last_name: e.target.value } }))}
                                      style={styles.settingsInput} maxLength={50} />
                                  </div>
                                </div>
                                <div style={{ marginBottom: 14 }}>
                                  <label style={styles.settingsLabel}>Diagnosis</label>
                                  <input value={form.diagnosis}
                                    onChange={e => setChildForms(prev => ({ ...prev, [child.id]: { ...prev[child.id], diagnosis: e.target.value } }))}
                                    style={styles.settingsInput} placeholder="e.g. ASD Level 2" maxLength={100} />
                                </div>
                                <div style={{ marginBottom: 14 }}>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (resetPwdChildId === child.id) {
                                        setResetPwdChildId(null);
                                      } else {
                                        setResetPwdChildId(child.id);
                                        setResetPwdNewPwd('');
                                        setResetPwdConfirmPwd('');
                                        setResetPwdError('');
                                        setResetPwdShowNew(false);
                                        setResetPwdShowConfirm(false);
                                      }
                                    }}
                                    style={{
                                      display: 'flex', alignItems: 'center', gap: 8,
                                      padding: '10px 16px', borderRadius: 10,
                                      background: resetPwdChildId === child.id ? '#FEF3C7' : '#F9FAFB',
                                      border: `1.5px solid ${resetPwdChildId === child.id ? '#F59E0B' : '#E5E7EB'}`,
                                      color: '#92400E', fontSize: '0.82rem', fontWeight: 700,
                                      cursor: 'pointer', transition: 'all 0.2s', width: '100%'
                                    }}
                                  >
                                    <Lock size={14} />
                                    {resetPwdChildId === child.id ? 'Cancel Password Reset' : 'Reset Login Password'}
                                  </button>

                                  <AnimatePresence>
                                    {resetPwdChildId === child.id && (
                                      <motion.div
                                        initial={{ opacity: 0, height: 0 }}
                                        animate={{ opacity: 1, height: 'auto' }}
                                        exit={{ opacity: 0, height: 0 }}
                                        style={{ overflow: 'hidden' }}
                                      >
                                        <div style={{
                                          marginTop: 12, padding: '16px 18px',
                                          background: '#FFFBEB', borderRadius: 12,
                                          border: '1.5px solid #FDE68A'
                                        }}>
                                          <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#92400E', marginBottom: 14 }}>
                                            Reset password for {child.name || child.first_name}
                                          </div>

                                          <div style={{ marginBottom: 12 }}>
                                            <label style={styles.settingsLabel}>New Password</label>
                                            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                              <input
                                                type={resetPwdShowNew ? 'text' : 'password'}
                                                value={resetPwdNewPwd}
                                                onChange={e => { setResetPwdNewPwd(e.target.value); setResetPwdError(''); }}
                                                style={{ ...styles.settingsInput, width: '100%', paddingRight: 40 }}
                                                placeholder="Minimum 6 characters"
                                              />
                                              <button type="button" onClick={() => setResetPwdShowNew(!resetPwdShowNew)}
                                                style={{ position: 'absolute', right: 12, background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', display: 'flex', alignItems: 'center' }}>
                                                {resetPwdShowNew ? <EyeOff size={16} /> : <Eye size={16} />}
                                              </button>
                                            </div>
                                          </div>

                                          <div style={{ marginBottom: 12 }}>
                                            <label style={styles.settingsLabel}>Confirm Password</label>
                                            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                              <input
                                                type={resetPwdShowConfirm ? 'text' : 'password'}
                                                value={resetPwdConfirmPwd}
                                                onChange={e => { setResetPwdConfirmPwd(e.target.value); setResetPwdError(''); }}
                                                style={{ ...styles.settingsInput, width: '100%', paddingRight: 40 }}
                                                placeholder="Re-enter new password"
                                              />
                                              <button type="button" onClick={() => setResetPwdShowConfirm(!resetPwdShowConfirm)}
                                                style={{ position: 'absolute', right: 12, background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', display: 'flex', alignItems: 'center' }}>
                                                {resetPwdShowConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                                              </button>
                                            </div>
                                          </div>

                                          {resetPwdError && (
                                            <div style={{ fontSize: '0.78rem', color: '#DC2626', marginBottom: 12, fontWeight: 600 }}>
                                              {resetPwdError}
                                            </div>
                                          )}

                                          <div style={{ display: 'flex', gap: 10 }}>
                                            <button
                                              type="button"
                                              disabled={resetPwdSaving}
                                              onClick={async () => {
                                                // Validate
                                                if (resetPwdNewPwd.length < 6) {
                                                  setResetPwdError('Password must be at least 6 characters.');
                                                  return;
                                                }
                                                if (resetPwdNewPwd !== resetPwdConfirmPwd) {
                                                  setResetPwdError('Passwords do not match.');
                                                  return;
                                                }

                                                setResetPwdSaving(true);
                                                setResetPwdError('');
                                                try {
                                                  const session = await supabase.auth.getSession();
                                                  const token = session.data.session?.access_token;
                                                  const rawRes = await fetch(`${supabaseUrl}/functions/v1/reset-learner-password`, {
                                                    method: 'POST',
                                                    headers: {
                                                      'Content-Type': 'application/json',
                                                      'Authorization': `Bearer ${token}`
                                                    },
                                                    body: JSON.stringify({
                                                      child_id: child.id,
                                                      new_password: resetPwdNewPwd,
                                                      parent_id: userId
                                                    })
                                                  });
                                                  const resData = await rawRes.json();
                                                  if (!rawRes.ok) {
                                                    throw new Error(resData?.message || 'Failed to reset password');
                                                  }
                                                  toast.success(`Password updated for ${child.name || child.first_name}`);
                                                  setResetPwdChildId(null);
                                                  setResetPwdNewPwd('');
                                                  setResetPwdConfirmPwd('');
                                                } catch (err) {
                                                  setResetPwdError(err.message || 'Failed to reset password');
                                                } finally {
                                                  setResetPwdSaving(false);
                                                }
                                              }}
                                              style={{
                                                flex: 1, padding: '10px 16px', borderRadius: 10,
                                                background: '#F59E0B', color: '#fff', border: 'none',
                                                fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer',
                                                opacity: resetPwdSaving ? 0.7 : 1,
                                                transition: 'opacity 0.2s'
                                              }}
                                            >
                                              {resetPwdSaving ? 'Updating...' : 'Update Password'}
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => setResetPwdChildId(null)}
                                              style={{
                                                padding: '10px 16px', borderRadius: 10,
                                                background: '#F3F4F6', color: '#374151', border: '1px solid #D1D5DB',
                                                fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer'
                                              }}
                                            >
                                              Cancel
                                            </button>
                                          </div>
                                        </div>
                                      </motion.div>
                                    )}
                                  </AnimatePresence>
                                </div>
                                <button
                                  disabled={isSaving}
                                  onClick={async () => {
                                    try {
                                      const cleanFirst = sanitizeInput(form.first_name, 50);
                                      const cleanLast = sanitizeInput(form.last_name, 50);
                                      const cleanDiag = sanitizeInput(form.diagnosis, 100);
                                      validateName(cleanFirst, 'First name');
                                      if (cleanLast !== '') {
                                        validateName(cleanLast, 'Last name');
                                      }

                                      setChildSaving(prev => ({ ...prev, [child.id]: true }));
                                      const updated = await api.put(`/learners/${child.id}`, {
                                        first_name: cleanFirst,
                                        last_name: cleanLast,
                                        diagnosis: cleanDiag
                                      });
                                      setChildren(prev => prev.map(c => c.id === child.id ? { ...c, ...updated.data } : c));
                                      toast.success('Child profile updated!');
                                      setEditingChildId(null);
                                    } catch (e) {
                                      toast.error(e.message || 'Failed to update child profile');
                                    } finally {
                                      setChildSaving(prev => ({ ...prev, [child.id]: false }));
                                    }
                                  }}
                                  style={styles.settingsSaveBtn}
                                >
                                  <Save size={14} /> {isSaving ? 'Saving...' : 'Save Changes'}
                                </button>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </motion.div>
                      );
                    })}
                  </div>
                )}
              </div>
            </motion.div>
          ) : null
        )}

        <BetaFooter variant="light" />
      </main>
      {children.length > 0 && (
        <FloatingAskButton 
          childName={children.find(c => c.id === activeChildId)?.name || children.find(c => c.id === activeChildId)?.first_name || 'your child'} 
          childId={activeChildId}
        />
      )}
    </div>
  );
}

const styles = {
  pageHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    marginBottom: 28,
  },
  pageTitle: { fontFamily: 'Inter, sans-serif', fontSize: '1.8rem', fontWeight: 800, color: '#0D5E6B' },
  pageSubtitle: { fontSize: '0.875rem', color: '#9CA3AF', marginTop: 4 },
  headerActions: { display: 'flex', gap: 10 },
  comingSoon: {
    background: '#fff', borderRadius: 24, padding: 60,
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    textAlign: 'center', marginTop: 20, border: '1px solid #F3F4F6'
  },
  csIcon: { fontSize: '4rem', marginBottom: 16 },
  csTitle: { fontFamily: 'Inter, sans-serif', fontSize: '1.8rem', fontWeight: 800, color: '#0D5E6B', marginBottom: 8 },
  csText: { color: '#6B7280', fontSize: '1rem', maxWidth: 400 },
  kpiRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16, marginBottom: 20 },
  kpiCard: { padding: '20px 18px' },
  kpiValue: { fontFamily: 'Inter, sans-serif', fontWeight: 800, fontSize: '1.8rem' },
  kpiLabel: { fontSize: '0.78rem', color: '#6B7280', marginTop: 2, fontWeight: 500 },
  kpiChange: { fontSize: '0.72rem', fontWeight: 600, marginTop: 4 },
  twoCol: { display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16 },
  chartCard: { padding: 24 },
  narrativeCard: { padding: 24, display: 'flex', flexDirection: 'column' },
  narrativeText: { fontSize: '0.9rem', color: '#374151', lineHeight: 1.7, flex: 1 },
  lpiDisplay: { textAlign: 'center', marginTop: 16 },
  lpiNum: { fontFamily: 'Inter, sans-serif', fontWeight: 800, fontSize: '2.5rem', color: '#E8841A' },
  lpiLbl: { fontSize: '0.72rem', color: '#9CA3AF', fontWeight: 600, letterSpacing: '0.06em' },
  reflexGrid: { display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 },
  exerciseRow: {
    display: 'flex', alignItems: 'center', gap: 14,
    padding: '14px 0', borderBottom: '1px solid #F3F4F6',
  },
  exNum: {
    width: 28, height: 28, borderRadius: '50%',
    background: '#EEF6F8', color: '#0D5E6B',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontWeight: 700, fontSize: '0.82rem', flexShrink: 0,
  },
  exName: { fontWeight: 600, fontSize: '0.9rem', color: '#1F2937', marginBottom: 2 },
  exDesc: { fontSize: '0.78rem', color: '#6B7280' },
  exMeta: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 },
  watchBtn: {
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '6px 14px',
    background: '#0D5E6B', color: '#fff',
    border: 'none', borderRadius: 8,
    fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
    whiteSpace: 'nowrap', marginLeft: 'auto',
  },
  exCard: {
    background: '#fff', border: '1.5px solid #DDE8EB', borderRadius: 16,
    padding: '18px 16px', display: 'flex', flexDirection: 'column',
    boxShadow: '0 4px 12px rgba(13,94,107,0.05)', minHeight: 180,
  },
  exCardTop: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10,
  },
  exLibCard: {
    background: '#F8FAFB', border: '1px solid #E5E7EB', borderRadius: 12,
    padding: '14px 16px',
  },
  downloadBtn: {
    padding: '5px 12px', background: '#EEF6F8', color: '#0D5E6B',
    border: '1px solid #B2DFE6', borderRadius: 8,
    fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  deleteBtn: {
    padding: '5px 8px', background: '#FEE2E2', color: '#991B1B',
    border: '1px solid #FECACA', borderRadius: 8,
    cursor: 'pointer', display: 'inline-flex', alignItems: 'center',
    justifyContent: 'center', transition: 'all 0.15s',
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
    transition: 'all 0.15s',
  },
  pageIndicator: {
    display: 'flex', gap: 4,
  },
  pageDot: {
    width: 32, height: 32, borderRadius: 8,
    background: '#F3F4F6', color: '#6B7280',
    border: '1px solid #E5E7EB',
    fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    transition: 'all 0.15s',
  },
  pageDotActive: {
    background: '#0D5E6B', color: '#fff',
    border: '1px solid #0D5E6B',
  },
  flagBar: { height: 8, background: '#F3F4F6', borderRadius: 4, overflow: 'hidden' },
  flagBarFill: { height: '100%', borderRadius: 4 },
  settingsLabel: {
    display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#374151',
    marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em',
  },
  settingsInput: {
    width: '100%', padding: '10px 14px', borderRadius: 10, border: '1.5px solid #E5E7EB',
    fontSize: '0.9rem', outline: 'none', transition: 'border 0.2s', boxSizing: 'border-box',
    fontFamily: 'Inter, sans-serif',
  },
  settingsSaveBtn: {
    display: 'inline-flex', alignItems: 'center', gap: 8,
    padding: '10px 20px', background: 'linear-gradient(135deg, #0D5E6B, #1A8FA0)',
    color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700,
    fontSize: '0.88rem', cursor: 'pointer', transition: 'opacity 0.2s',
  },
};

