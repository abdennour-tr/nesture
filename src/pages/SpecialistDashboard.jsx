import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle, ChevronRight, Download, Play, UserCheck, Trash2, ChevronLeft, X, Save, UserPlus, User, Users, BarChart2, FileText, Construction, Check, Camera, Link as LinkIcon, Clock, Info, Lock, Eye, EyeOff, Activity, Video, Plus, Edit3 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import Sidebar from '../components/shared/Sidebar';
import api from '../services/api';
import toast from 'react-hot-toast';
import { useAuthStore } from '../store';
import { sanitizeInput, validatePassword } from '../utils/security';
import BetaFooter from '../components/shared/BetaFooter';
import ConnectionModal from '../components/shared/ConnectionModal';
import VideoModal from '../components/shared/VideoModal';
import { supabase } from '../services/supabaseClient';

/* accuracy_score is written by five different games and is NOT stored in one
   unit: some rows hold a 0-1 fraction, others a 0-100 percentage. Multiplying
   blindly by 100 is what produced values like "6900%" in the tables. Anything
   above 1 is already a percentage; anything at or below 1 is a fraction (a
   genuine 1 means 100% either way, so the ambiguity is harmless). */
function toPercent(raw) {
  const v = parseFloat(raw);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.min(100, Math.round(v > 1 ? v : v * 100));
}

const NAV = [
  { id: 'overview',  label: 'Learner Overview', icon: <Users size={18} />, end: true },
  { id: 'exercises', label: 'Exercises',        icon: <Activity size={18} /> },
  { id: 'analytics', label: 'Analytics',        icon: <BarChart2 size={18} /> },
  { id: 'reports',   label: 'Reports',          icon: <FileText size={18} /> },
  { id: 'profile',   label: 'My Profile',       icon: <User size={18} /> },
];

export default function SpecialistDashboard() {
  const navigate = useNavigate();
  const { user, profile, updateProfile, originalProfile } = useAuthStore();
  const userId = profile?.id || user?.id;
  const [activeTab, setActiveTab] = useState('overview');
  const [learners, setLearners] = useState([]);
  const [learnerStats, setLearnerStats] = useState({});
  const [exercises, setExercises] = useState([]);
  const [allPrescriptions, setAllPrescriptions] = useState([]);

  // Video player state
  const [activeVideo, setActiveVideo] = useState(null);

  const [loading, setLoading] = useState(true);
  const [reportPage, setReportPage] = useState({});
  const [showConnectionModal, setShowConnectionModal] = useState(false);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [learnerPage, setLearnerPage] = useState(1);
  const learnersPerPage = 10;
  const REPORTS_PER_PAGE = 5;

  const [atlasProfiles, setAtlasProfiles] = useState({});

  // PRD v5: Specialist profile state
  const [specialistProfile, setSpecialistProfile] = useState({
    practiceName: profile?.practice_name || '',
    specialty: profile?.specialty || 'Occupational Therapist',
    location: profile?.location || '',
    registrationNumber: profile?.registration_number || '',
    bio: profile?.bio || '',
  });
  const [profileSaving, setProfileSaving] = useState(false);

  // Security state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showCurrentPwd, setShowCurrentPwd] = useState(false);
  const [showNewPwd, setShowNewPwd] = useState(false);
  const [showConfirmPwd, setShowConfirmPwd] = useState(false);
  const [securitySaving, setSecuritySaving] = useState(false);

  // Exercise Upload & Assign state
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [editingExerciseId, setEditingExerciseId] = useState(null);
  const [uploadForm, setUploadForm] = useState({ name: '', description: '', target_reflex: '', duration_minutes: '', difficulty_level: 'medium', video_url: '' });
  const [uploadFile, setUploadFile] = useState(null);
  const [uploading, setUploading] = useState(false);

  const [assignExerciseId, setAssignExerciseId] = useState(null);
  const [assignLearnerId, setAssignLearnerId] = useState('');
  const [assigning, setAssigning] = useState(false);

  const handleSaveProfile = async () => {
    try {
      const cleanPractice = sanitizeInput(specialistProfile.practiceName, 100);
      const cleanSpecialty = sanitizeInput(specialistProfile.specialty, 100);
      const cleanLocation = sanitizeInput(specialistProfile.location, 100);
      const cleanRegNum = sanitizeInput(specialistProfile.registrationNumber, 30);
      const cleanBio = sanitizeInput(specialistProfile.bio, 500);

      if (cleanRegNum !== '' && !/^[a-zA-Z0-9_-]+$/.test(cleanRegNum)) {
        throw new Error('Registration number can only contain letters, numbers, underscores, and hyphens.');
      }

      setProfileSaving(true);
      const { error } = await supabase
        .from('users')
        .update({
          practice_name: cleanPractice,
          specialty: cleanSpecialty,
          location: cleanLocation,
          registration_number: cleanRegNum,
          bio: cleanBio
        })
        .eq('id', userId);
      
      if (error) throw error;
      
      updateProfile({
        practice_name: cleanPractice,
        specialty: cleanSpecialty,
        location: cleanLocation,
        registration_number: cleanRegNum,
        bio: cleanBio
      });

      setSpecialistProfile({
        practiceName: cleanPractice,
        specialty: cleanSpecialty,
        location: cleanLocation,
        registrationNumber: cleanRegNum,
        bio: cleanBio
      });
      
      toast.success('Profile updated successfully!');
    } catch (err) {
      toast.error('Failed to update profile: ' + err.message);
    } finally {
      setProfileSaving(false);
    }
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

  const handleUploadExercise = async (e) => {
    e.preventDefault();
    if (uploading) return;
    setUploading(true);
    try {
      let finalUrl = uploadForm.video_url;
      // If a new file is selected, upload it
      if (uploadFile) {
        const formData = new FormData();
        formData.append('file', uploadFile);
        const res = await api.post('/exercises/upload-video', formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
        finalUrl = res.data;
      }
      
      if (editingExerciseId) {
        await api.put(`/exercises/${editingExerciseId}`, { ...uploadForm, video_url: finalUrl });
        toast.success('Exercise updated successfully!');
      } else {
        await api.post('/exercises', { 
          ...uploadForm, 
          video_url: finalUrl,
          specialist_id: user.id 
        });
        toast.success('Exercise uploaded successfully!');
      }
      setShowUploadModal(false);
      setEditingExerciseId(null);
      setUploadForm({ name: '', target_reflex: '', description: '', duration_minutes: '', difficulty_level: 'medium', video_url: '' });
      setUploadFile(null);
      fetchLearners();
    } catch (err) {
      console.error(err);
      toast.error(editingExerciseId ? 'Failed to update exercise' : 'Failed to upload exercise');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteExercise = async (id) => {
    if (!window.confirm("Are you sure you want to delete this exercise? This will also remove it from any learners it is assigned to.")) return;
    try {
      await api.delete(`/exercises/${id}`);
      toast.success('Exercise deleted successfully!');
      fetchLearners();
    } catch (err) {
      console.error(err);
      toast.error('Failed to delete exercise');
    }
  };

  const handleAssignExercise = async () => {
    if (!assignLearnerId || !assignExerciseId) return;
    setAssigning(true);
    try {
      await api.post('/exercises/prescribe', {
        learner_id: assignLearnerId,
        exercise_id: assignExerciseId,
        specialist_id: userId,
      });
      toast.success('Exercise assigned successfully!');
      setAssignExerciseId(null);
      setAssignLearnerId('');
      // Refresh prescriptions
      const presRes = await api.get('/prescriptions/all');
      setAllPrescriptions(presRes.data);
    } catch (err) {
      toast.error('Failed to assign exercise.');
    } finally {
      setAssigning(false);
    }
  };

  useEffect(() => { 
    if (userId) fetchLearners(); 
  }, [userId]);

  const fetchLearners = async () => {
    if (!userId) return;
    setLoading(true);
    if (process.env.NODE_ENV === 'development' || window.location.hostname === 'localhost') {
      console.log(`[SpecialistDashboard Fetch] Fetching learners for specialistId: ${userId} | Impersonating: ${!!originalProfile}`);
    }
    const startTime = performance.now();
    try {
      const [learnersRes, exRes, presRes, pendingRes] = await Promise.all([
        api.get(`/learners/by-ot/${userId}`),
        api.get(`/exercises?specialist_id=${userId}`),
        api.get('/prescriptions/all'),
        api.get(`/connections/pending/${userId}`).catch(() => ({ data: [] }))
      ]);
      const learnersList = learnersRes.data;
      setLearners(learnersList);
      setExercises(exRes.data);
      setAllPrescriptions(presRes.data);
      setPendingRequests(pendingRes.data || []);

      if (learnersList.length === 0) {
        setLearnerStats({});
        setAtlasProfiles({});
        setLoading(false);
        return;
      }

      const childIds = learnersList.map(l => l.id);

      // Fetch all sessions in ONE query (aggregation)
      const { data: allSessions, error: sError } = await supabase
        .from('sessions')
        .select('*')
        .in('learner_id', childIds)
        .not('end_time', 'is', null)
        .order('start_time', { ascending: false });
      if (sError) throw sError;

      // Fetch all reflex scores in ONE query (aggregation)
      const { data: allReflexes, error: rError } = await supabase
        .from('reflex_scores')
        .select('*')
        .in('learner_id', childIds)
        .order('created_at', { ascending: true });
      if (rError) throw rError;

      // Fetch all atlas profiles in ONE query (aggregation)
      const { data: allAtlasProfiles, error: apError } = await supabase
        .from('atlas_profiles')
        .select('*')
        .in('child_id', childIds);
      if (apError) throw apError;

      // Group sessions by child_id
      const sessionsByChild = {};
      (allSessions || []).forEach(s => {
        if (!sessionsByChild[s.learner_id]) {
          sessionsByChild[s.learner_id] = [];
        }
        sessionsByChild[s.learner_id].push(s);
      });

      // Group atlas profiles by child_id
      const atlasProfilesByChild = {};
      (allAtlasProfiles || []).forEach(ap => {
        atlasProfilesByChild[ap.child_id] = ap;
      });
      setAtlasProfiles(atlasProfilesByChild);

      // Group reflex scores by child_id, and compute summaries
      const reflexesByChild = {};
      const REFLEX_NAMES_LIST = [
        'Moro', 'ATNR', 'STNR', 'TLR', 'Palmar Grasp',
        'VOR', 'Babkin', 'Hand-to-Mouth', 'Eye Coordination', 'Visual Tracking',
      ];

      childIds.forEach(cid => {
        const childRawReflexes = (allReflexes || []).filter(r => r.learner_id === cid);
        const result = [];
        for (const rname of REFLEX_NAMES_LIST) {
          const rscores = childRawReflexes.filter(s => s.reflex_name === rname);
          if (!rscores.length) continue;
          const latest = rscores[rscores.length - 1];
          let trend = 'stable';
          if (rscores.length >= 2) {
            const prev = parseFloat(rscores[rscores.length - 2].score || 50);
            const curr = parseFloat(latest.score || 50);
            trend = curr > prev + 2 ? 'improving' : (curr < prev - 2 ? 'declining' : 'stable');
          }
          result.push({ ...latest, score: String(latest.score), trend });
        }
        reflexesByChild[cid] = result;
      });

      // Build stats
      const stats = {};
      learnersList.forEach(l => {
        const childSess = sessionsByChild[l.id] || [];
        const childRefl = reflexesByChild[l.id] || [];
        const ap = atlasProfilesByChild[l.id];

        // avgAccuracy
        const avgAccuracy = childSess.length 
          ? (childSess.reduce((acc, s) => acc + toPercent(s.accuracy_score), 0) / childSess.length)
          : null;
        
        // retainedReflexScore > 40
        const hasRetainedReflex = childRefl.some(r => (100 - parseInt(r.score)) > 40) ||
                                  (ap?.motor_reflexes || []).some(r => (r.score * 25) > 40);
        
        // atlasRisk == HIGH
        const atlasRisk = ap?.atlas_risk === 'HIGH' || ap?.atlasRisk === 'HIGH' || ap?.risk_level === 'HIGH' || l.diagnosis?.toLowerCase().includes('severe');

        const needsAttention = (avgAccuracy !== null && avgAccuracy < 70) || hasRetainedReflex || atlasRisk;

        stats[l.id] = {
          latestSession: childSess[0] || null,
          sessions: childSess,
          reflexes: childRefl,
          needsAttention,
        };
      });

      // Add temporary diagnostic logs
      console.log("=== DIAGNOSTIC AUDIT: Specialist Workspace Data Flow ===");
      learnersList.forEach(l => {
        const childSess = sessionsByChild[l.id] || [];
        const childRefl = reflexesByChild[l.id] || [];
        const ap = atlasProfilesByChild[l.id] || {};
        
        const sessionsCount = childSess.length;
        const lastSession = childSess[0] || null;
        
        const accuracy = lastSession ? toPercent(lastSession.accuracy_score) : 0;
        const avgAccuracy = sessionsCount 
          ? (childSess.reduce((acc, s) => acc + toPercent(s.accuracy_score), 0) / sessionsCount) 
          : 0;
        const LPI = lastSession ? parseInt(lastSession.lpi_score || 0) : 0;
        
        const atlasFlags = childRefl.filter(r => (100 - parseInt(r.score)) > 40).map(r => r.reflex_name);
        const reflexSeverity = childRefl.map(r => `${r.reflex_name}: ${r.score} (Conf: ${r.confidence_level})`);
        
        console.log({
          learnerId: l.id,
          learnerName: l.name,
          sessionsCount,
          accuracy,
          avgAccuracy,
          LPI,
          atlasFlags,
          reflexSeverity,
          createdAt: l.created_at,
          lastSession: lastSession ? { id: lastSession.id, start_time: lastSession.start_time } : null
        });
      });
      console.log("=========================================================");

      setLearnerStats(stats);
    } catch (err) {
      console.error(err);
      toast.error('Could not load learner data');
    } finally {
      setLoading(false);
    }
  };

  // Helper for reflex name normalization across tables
  const mapReflexName = (rname) => {
    const norm = rname.toLowerCase();
    if (norm.includes('moro')) return 'Moro';
    if (norm.includes('atnr')) return 'ATNR';
    if (norm.includes('tlr')) return 'TLR';
    if (norm.includes('stnr')) return 'STNR';
    if (norm.includes('palmar')) return 'Palmar';
    if (norm.includes('spinal')) return 'Spinal';
    return rname;
  };

  // Helper to compute priority logic per reflex
  const getReflexPriority = (l, rname) => {
    const s = learnerStats[l.id] || {};
    const childSess = s.sessions || [];
    const childRefl = s.reflexes || [];
    const ap = atlasProfiles[l.id];

    // 1. avgAccuracy < 70
    const avgAccuracy = childSess.length 
      ? (childSess.reduce((acc, s) => acc + toPercent(s.accuracy_score), 0) / childSess.length)
      : null;
    const accuracyFlag = (avgAccuracy !== null && avgAccuracy < 70);

    // 2. retainedReflexScore > 40
    const rs = childRefl.find(r => mapReflexName(r.reflex_name) === rname);
    const apReflex = (ap?.motor_reflexes || []).find(r => mapReflexName(r.name) === rname);

    let retainedReflexScore = 0;
    if (rs) {
      retainedReflexScore = 100 - parseFloat(rs.score || 100);
    } else if (apReflex) {
      retainedReflexScore = (apReflex.score || 0) * 25;
    }
    const reflexFlag = (retainedReflexScore > 40);

    // 3. atlasRisk == HIGH
    const atlasRisk = ap?.atlas_risk || ap?.atlasRisk || ap?.risk_level || (l.diagnosis?.toLowerCase().includes('severe') ? 'HIGH' : 'LOW');
    const riskFlag = (atlasRisk === 'HIGH');

    const hasAssessment = !!rs || !!apReflex;

    return {
      isHigh: (accuracyFlag || reflexFlag || riskFlag),
      hasAssessment
    };
  };

  // Group sessions by child_id for all connected children
  const allSessionsList = Object.values(learnerStats).flatMap(s => s.sessions || []);
  const totalSessionsCount = allSessionsList.length;

  // Active Learners = connected learners with active relationship, not deleted, not archived
  const activeLearnersCount = learners.filter(l => l && !l.is_deleted && !l.is_archived).length;

  const avgAccuracyPercent = allSessionsList.length
    ? Math.round(allSessionsList.reduce((sum, s) => sum + toPercent(s.accuracy_score), 0) / allSessionsList.length) + '%'
    : '—';

  const avgLpiValue = allSessionsList.length
    ? Math.round(allSessionsList.reduce((sum, s) => sum + parseInt(s.lpi_score || 0), 0) / allSessionsList.length)
    : '—';

  const attentionCount = learners.filter(l => learnerStats[l.id]?.needsAttention).length;

  // Pagination calculations for learners list
  const totalLearnerPages = Math.ceil(learners.length / learnersPerPage) || 1;
  const paginatedLearners = learners.slice((learnerPage - 1) * learnersPerPage, learnerPage * learnersPerPage);

  // Paginated bar chart data
  const chartData = paginatedLearners.map(l => {
    const s = learnerStats[l.id] || {};
    
    // Validate and fallback: accuracy = session.averageAccuracy ?? learner.metrics.avgAccuracy ?? 0
    const sessionAcc = s.latestSession?.averageAccuracy ?? s.latestSession?.accuracy_score;
    const rawAcc = sessionAcc ?? l.metrics?.avgAccuracy ?? 0;
    
    // Parse to ensure numeric accuracy
    let parsedAcc = typeof rawAcc === 'string' ? parseFloat(rawAcc) : rawAcc;
    if (parsedAcc === undefined || parsedAcc === null || isNaN(parsedAcc)) {
      parsedAcc = 0;
    }
    
    const acc = Math.round(parsedAcc * 100);
    const lpiVal = s.latestSession?.lpi_score !== undefined ? parseInt(s.latestSession.lpi_score) : 0;
    
    return { 
      name: l.name.split(' ')[0], 
      accuracy: acc, 
      lpi: isNaN(lpiVal) ? 0 : lpiVal 
    };
  });

  const allAccuracyValuesMissing = chartData.length === 0 || chartData.every(d => d.accuracy === 0 && d.lpi === 0);

  // Inject tooltip CSS dynamically
  if (typeof document !== 'undefined' && !document.getElementById('ot-tooltip-css')) {
    const style = document.createElement('style');
    style.id = 'ot-tooltip-css';
    style.textContent = `
      .tooltip-container:hover .tooltip-text {
        visibility: visible !important;
        opacity: 1 !important;
      }
    `;
    document.head.appendChild(style);
  }

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
      <VideoModal isOpen={!!activeVideo} onClose={() => setActiveVideo(null)} videoUrl={activeVideo?.video_url} title={activeVideo?.name} />
      <ConnectionModal
        isOpen={showConnectionModal}
        onClose={() => { setShowConnectionModal(false); fetchLearners(); }}
        role="practitioner"
      />
      {showUploadModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 500, padding: 24, boxShadow: '0 20px 40px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0D3D47', margin: 0 }}>{editingExerciseId ? 'Edit Video Exercise' : 'Upload Video Exercise'}</h2>
              <button onClick={() => { setShowUploadModal(false); setEditingExerciseId(null); setUploadForm({ name: '', target_reflex: '', description: '', duration_minutes: '', difficulty_level: 'medium', video_url: '' }); setUploadFile(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF' }}><X size={20} /></button>
            </div>
            <form onSubmit={handleUploadExercise}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#4B5563', marginBottom: 4 }}>Video File (MP4/WebM) {editingExerciseId && <span style={{fontWeight: 400}}>(leave blank to keep existing)</span>}</label>
                  <input type="file" accept="video/mp4,video/webm" onChange={e => setUploadFile(e.target.files[0])} required={!editingExerciseId && !uploadForm.video_url} style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #D1D5DB' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#4B5563', marginBottom: 4 }}>Exercise Name*</label>
                  <input type="text" value={uploadForm.name} onChange={e => setUploadForm({...uploadForm, name: e.target.value})} required style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #D1D5DB' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#4B5563', marginBottom: 4 }}>Description</label>
                  <textarea value={uploadForm.description} onChange={e => setUploadForm({...uploadForm, description: e.target.value})} rows={3} style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #D1D5DB' }} />
                </div>
                <div style={{ display: 'flex', gap: 14 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#4B5563', marginBottom: 4 }}>Target Reflex</label>
                    <input type="text" value={uploadForm.target_reflex} onChange={e => setUploadForm({...uploadForm, target_reflex: e.target.value})} placeholder="e.g. Moro" style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #D1D5DB' }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#4B5563', marginBottom: 4 }}>Duration (min)</label>
                    <input type="number" value={uploadForm.duration_minutes} onChange={e => setUploadForm({...uploadForm, duration_minutes: e.target.value})} style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #D1D5DB' }} />
                  </div>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#4B5563', marginBottom: 4 }}>Difficulty</label>
                  <select value={uploadForm.difficulty_level} onChange={e => setUploadForm({...uploadForm, difficulty_level: e.target.value})} style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #D1D5DB' }}>
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                </div>
              </div>
              <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                <button type="button" onClick={() => { setShowUploadModal(false); setEditingExerciseId(null); setUploadForm({ name: '', target_reflex: '', description: '', duration_minutes: '', difficulty_level: 'medium', video_url: '' }); setUploadFile(null); }} style={{ padding: '10px 16px', background: '#F3F4F6', color: '#4B5563', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
                <button type="submit" disabled={uploading} style={{ padding: '10px 20px', background: '#0D5E6B', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, cursor: uploading ? 'not-allowed' : 'pointer' }}>
                  {uploading ? (editingExerciseId ? 'Saving...' : 'Uploading...') : (editingExerciseId ? 'Save Changes' : 'Upload Video')}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
      <Sidebar navItems={NAV} activeId={activeTab} onNavClick={setActiveTab} />
      <main className="main-content">
        <motion.div initial={{ opacity:0,y:-10 }} animate={{ opacity:1,y:0 }} style={styles.header} className="ot-header">
          <div>
            <h1 style={styles.pageTitle}>Specialist Workspace</h1>
            <p style={styles.pageSub}>Monitoring {learners.length} learner{learners.length !== 1 ? 's' : ''} · {new Date().toLocaleDateString()}</p>
          </div>
          {attentionCount > 0 && (
            <div style={styles.alertBanner}>
              <AlertTriangle size={16} color="#E8841A" />
              <span style={{ fontWeight: 600, color: '#92400E', fontSize: '0.875rem' }}>
                {attentionCount} learner{attentionCount > 1 ? 's' : ''} need attention
              </span>
            </div>
          )}
          <button onClick={() => setShowConnectionModal(true)}
            style={{ padding: '8px 14px', background: 'linear-gradient(135deg, #0D5E6B, #1A8FA0)', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            <UserPlus size={14} /> Connect Learner
          </button>
        </motion.div>

        {/* ── Pending Connection Requests (Premium UI) ── */}
        {pendingRequests.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            style={{ marginBottom: 24 }}
          >
            <div style={{
              background: 'linear-gradient(135deg, #FFFBEB, #FEF9E7)',
              border: '1.5px solid #FCD34D',
              borderRadius: 18,
              overflow: 'hidden',
              boxShadow: '0 4px 20px rgba(251,191,36,0.15)',
            }}>
              {/* Header */}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '14px 20px', borderBottom: '1px solid #FDE68A',
                background: 'rgba(253,230,138,0.3)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 10, background: '#FDE68A',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <UserCheck size={16} color="#D97706" />
                  </div>
                  <div>
                    <div style={{ fontWeight: 800, color: '#92400E', fontSize: '0.9rem', fontFamily: 'Inter, sans-serif' }}>
                      Pending access requests
                    </div>
                    <div style={{ fontSize: '0.73rem', color: '#B45309' }}>
                      {pendingRequests.length} request{pendingRequests.length > 1 ? 's' : ''} require{pendingRequests.length > 1 ? '' : 's'} your approval
                    </div>
                  </div>
                </div>
                <div style={{
                  background: '#F59E0B', color: '#fff', borderRadius: 20,
                  padding: '2px 10px', fontSize: '0.75rem', fontWeight: 800,
                }}>
                  {pendingRequests.length} PENDING
                </div>
              </div>

              {/* Request list */}
              <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {pendingRequests.map((req, idx) => (
                  <motion.div
                    key={req.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 14,
                      background: '#fff', padding: '14px 16px',
                      borderRadius: 14, border: '1px solid #FDE68A',
                      boxShadow: '0 2px 8px rgba(251,191,36,0.1)',
                    }}
                    className="ot-pending-request"
                  >
                    {/* Avatar */}
                    <div style={{
                      width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                      background: 'linear-gradient(135deg, #0D5E6B, #1A8FA0)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#fff', fontFamily: 'Inter, sans-serif', fontWeight: 800, fontSize: '1rem',
                    }}>
                      {req.parent?.first_name?.[0] || 'P'}
                    </div>

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, color: '#1F2937', fontSize: '0.9rem', lineHeight: 1.4 }}>
                        <span style={{ color: '#0D5E6B' }}>{req.parent?.first_name || 'Individual'} {req.parent?.last_name || ''}</span> requested to connect for learner <strong style={{ color: '#0D5E6B' }}>{req.child?.first_name || 'the learner'} {req.child?.last_name || ''}</strong>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#6B7280', marginTop: 4 }}>
                        <span style={{ fontWeight: 600 }}>Request Date:</span> {req.created_at ? new Date(req.created_at).toLocaleDateString() : 'N/A'}
                      </div>
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: 8, flexShrink: 0 }} className="ot-pending-actions">
                      <button
                        onClick={async () => {
                          try {
                            await api.post('/connections/approve', { requestId: req.id });
                            setPendingRequests(prev => prev.filter(r => r.id !== req.id));
                            fetchLearners(); // Refresh learner list to show the new connection
                            toast.success(`You are now following ${req.child?.first_name || 'the learner'}!`);
                          } catch { toast.error('Error during approval'); }
                        }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 6,
                          padding: '8px 14px', background: '#059669', color: '#fff',
                          border: 'none', borderRadius: 10, fontSize: '0.8rem',
                          fontWeight: 700, cursor: 'pointer',
                        }}
                      >
                        <span style={{display: "flex", alignItems: "center", gap: 4}}><Check size={14} /> Approve</span>
                      </button>
                      <button
                        onClick={async () => {
                          try {
                            await api.post('/connections/reject', { requestId: req.id });
                            setPendingRequests(prev => prev.filter(r => r.id !== req.id));
                            toast.success('Request rejected.');
                          } catch { toast.error('Error during rejection'); }
                        }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 6,
                          padding: '8px 12px', background: '#FEE2E2', color: '#991B1B',
                          border: '1px solid #FECACA', borderRadius: 10, fontSize: '0.8rem',
                          fontWeight: 700, cursor: 'pointer',
                        }}
                      >
                        <span style={{display: "flex", alignItems: "center", gap: 4}}><X size={14} /> Reject</span>
                      </button>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'analytics' ? (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            {/* KPI row for analytics */}
            <div style={styles.kpiRow} className="ot-kpi-grid">
              {[
                { label: 'Active Learners', value: activeLearnersCount, color: '#0D5E6B' },
                { label: 'Need Attention',  value: attentionCount,  color: '#EF4444', hasTooltip: true },
                { label: 'Avg Accuracy',    value: avgAccuracyPercent, color: '#E8841A' },
                { label: 'Avg LPI',         value: avgLpiValue, color: '#8B5CF6' },
              ].map((k) => (
                <div key={k.label} className="card" style={styles.kpiCard}>
                  <div style={{ ...styles.kpiVal, color: k.color }}>{k.value}</div>
                  <div style={{ ...styles.kpiLbl, display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
                    {k.label}
                    {k.hasTooltip && (
                      <span className="tooltip-container" style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                        <Info size={14} color="#9CA3AF" />
                        <span className="tooltip-text" style={styles.tooltipText}>
                          A learner needs attention if their average session accuracy is under 70%, or if they have a primitive reflex score below 40 (retained reflex with High confidence).
                        </span>
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Bar chart + reflex flags */}
            <div style={styles.twoCol} className="ot-two-col">
              <div className="card" style={{ padding: 24, minWidth: 0 }}>
                <div className="section-header">
                  <span className="section-title">Accuracy by Learner</span>
                </div>
                {allAccuracyValuesMissing ? (
                  <div style={{ height: 230, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#9CA3AF', fontSize: '0.9rem', fontStyle: 'italic', background: '#F9FAFB', borderRadius: 12, border: '1px dashed #E5E7EB' }}>
                    <span style={{ fontWeight: 600 }}>No data yet</span>
                    <span style={{ fontSize: '0.8rem', marginTop: 4 }}>No session accuracy available</span>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={230}>
                    <BarChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: -20 }}>
                      <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#9CA3AF' }} />
                      <YAxis tick={{ fontSize: 11, fill: '#9CA3AF' }} domain={[0, 100]} />
                      <Tooltip contentStyle={{ borderRadius: 10, border: 'none', fontSize: 12 }} />
                      <Bar dataKey="accuracy" fill="#0D5E6B" radius={[6,6,0,0]} name="Accuracy %" />
                      <Bar dataKey="lpi" fill="#E8841A" radius={[6,6,0,0]} name="LPI" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              <div className="card" style={{ padding: 24 }}>
                <div className="section-header">
                  <span className="section-title">Reflex Flags</span>
                </div>
                {(() => {
                  const hasAnyAssessment = Object.values(learnerStats).some(s => s.sessions?.length > 0 || s.reflexes?.length > 0);
                  if (!hasAnyAssessment) {
                    return <div style={{ fontSize: '0.85rem', color: '#9CA3AF', fontStyle: 'italic', padding: '12px 0' }}>Not assessed</div>;
                  }
                  
                  const targetReflexes = ['Moro', 'ATNR', 'TLR', 'STNR', 'Palmar', 'Spinal'];
                  const isAllZero = targetReflexes.every(rname => {
                    return learners.filter(l => {
                      const priorityObj = getReflexPriority(l, rname);
                      return priorityObj.isHigh && priorityObj.hasAssessment;
                    }).length === 0;
                  });
                  
                  if (isAllZero) {
                    return <div style={{ fontSize: '0.85rem', color: '#6B7280', fontStyle: 'italic', padding: '12px 0' }}>No clinical indicators</div>;
                  }
                  
                  return targetReflexes.map(rname => {
                    const flagged = learners.filter(l => {
                      const priorityObj = getReflexPriority(l, rname);
                      return priorityObj.isHigh && priorityObj.hasAssessment;
                    }).length;
                    
                    const pct = Math.round((flagged / learners.length) * 100);
                    
                    return (
                      <div key={rname} style={{ marginBottom: 18 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                          <span style={{ fontWeight: 600, color: '#374151', fontSize: '0.9rem' }}>{rname} Reflex</span>
                          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: flagged > 0 ? '#EF4444' : '#10B981' }}>
                            {flagged}/{learners.length} learners
                          </span>
                        </div>
                        <div style={{ ...styles.flagBar, background: '#10B981', position: 'relative' }}>
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${pct}%` }}
                            transition={{ duration: 0.8, ease: 'easeOut' }}
                            style={{ ...styles.flagBarFill, background: '#EF4444' }}
                          />
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>

            {/* Learner progress table */}
            <div className="card" style={{ marginTop: 20 }}>
              <div style={{ padding: '20px 24px 12px' }}>
                <span className="section-title">Learner Progress Summary</span>
              </div>
              <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Learner</th><th>Age</th><th>Last Accuracy</th>
                    <th>LPI</th><th>Response Time</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {learners.map(l => {
                    const s = learnerStats[l.id] || {};
                    const acc = s.latestSession ? toPercent(s.latestSession.accuracy_score) : null;
                    const status = s.needsAttention ? 'attention' : (acc !== null && acc >= 70 ? 'on-track' : 'monitor');
                    return (
                      <tr key={l.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/ot/learner/${l.id}`)}>
                        <td data-label="Learner" style={{ fontWeight: 600 }}>{l.name}</td>
                        <td data-label="Age">{l.age}</td>
                        <td data-label="Last Accuracy"><span style={{ fontWeight: 700, color: acc >= 70 ? '#10B981' : '#F59E0B' }}>{acc !== null ? `${acc}%` : '—'}</span></td>
                        <td data-label="LPI" style={{ fontWeight: 600, color: '#0D5E6B' }}>{s.latestSession?.lpi_score || '—'}</td>
                        <td data-label="Response Time">{s.latestSession ? `${(parseFloat(s.latestSession.avg_response_time_ms||0)/1000).toFixed(1)}s` : '—'}</td>
                        <td data-label="Status"><span className={`badge badge-${status==='attention'?'danger':status==='on-track'?'success':'warning'}`}>
                          {status==='attention'?(<span style={{display: "flex", alignItems: "center", gap: 4}}><AlertTriangle size={14} /> Needs Attention</span>):status==='on-track'?(<span style={{display: "flex", alignItems: "center", gap: 4}}><CheckCircle size={14} /> On Track</span>):'Monitor'}
                        </span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </div>
          </motion.div>
        ) : activeTab === 'exercises' ? (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <h2 style={styles.pageTitle}>Exercise Library</h2>
                <p style={styles.pageSub}>{exercises.length} exercises grouped by target reflex · Assign to any learner</p>
              </div>
              <button
                onClick={() => { setEditingExerciseId(null); setUploadForm({ name: '', target_reflex: '', description: '', duration_minutes: '', difficulty_level: 'medium', video_url: '' }); setUploadFile(null); setShowUploadModal(true); }}
                style={{ padding: '8px 14px', background: '#0D5E6B', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <Plus size={14} /> Upload Exercise
              </button>
            </div>

            {Object.entries(
              exercises.reduce((acc, ex) => {
                const key = ex.target_reflex || 'Other';
                if (!acc[key]) acc[key] = [];
                acc[key].push(ex);
                return acc;
              }, {})
            ).map(([reflex, exList]) => (
              <div key={reflex} className="card" style={{ padding: 24, marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
                  <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 800, color: '#0D5E6B', fontSize: '1rem' }}>{reflex} Reflex</span>
                  <span className="badge badge-teal">{exList.length} exercises</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
                  {exList.map((ex) => {
                    const assignedPres = allPrescriptions.filter(p => p.exercise_id === ex.id);
                    const assignedIds = new Set(assignedPres.map(p => p.learner_id));
                    const unassigned = learners.filter(l => !assignedIds.has(l.id));
                    return (
                    <div key={ex.id} style={{ background: '#F8FAFB', border: '1.5px solid #DDE8EB', borderRadius: 14, padding: '16px 14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                        <span style={{ fontWeight: 700, color: '#0D3D47', fontSize: '0.92rem' }}>{ex.name}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className={`badge badge-${ex.difficulty_level === 'medium' ? 'warning' : 'success'}`}>{ex.difficulty_level}</span>
                          <button 
                            onClick={() => { 
                              setEditingExerciseId(ex.id); 
                              setUploadForm({ name: ex.name, target_reflex: ex.target_reflex, description: ex.description, duration_minutes: ex.duration_minutes, difficulty_level: ex.difficulty_level, video_url: ex.video_url }); 
                              setUploadFile(null);
                              setShowUploadModal(true); 
                            }} 
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280', padding: 2 }} title="Edit"
                          ><Edit3 size={14} /></button>
                          <button 
                            onClick={() => handleDeleteExercise(ex.id)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#EF4444', padding: 2 }} title="Delete"
                          ><Trash2 size={14} /></button>
                        </div>
                      </div>
                      <p style={{ fontSize: '0.78rem', color: '#6B7280', lineHeight: 1.5, marginBottom: 10 }}>{ex.description}</p>

                      {/* Assigned learners chips */}
                      {assignedPres.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                          {assignedPres.map(p => (
                            <span key={p.id} style={styles.assignChip}>
                              {p.learner?.name || 'Learner'}
                              <button
                                onClick={async () => {
                                  try {
                                    await api.delete(`/prescriptions/${p.id}`);
                                    setAllPrescriptions(prev => prev.filter(x => x.id !== p.id));
                                    toast.success('Removed assignment');
                                  } catch { toast.error('Error removing'); }
                                }}
                                style={styles.chipRemove}
                                title="Remove assignment"
                              ><X size={10} /></button>
                            </span>
                          ))}
                        </div>
                      )}

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                        <span style={{ fontSize: '0.72rem', color: '#9CA3AF', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}><Clock size={12} /> {ex.duration_minutes} min</span>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button 
                            onClick={() => {
                              if (ex.video_url) setActiveVideo(ex);
                              else toast.error('No video available for this exercise');
                            }}
                            style={{ padding: '5px 10px', background: '#EEF6F8', color: '#0D5E6B', border: '1px solid #B2DFE6', borderRadius: 7, fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Play size={10} /> Watch
                          </button>
                          {unassigned.length > 0 ? (
                          <select
                            defaultValue=""
                            onChange={async (e) => {
                              if (!e.target.value) return;
                              const learnerId = e.target.value;
                              try {
                                const res = await api.post('/exercises/prescribe', { 
                                  learner_id: learnerId, 
                                  exercise_id: ex.id, 
                                  notes: 'Assigned by OT',
                                  specialist_id: user?.id 
                                });
                                const assignedLearner = learners.find(l => l.id === learnerId);
                                setAllPrescriptions(prev => [...prev, { id: res.data.prescription_id, learner_id: learnerId, exercise_id: ex.id, learner: assignedLearner || {} }]);
                                toast.success(`Assigned to ${assignedLearner?.name || 'learner'}!`);
                                e.target.value = '';
                              } catch { toast.error('Could not assign'); }
                            }}
                            style={{ padding: '5px 8px', borderRadius: 7, border: '1.5px solid #0D5E6B', fontSize: '0.72rem', fontWeight: 600, color: '#0D5E6B', background: '#fff', cursor: 'pointer' }}
                          >
                            <option value="">Assign to…</option>
                            {unassigned.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                          </select>
                          ) : (
                            <span style={{ fontSize: '0.7rem', color: '#10B981', fontWeight: 600, padding: '4px 8px', background: '#D1FAE5', borderRadius: 6 }}><span style={{display: "flex", alignItems: "center", gap: 4}}>All assigned <Check size={12} /></span></span>
                          )}
                        </div>
                      </div>
                    </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </motion.div>

        ) : activeTab === 'reports' ? (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <div style={{ marginBottom: 20 }}>
              <h2 style={styles.pageTitle}>Session Reports</h2>
              <p style={styles.pageSub}>Download PDF reports per learner session</p>
            </div>

            {learners.map((l) => {
              const s = learnerStats[l.id] || {};
              return (
                <LearnerSessionCard
                  key={l.id}
                  learner={l}
                  stats={s}
                  onDeleteSession={async (sessId) => {
                    if (!window.confirm(`Delete session? This cannot be undone.`)) return;
                    try {
                      await api.delete(`/sessions/${sessId}`);
                      toast.success('Deleted');
                      setLearnerStats(prev => {
                        const updated = { ...prev };
                        const ls = { ...updated[l.id] };
                        ls.sessions = ls.sessions.filter(x => x.id !== sessId);
                        if (ls.sessions.length > 0) ls.latestSession = ls.sessions[0];
                        else ls.latestSession = null;
                        updated[l.id] = ls;
                        return updated;
                      });
                    } catch { toast.error('Error deleting'); }
                  }}
                />
              );
            })}
          </motion.div>

        ) : activeTab === 'overview' ? (
          <>
            {learners.length === 0 ? (
              <div style={{ textAlign:'center', padding:'80px 24px', color:'#6B7280', background: '#fff', borderRadius: 24, border: '2px dashed #E5E7EB', marginTop: 10 }}>
                <div style={{ fontSize:'4rem', marginBottom:16 }}><UserCheck size={64} color="#0D5E6B" /></div>
                <h3 style={{ fontFamily:'Inter,sans-serif', color:'#0D5E6B', marginBottom: 8, fontSize: '1.5rem', fontWeight: 800 }}>No learners connected</h3>
                <p style={{ fontSize:'0.95rem', marginBottom: 24, maxWidth: 420, margin: '0 auto 28px', lineHeight: 1.6 }}>
                  You are not currently following any learners on the platform. Share your connection code with parents so they can grant you access.
                </p>
                <button
                  onClick={() => setShowConnectionModal(true)}
                  style={{
                    padding: '14px 28px', background: 'linear-gradient(135deg, #0D5E6B, #1A8FA0)', color: '#fff',
                    border: 'none', borderRadius: 14, fontWeight: 700, fontSize: '1rem', cursor: 'pointer',
                    boxShadow: '0 8px 24px rgba(13,94,107,0.25)', display: 'inline-flex', alignItems: 'center', gap: 8
                  }}
                >
                  <UserPlus size={18} /> Connect a learner
                </button>
              </div>
            ) : (
              <>
            {/* Summary KPIs */}
        <div style={styles.kpiRow} className="ot-kpi-grid">
          {[
            { label: 'Active Learners',   value: activeLearnersCount,  color: '#0D5E6B' },
            { label: 'Need Attention',    value: attentionCount,   color: '#EF4444', hasTooltip: true },
            { label: 'Avg LPI',           value: avgLpiValue,          color: '#E8841A' },
            { label: 'Total Sessions',    value: totalSessionsCount,   color: '#10B981' },
          ].map((k) => (
            <div key={k.label} className="card" style={styles.kpiCard}>
              <div style={{ ...styles.kpiVal, color: k.color }}>{k.value}</div>
              <div style={{ ...styles.kpiLbl, display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
                {k.label}
                {k.hasTooltip && (
                  <span className="tooltip-container" style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                    <Info size={14} color="#9CA3AF" />
                    <span className="tooltip-text" style={styles.tooltipText}>
                      A learner needs attention if their average session accuracy is under 70%, or if they have a primitive reflex score below 40 (retained reflex with High confidence).
                    </span>
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        <div style={styles.twoCol} className="ot-two-col">
          {/* Learner list */}
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '20px 24px 12px' }}>
              <span className="section-title">Learner Status</span>
            </div>
            {paginatedLearners.map((l) => {
              const s = learnerStats[l.id] || {};
              const acc = s.latestSession ? toPercent(s.latestSession.accuracy_score) : null;
              const status = s.needsAttention ? 'attention' : (acc !== null && acc >= 70 ? 'on-track' : 'monitor');
              return (
                <motion.div
                  key={l.id}
                  onClick={() => navigate(`/ot/learner/${l.id}`)}
                  whileHover={{ background: '#F9FAFB' }}
                  style={styles.learnerRow}
                >
                  <div style={{ ...styles.learnerAvatar, borderRadius: '50%', background: l.avatar_color || '#0D5E6B', overflow: 'hidden' }}>
                    {l.avatar_url ? (
                      <img src={l.avatar_url} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <User size={20} />
                    )}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={styles.learnerName}>{l.name}</div>
                    <div style={styles.learnerInfo}>Age {l.age} · {l.diagnosis.split(',')[0]}</div>
                  </div>
                  <div style={styles.learnerMeta}>
                    {acc !== null && (
                      <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 700, fontSize: '1rem',
                        color: acc >= 70 ? '#10B981' : '#F59E0B' }}>
                        {acc}%
                      </span>
                    )}
                    <span className={`badge badge-${status === 'attention' ? 'danger' : status === 'on-track' ? 'success' : 'warning'}`}>
                      {status === 'attention' ? (<span style={{display: "flex", alignItems: "center", gap: 4}}><AlertTriangle size={14} /> Needs Attention</span>) : status === 'on-track' ? (<span style={{display: "flex", alignItems: "center", gap: 4}}><CheckCircle size={14} /> On Track</span>) : 'Monitor'}
                    </span>
                  </div>
                  <ChevronRight size={16} color="#9CA3AF" />
                </motion.div>
              );
            })}
            {totalLearnerPages > 1 && (
              <div style={styles.pagination}>
                <button
                  disabled={learnerPage <= 1}
                  onClick={() => setLearnerPage(p => Math.max(1, p - 1))}
                  style={{ ...styles.pageBtn, opacity: learnerPage <= 1 ? 0.4 : 1 }}
                >
                  <ChevronLeft size={14} /> Prev
                </button>
                <div style={{ display: 'flex', gap: 6 }}>
                  {Array.from({ length: totalLearnerPages }, (_, i) => (
                    <button
                      key={i}
                      onClick={() => setLearnerPage(i + 1)}
                      style={{
                        ...styles.pageDot,
                        ...(learnerPage === i + 1 ? styles.pageDotActive : {})
                      }}
                    >
                      {i + 1}
                    </button>
                  ))}
                </div>
                <button
                  disabled={learnerPage >= totalLearnerPages}
                  onClick={() => setLearnerPage(p => Math.min(totalLearnerPages, p + 1))}
                  style={{ ...styles.pageBtn, opacity: learnerPage >= totalLearnerPages ? 0.4 : 1 }}
                >
                  Next <ChevronRight size={14} />
                </button>
              </div>
            )}
          </div>

          {/* Chart */}
          <div className="card" style={{ padding: 24, minWidth: 0 }}>
            <div className="section-header">
              <span className="section-title">Accuracy Comparison</span>
            </div>
            {allAccuracyValuesMissing ? (
              <div style={{ height: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#9CA3AF', fontSize: '0.9rem', fontStyle: 'italic', background: '#F9FAFB', borderRadius: 12, border: '1px dashed #E5E7EB' }}>
                <span style={{ fontWeight: 600 }}>No data yet</span>
                <span style={{ fontSize: '0.8rem', marginTop: 4 }}>No session accuracy available</span>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: -20 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#9CA3AF' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#9CA3AF' }} domain={[0, 100]} />
                  <Tooltip contentStyle={{ borderRadius: 10, border: 'none', fontSize: 12 }} />
                  <Bar dataKey="accuracy" fill="#0D5E6B" radius={[4,4,0,0]} name="Accuracy %" />
                  <Bar dataKey="lpi" fill="#E8841A" radius={[4,4,0,0]} name="LPI" />
                </BarChart>
              </ResponsiveContainer>
            )}

            {/* Reflex legend */}
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #F3F4F6' }}>
              <div style={styles.reflexSummaryTitle}>High-Priority Flags Across All Learners</div>
              {(() => {
                const hasAnyAssessment = Object.values(learnerStats).some(s => s.sessions?.length > 0 || s.reflexes?.length > 0);
                if (!hasAnyAssessment) {
                  return <div style={{ fontSize: '0.85rem', color: '#9CA3AF', fontStyle: 'italic', padding: '12px 0' }}>Not assessed</div>;
                }
                
                const targetReflexes = ['Moro', 'ATNR', 'TLR', 'STNR', 'Palmar', 'Spinal'];
                const isAllZero = targetReflexes.every(rname => {
                  return learners.filter(l => {
                    const priorityObj = getReflexPriority(l, rname);
                    return priorityObj.isHigh && priorityObj.hasAssessment;
                  }).length === 0;
                });
                
                if (isAllZero) {
                  return <div style={{ fontSize: '0.85rem', color: '#6B7280', fontStyle: 'italic', padding: '12px 0' }}>No clinical indicators</div>;
                }
                
                return targetReflexes.map(rname => {
                  const flagged = learners.filter(l => {
                    const priorityObj = getReflexPriority(l, rname);
                    return priorityObj.isHigh && priorityObj.hasAssessment;
                  }).length;
                  
                  const pct = Math.round((flagged / learners.length) * 100);
                  
                  return (
                    <div key={rname} style={styles.reflexFlag}>
                      <span style={styles.reflexFlagName}>{rname}</span>
                      <div style={{ ...styles.flagBar, background: '#10B981', position: 'relative' }}>
                        <div style={{
                          ...styles.flagBarFill,
                          width: `${pct}%`,
                          background: '#EF4444',
                        }} />
                      </div>
                      <span style={{ fontSize: '0.75rem', color: '#6B7280', minWidth: 45, textAlign: 'right' }}>
                        {flagged}/{learners.length}
                      </span>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        </div>

        {/* Attention alerts */}
        {learners.filter(l => learnerStats[l.id]?.needsAttention).map(l => {
          const s = learnerStats[l.id];
          const ap = atlasProfiles[l.id];
          const childSess = s.sessions || [];
          
          // Determine reasons for attention alert
          const avgAccuracy = childSess.length 
            ? (childSess.reduce((acc, s) => acc + toPercent(s.accuracy_score), 0) / childSess.length)
            : null;
          const accuracyFlag = (avgAccuracy !== null && avgAccuracy < 70);
          
          const highFlags = s.reflexes.filter(r => (100 - parseInt(r.score)) > 40);
          const apReflexFlags = (ap?.motor_reflexes || []).filter(r => (r.score * 25) > 40);
          
          const atlasRisk = ap?.atlas_risk === 'HIGH' || ap?.atlasRisk === 'HIGH' || ap?.risk_level === 'HIGH' || l.diagnosis?.toLowerCase().includes('severe');
          
          const attentionReasons = [];
          if (accuracyFlag) attentionReasons.push(`average session accuracy under 70% (${Math.round(avgAccuracy)}%)`);
          if (highFlags.length > 0) attentionReasons.push(`${highFlags.map(r => r.reflex_name).join(', ')} reflex retention score > 40`);
          if (apReflexFlags.length > 0 && highFlags.length === 0) attentionReasons.push(`${apReflexFlags.map(r => r.name).join(', ')} reflex retention score > 40`);
          if (atlasRisk) attentionReasons.push('high developmental risk flagged in clinical profile');
          
          return (
            <motion.div key={l.id}
              initial={{ opacity:0,x:-12 }} animate={{ opacity:1,x:0 }}
              className="card" style={styles.alertCard}
            >
              <AlertTriangle size={20} color="#E8841A" style={{ flexShrink:0 }} />
              <div style={{ flex: 1 }}>
                <span style={{ fontWeight: 700, color: '#1F2937' }}>{l.name}</span>
                {' '}needs attention:{' '}
                <span style={{ color: '#92400E', fontWeight: 600 }}>
                  {attentionReasons.length > 0 ? attentionReasons.join(', ') : 'clinical indicators flagged'}
                </span>
              </div>
              <button
                onClick={() => navigate(`/ot/learner/${l.id}`)}
                style={styles.viewBtn}
              >
                View Detail →
              </button>
            </motion.div>
          );
        })}
              </>
            )}
        </>
        ) : activeTab === 'profile' ? (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            {/* PRD v5: Professional Profile */}
            <div className="card" style={{ padding: 32, marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 28 }}>
                <div style={{ position: 'relative', display: 'inline-block' }}>
                  <div style={{
                    width: 72, height: 72, borderRadius: 20,
                    background: 'linear-gradient(135deg, #0D5E6B, #1A8FA0)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: 'Inter, sans-serif', fontWeight: 800, fontSize: '1.8rem', color: '#fff',
                    boxShadow: '0 8px 20px rgba(13,94,107,0.25)', overflow: 'hidden'
                  }}>
                    {profile?.avatar_url ? (
                      <img src={profile.avatar_url} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      profile?.first_name?.[0] || 'P'
                    )}
                  </div>
                  <label style={{
                    position: 'absolute', bottom: -8, right: -8,
                    background: '#fff', border: '1.5px solid #E5E7EB',
                    borderRadius: '50%', padding: 4, cursor: 'pointer',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.1)'
                  }}>
                    <span style={{ fontSize: '0.8rem' }}><Camera size={14} /></span>
                    <input type="file" accept="image/*" style={{ display: 'none' }} onChange={async (e) => {
                      const file = e.target.files[0];
                      if (!file) return;
                      const tId = toast.loading('Uploading avatar...');
                      try {
                        const fileExt = file.name.split('.').pop();
                        const filePath = `ot_${userId}_${Date.now()}.${fileExt}`;
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
                  <h2 style={{ fontFamily: 'Inter, sans-serif', fontWeight: 800, fontSize: '1.5rem', color: '#0D5E6B', margin: '0 0 4px 0' }}>
                    {profile?.first_name || 'Specialist'} {profile?.last_name || ''}
                  </h2>
                  <p style={{ margin: 0, color: '#6B7280', fontSize: '0.9rem' }}>
                    {specialistProfile.specialty || 'Occupational Therapist'} · NestureAI Beta
                  </p>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }} className="ot-profile-grid">
                <div>
                  <label style={pStyles.label}>Practice Name</label>
                  <input value={specialistProfile.practiceName}
                    onChange={e => setSpecialistProfile(p => ({ ...p, practiceName: e.target.value }))}
                    placeholder="e.g. ABC Paediatric Therapy" style={pStyles.input} />
                </div>
                <div>
                  <label style={pStyles.label}>Specialty</label>
                  <select value={specialistProfile.specialty}
                    onChange={e => setSpecialistProfile(p => ({ ...p, specialty: e.target.value }))}
                    style={pStyles.input}>
                    <option value="Occupational Therapist">Occupational Therapist (OT)</option>
                    <option value="Speech-Language Pathologist">Speech-Language Pathologist (SLP)</option>
                    <option value="Physical Therapist">Physical Therapist (PT)</option>
                    <option value="Behavioural Therapist">Behavioural Therapist (ABA)</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label style={pStyles.label}>Location</label>
                  <input value={specialistProfile.location}
                    onChange={e => setSpecialistProfile(p => ({ ...p, location: e.target.value }))}
                    placeholder="e.g. San Francisco, CA" style={pStyles.input} />
                </div>
                <div>
                  <label style={pStyles.label}>Registration / License Number <span style={{ color: '#9CA3AF' }}>(optional)</span></label>
                  <input value={specialistProfile.registrationNumber}
                    onChange={e => setSpecialistProfile(p => ({ ...p, registrationNumber: e.target.value }))}
                    placeholder="e.g. OT-12345" style={pStyles.input} />
                </div>
              </div>

              <div style={{ marginTop: 20 }}>
                <label style={pStyles.label}>Professional Bio</label>
                <textarea value={specialistProfile.bio}
                  onChange={e => setSpecialistProfile(p => ({ ...p, bio: e.target.value }))}
                  placeholder="A brief description of your experience and approach…"
                  rows={3} style={{ ...pStyles.input, resize: 'vertical' }} />
              </div>

              <button onClick={handleSaveProfile} disabled={profileSaving}
                style={{
                  marginTop: 24, padding: '12px 28px',
                  background: 'linear-gradient(135deg, #0D5E6B, #1A8FA0)',
                  color: '#fff', border: 'none', borderRadius: 10,
                  fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 8,
                  opacity: profileSaving ? 0.6 : 1,
                }}>
                <Save size={16} /> {profileSaving ? 'Saving…' : 'Save Profile'}
              </button>
            </div>

            {/* ══════ PROFILE: SECURITY & PASSWORD ══════ */}
            <div className="card" style={{ padding: 32, marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
                <div style={{ width: 44, height: 44, borderRadius: 10, background: '#EFF6FF', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Lock size={20} color="#1D4ED8" />
                </div>
                <div>
                  <div style={{ fontFamily: 'Inter, sans-serif', fontWeight: 800, fontSize: '1.2rem', color: '#0D5E6B' }}>Security & Password</div>
                  <div style={{ fontSize: '0.78rem', color: '#9CA3AF' }}>Verify your identity and update your password</div>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 24 }}>
                <div>
                  <label style={pStyles.label}>Current Password</label>
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <input 
                      type={showCurrentPwd ? 'text' : 'password'}
                      value={currentPassword} 
                      onChange={e => setCurrentPassword(e.target.value)}
                      style={{ ...pStyles.input, width: '100%', paddingRight: 40 }} 
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

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }} className="ot-profile-grid">
                  <div>
                    <label style={pStyles.label}>New Password</label>
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                      <input 
                        type={showNewPwd ? 'text' : 'password'}
                        value={newPassword} 
                        onChange={e => setNewPassword(e.target.value)}
                        style={{ ...pStyles.input, width: '100%', paddingRight: 40 }} 
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
                    <label style={pStyles.label}>Confirm New Password</label>
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                      <input 
                        type={showConfirmPwd ? 'text' : 'password'}
                        value={confirmNewPassword} 
                        onChange={e => setConfirmNewPassword(e.target.value)}
                        style={{ ...pStyles.input, width: '100%', paddingRight: 40 }} 
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
                style={{
                  padding: '12px 28px',
                  background: 'linear-gradient(135deg, #0D5E6B, #1A8FA0)',
                  color: '#fff', border: 'none', borderRadius: 10,
                  fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 8,
                  opacity: securitySaving ? 0.6 : 1,
                }}
              >
                <Lock size={16} /> {securitySaving ? 'Updating...' : 'Update Password'}
              </button>
            </div>

            {/* Connected Families — Premium UI */}
            <div style={{
              background: '#fff', borderRadius: 20, border: '1px solid #E5E7EB',
              overflow: 'hidden', boxShadow: '0 2px 16px rgba(13,94,107,0.06)',
            }}>
              {/* Section header */}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '18px 24px', borderBottom: '1px solid #F3F4F6',
                background: 'linear-gradient(135deg, #EEF6F8, #F8FAFB)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 38, height: 38, borderRadius: 12,
                    background: 'linear-gradient(135deg, #0D5E6B, #1A8FA0)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <CheckCircle size={18} color="#fff" />
                  </div>
                  <div>
                    <div style={{ fontFamily: 'Inter, sans-serif', fontWeight: 800, fontSize: '1rem', color: '#0D5E6B' }}>
                      Active Connections
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#6B7280' }}>
                      {learners.length} learner{learners.length !== 1 ? 's' : ''} in your care
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setShowConnectionModal(true)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '9px 16px', background: 'linear-gradient(135deg, #0D5E6B, #1A8FA0)',
                    color: '#fff', border: 'none', borderRadius: 10,
                    fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer',
                  }}
                >
                  <UserPlus size={14} /> New Connection
                </button>
              </div>

              {learners.length === 0 ? (
                <div style={{ padding: '40px 24px', textAlign: 'center' }}>
                  <div style={{ fontSize: '3rem', marginBottom: 12 }}><LinkIcon size={48} color="#0D5E6B" /></div>
                  <div style={{ fontWeight: 700, color: '#374151', marginBottom: 6, fontSize: '0.95rem' }}>
                    No learners connected
                  </div>
                  <p style={{ color: '#9CA3AF', fontSize: '0.85rem', maxWidth: 320, margin: '0 auto 20px' }}>
                    Ask the parent or learner to generate a connection code from their dashboard, then enter it here.
                  </p>
                  <button
                    onClick={() => setShowConnectionModal(true)}
                    style={{
                      padding: '11px 24px', background: 'linear-gradient(135deg, #0D5E6B, #1A8FA0)',
                      color: '#fff', border: 'none', borderRadius: 12, fontWeight: 700, cursor: 'pointer', fontSize: '0.9rem',
                    }}
                  >
                    <UserPlus size={15} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                    Connect a learner
                  </button>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14, padding: 20 }}>
                  {learners.map(l => {
                    const s = learnerStats[l.id] || {};
                    const acc = s.latestSession ? toPercent(s.latestSession.accuracy_score) : null;
                    const status = s.needsAttention ? 'attention' : (acc !== null && acc >= 70 ? 'on-track' : 'monitor');
                    return (
                      <div
                        key={l.id}
                        onClick={() => navigate(`/ot/learner/${l.id}`)}
                        style={{
                          padding: '16px', background: '#F9FAFB', borderRadius: 16,
                          border: '1.5px solid #E5E7EB', cursor: 'pointer',
                          transition: 'all 0.15s',
                        }}
                        onMouseEnter={e => {
                          e.currentTarget.style.borderColor = '#0D5E6B';
                          e.currentTarget.style.background = '#EEF6F8';
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.borderColor = '#E5E7EB';
                          e.currentTarget.style.background = '#F9FAFB';
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                          <div style={{
                            width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
                            background: l.avatar_color || 'linear-gradient(135deg, #E8841A, #F59E0B)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontWeight: 800, color: '#fff', fontSize: '0.9rem',
                            overflow: 'hidden'
                          }}>
                            {l.avatar_url ? (
                              <img src={l.avatar_url} alt="avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            ) : (
                              <User size={20} />
                            )}
                          </div>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#111827' }}>{l.name}</div>
                            <div style={{ fontSize: '0.72rem', color: '#9CA3AF' }}>Age {l.age}</div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: acc !== null && acc >= 70 ? '#10B981' : '#F59E0B' }}>
                            {acc !== null ? `${acc}% accuracy` : 'No sessions'}
                          </span>
                          <span className={`badge badge-${status === 'attention' ? 'danger' : status === 'on-track' ? 'success' : 'warning'}`}
                            style={{ fontSize: '0.65rem' }}>
                            {status === 'attention' ? (<span style={{display: "flex", alignItems: "center", gap: 4}}><AlertTriangle size={14} /> Needs Attention</span>) : status === 'on-track' ? (<span style={{display: "flex", alignItems: "center", gap: 4}}><CheckCircle size={14} /> OK</span>) : 'Monitor'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        ) : null}
        <BetaFooter variant="light" />
      </main>
    </div>
  );
}

// ── Learner Session Card with filters and pagination ──
function LearnerSessionCard({ learner: l, stats: s, onDeleteSession }) {
  const sessions = s.sessions || [];
  const [itemsPerPage, setItemsPerPage] = React.useState(5);
  const [curPage, setCurPage] = React.useState(1);
  const [diffFilter, setDiffFilter] = React.useState('all');
  const [dateRange, setDateRange] = React.useState('all');
  const [startDate, setStartDate] = React.useState('');
  const [endDate, setEndDate] = React.useState('');
  const [accFilter, setAccFilter] = React.useState('all');

  const filteredSessions = sessions.filter(sess => {
    if (diffFilter !== 'all' && sess.difficulty !== diffFilter) return false;
    
    /* Compared on the same scale as it is displayed; a row stored as 84 used
       to sail through a ">= 90%" filter because 84 > 0.9. */
    const acc = toPercent(sess.accuracy_score);
    if (accFilter === '70' && acc < 70) return false;
    if (accFilter === '90' && acc < 90) return false;
    
    if (dateRange === '7') {
      const limit = new Date(); limit.setDate(limit.getDate() - 7);
      if (new Date(sess.start_time) < limit) return false;
    } else if (dateRange === '30') {
      const limit = new Date(); limit.setDate(limit.getDate() - 30);
      if (new Date(sess.start_time) < limit) return false;
    } else if (dateRange === '90') {
      const limit = new Date(); limit.setDate(limit.getDate() - 90);
      if (new Date(sess.start_time) < limit) return false;
    } else if (dateRange === 'custom') {
      if (startDate && new Date(sess.start_time) < new Date(startDate)) return false;
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        if (new Date(sess.start_time) > end) return false;
      }
    }
    return true;
  });

  const totalPages = Math.ceil(filteredSessions.length / itemsPerPage);
  const activePage = Math.min(curPage, Math.max(1, totalPages));
  const paged = filteredSessions.slice((activePage - 1) * itemsPerPage, activePage * itemsPerPage);

  React.useEffect(() => {
    setCurPage(1);
  }, [diffFilter, dateRange, startDate, endDate, accFilter, itemsPerPage]);

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ padding: '18px 24px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, borderBottom: '1px solid #F3F4F6' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'linear-gradient(135deg,#0D5E6B,#1A8FA0)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '1rem', flexShrink: 0 }}>{l.name[0]}</div>
          <div>
            <div style={{ fontFamily: 'Inter, sans-serif', fontWeight: 700, color: '#0D3D47' }}>{l.name}</div>
            <div style={{ fontSize: '0.75rem', color: '#9CA3AF' }}>Showing {filteredSessions.length} session{filteredSessions.length !== 1 ? 's' : ''} (from {sessions.length} total)</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#6B7280' }}>Sessions per page:</span>
          <select 
            value={itemsPerPage} 
            onChange={e => setItemsPerPage(parseInt(e.target.value, 10))}
            style={{ padding: '4px 6px', borderRadius: 6, border: '1px solid #D1D5DB', fontSize: '0.75rem', outline: 'none' }}
          >
            <option value={5}>5</option>
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
          </select>
          <span style={{ fontSize: '0.75rem', color: '#9CA3AF' }}>Page {activePage} of {totalPages || 1}</span>
          {sessions.length > 0 && (
            <button
              onClick={async () => {
                try {
                  const res = await api.get(`/reports/${sessions[0].id}/pdf`, { responseType: 'blob' });
                  const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
                  const a = document.createElement('a'); a.href = url;
                  a.download = `NestureAI_${l.name.replace(' ', '_')}_Latest.pdf`;
                  document.body.appendChild(a); a.click(); document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                  toast.success('Downloaded!');
                } catch { toast.error('Error generating report'); }
              }}
              className="btn btn-secondary btn-sm"
              style={{ padding: '4px 8px', fontSize: '0.75rem' }}
            >
              <Download size={13} /> Latest PDF
            </button>
          )}
        </div>
      </div>

      {/* Dynamic Filters Bar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, padding: '12px 24px', background: '#F9FAFB', borderBottom: '1px solid #F3F4F6', alignItems: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: '0.62rem', fontWeight: 800, color: '#4B5563', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Date Range</label>
          <select 
            value={dateRange} 
            onChange={e => setDateRange(e.target.value)}
            style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: '0.75rem', outline: 'none', background: '#fff' }}
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
              <label style={{ fontSize: '0.62rem', fontWeight: 800, color: '#4B5563', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Start Date</label>
              <input 
                type="date" 
                value={startDate} 
                onChange={e => setStartDate(e.target.value)}
                style={{ padding: '4px 6px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: '0.75rem', outline: 'none' }} 
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: '0.62rem', fontWeight: 800, color: '#4B5563', textTransform: 'uppercase', letterSpacing: '0.05em' }}>End Date</label>
              <input 
                type="date" 
                value={endDate} 
                onChange={e => setEndDate(e.target.value)}
                style={{ padding: '4px 6px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: '0.75rem', outline: 'none' }} 
              />
            </div>
          </>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: '0.62rem', fontWeight: 800, color: '#4B5563', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Difficulty</label>
          <select 
            value={diffFilter} 
            onChange={e => setDiffFilter(e.target.value)}
            style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: '0.75rem', outline: 'none', background: '#fff' }}
          >
            <option value="all">All Difficulties</option>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: '0.62rem', fontWeight: 800, color: '#4B5563', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Minimum Success Rate</label>
          <select 
            value={accFilter} 
            onChange={e => setAccFilter(e.target.value)}
            style={{ padding: '4px 8px', borderRadius: 8, border: '1px solid #D1D5DB', fontSize: '0.75rem', outline: 'none', background: '#fff' }}
          >
            <option value="all">All Activities</option>
            <option value="70">70% Success or above</option>
            <option value="90">90% Success or above</option>
          </select>
        </div>
      </div>

      {sessions.length === 0 ? (
        <div style={{ padding: '20px 24px', color: '#9CA3AF', fontSize: '0.85rem', fontStyle: 'italic' }}>No activity</div>
      ) : filteredSessions.length > 0 ? (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr><th>#</th><th>Date</th><th>Duration</th>
                  <th title="Composite occupational-therapy score, comparable across every game">OT Score</th>
                  <th title="Average time to respond during the session">Avg Response</th>
                  <th>LPI</th><th>Report</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {paged.map((sess, i) => (
                  <tr key={sess.id}>
                    <td data-label="Resource Index">{filteredSessions.length - ((activePage-1)*itemsPerPage + i)}</td>
                    <td data-label="Date">{sess.start_time?.slice(0, 10)}</td>
                    <td data-label="Duration">{(() => {
                      /* Sessions under a minute all rendered as "0 min". */
                      const sec = parseInt(sess.duration_seconds || 0, 10);
                      return sec < 60 ? `${sec}s` : `${Math.round(sec / 60)} min`;
                    })()}</td>
                    <td data-label="OT Score">{(() => {
                      const pct = toPercent(sess.accuracy_score);
                      const color = pct >= 80 ? '#10B981' : pct >= 60 ? '#F59E0B' : '#EF4444';
                      return <span style={{ fontWeight: 700, color }}>{pct}%</span>;
                    })()}</td>
                    <td data-label="Avg Response">{(() => {
                      const ms = parseFloat(sess.avg_response_time_ms || 0);
                      return ms > 0 ? `${(ms / 1000).toFixed(1)}s` : '—';
                    })()}</td>
                    <td data-label="LPI" style={{ fontWeight: 700, color: '#0D5E6B' }}>{(() => {
                      const lpi = parseInt(sess.lpi_score || 0, 10);
                      return lpi > 0 ? lpi : '—';
                    })()}</td>
                    <td data-label="Report">
                      <button
                        onClick={async () => {
                          try {
                            const res = await api.get(`/reports/${sess.id}/pdf`, { responseType: 'blob' });
                            const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
                            const a = document.createElement('a'); a.href = url;
                            a.download = `NestureAI_${l.name.replace(' ', '_')}_${sess.start_time?.slice(0,10)}.pdf`;
                            document.body.appendChild(a); a.click(); document.body.removeChild(a);
                            URL.revokeObjectURL(url);
                            toast.success('Downloaded!');
                          } catch { toast.error('Error'); }
                        }}
                        style={{ background: '#EEF6F8', color: '#0D5E6B', border: '1px solid #B2DFE6', borderRadius: 7, padding: '4px 10px', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer' }}
                      >
                        <Download size={14} /> PDF
                      </button>
                    </td>
                    <td data-label="Actions">
                      <button
                        onClick={() => onDeleteSession(sess.id)}
                        style={{ padding: '4px 8px', background: '#FEE2E2', color: '#991B1B', border: '1px solid #FECACA', borderRadius: 7, cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}
                        title="Delete"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div style={styles.pagination}>
              <button disabled={activePage<=1} onClick={()=>setCurPage(Math.max(1,activePage-1))} style={{...styles.pageBtn, opacity:activePage<=1?0.4:1}}><ChevronLeft size={14}/> Prev</button>
              <div style={{display:'flex',gap:4}}>
                {Array.from({length:totalPages},(_,i)=>(
                  <button key={i} onClick={()=>setCurPage(i+1)} style={{...styles.pageDot,...(activePage===i+1?styles.pageDotActive:{})}}>{i+1}</button>
                ))}
              </div>
              <button disabled={activePage>=totalPages} onClick={()=>setCurPage(Math.min(totalPages,activePage+1))} style={{...styles.pageBtn, opacity:activePage>=totalPages?0.4:1}}>Next <ChevronRight size={14}/></button>
            </div>
          )}
        </>
      ) : (
        <div style={{ padding: '20px 24px', color: '#9CA3AF', fontSize: '0.85rem' }}>No sessions found matching selected filters.</div>
      )}
    </div>
  );
}

const styles = {
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28,
  },
  pageTitle: { fontFamily: 'Inter, sans-serif', fontSize: '1.8rem', fontWeight: 800, color: '#0D5E6B' },
  pageSub: { fontSize: '0.875rem', color: '#9CA3AF', marginTop: 4 },
  alertBanner: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '10px 16px', background: '#FEF3E2',
    borderRadius: 10, border: '1px solid #FCD34D',
  },
  comingSoon: {
    background: '#fff', borderRadius: 24, padding: 60,
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    textAlign: 'center', marginTop: 20, border: '1px solid #F3F4F6'
  },
  csIcon: { fontSize: '4rem', marginBottom: 16 },
  csTitle: { fontFamily: 'Inter, sans-serif', fontSize: '1.8rem', fontWeight: 800, color: '#0D5E6B', marginBottom: 8 },
  csText: { color: '#6B7280', fontSize: '1rem', maxWidth: 400 },
  kpiRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16, marginBottom: 20 },
  kpiCard: { padding: '20px 18px' },
  kpiVal: { fontFamily: 'Inter, sans-serif', fontWeight: 800, fontSize: '2rem' },
  kpiLbl: { fontSize: '0.78rem', color: '#6B7280', marginTop: 2, fontWeight: 500 },
  twoCol: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 20 },
  learnerRow: {
    display: 'flex', alignItems: 'center', gap: 14,
    padding: '14px 24px', cursor: 'pointer',
    borderBottom: '1px solid #F3F4F6', transition: 'background 0.12s',
  },
  learnerAvatar: {
    width: 40, height: 40, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: 'Inter, sans-serif', fontWeight: 800, fontSize: '1rem', color: '#fff',
    flexShrink: 0,
  },
  learnerName: { fontWeight: 600, fontSize: '0.9rem', color: '#1F2937' },
  learnerInfo: { fontSize: '0.75rem', color: '#9CA3AF', marginTop: 1 },
  learnerMeta: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 },
  reflexSummaryTitle: {
    fontSize: '0.75rem', fontWeight: 600, color: '#374151',
    textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10,
  },
  reflexFlag: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 },
  reflexFlagName: { fontSize: '0.8rem', color: '#6B7280', width: 90, flexShrink: 0 },
  flagBar: { flex: 1, height: 6, background: '#F3F4F6', borderRadius: 3, overflow: 'hidden' },
  flagBarFill: { height: '100%', borderRadius: 3, transition: 'width 0.4s ease' },
  alertCard: {
    display: 'flex', alignItems: 'center', gap: 14,
    padding: '16px 20px',
    border: '1px solid #FCD34D',
    background: '#FFFBEB',
    marginTop: 12,
  },
  viewBtn: {
    padding: '7px 16px', background: '#0D5E6B', color: '#fff',
    border: 'none', borderRadius: 8,
    fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  assignChip: {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '3px 10px', background: '#C8E8ED', color: '#0D5E6B',
    borderRadius: 20, fontSize: '0.72rem', fontWeight: 600,
  },
  chipRemove: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 16, height: 16, borderRadius: '50%',
    background: 'rgba(13,94,107,0.15)', border: 'none',
    color: '#0D5E6B', cursor: 'pointer', padding: 0,
    transition: 'background 0.15s',
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

const pStyles = {
  label: {
    display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#374151',
    marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em',
  },
  input: {
    width: '100%', padding: '10px 14px', borderRadius: 10,
    border: '1.5px solid #E5E7EB', fontSize: '0.9rem', outline: 'none',
    fontFamily: 'Inter, sans-serif', boxSizing: 'border-box',
    transition: 'border-color 0.2s',
  },
};
