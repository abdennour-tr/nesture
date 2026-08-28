import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Shield, FileSpreadsheet, Users, BookOpen, LogOut, Menu, X,
  Search, ChevronLeft, ChevronRight, Download, Trash2, Plus,
  UserPlus, Star, MapPin, Globe, Clock, Play, Headphones, BookOpenText, AlertTriangle,
  Edit, Key, Eye, ScrollText, Video, Edit3, Send, Gift
} from 'lucide-react';
import api from '../services/api';
import toast from 'react-hot-toast';
import ExcelJS from 'exceljs';
import { supabase } from '../services/supabaseClient';
import { useAuthStore } from '../store';
import VideoModal from '../components/shared/VideoModal';
import '../styles/AdminDashboard.css';

// ── Admin credentials (prototype-level) ──────────────────────────────────────
const ADMIN_EMAIL    = 'nesture.admin.secure.2026@gmail.com';
const ADMIN_PASSWORD = 'NestureAdmin2026!Secure';

// ── Tags for NestureLearn ───────────────────────────────────────────────────
const AVAILABLE_TAGS = [
  'sensory', 'reflex', 'communication', 'daily_living',
  'academic', 'behavioral', 'developmental', 'functional_wellness',
];

const TYPE_ICONS = { video: Play, podcast: Headphones, article: BookOpenText };

const DEFAULT_AVATAR = "data:image/svg+xml,%3Csvg viewBox='0 0 1024 1024' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='%23e2e8f0' d='M512 0C229.23 0 0 229.23 0 512s229.23 512 512 512 512-229.23 512-512S794.77 0 512 0z'/%3E%3Cpath fill='%2394a3b8' d='M512 256c-88.37 0-160 71.63-160 160 0 88.37 71.63 160 160 160s160-71.63 160-160c0-88.37-71.63-160-160-160zm0 384c-176.73 0-320 89.54-320 200v32c0 17.67 14.33 32 32 32h576c17.67 0 32-14.33 32-32v-32c0-110.46-143.27-200-320-200z'/%3E%3C/svg%3E";

// ═══════════════════════════════════════════════════════════════════════════════
export default function AdminDashboard() {
  const navigate = useNavigate();

  // ── Auth ──────────────────────────────────────────────────────────────────
  const [isAdmin, setIsAdmin]     = useState(() => sessionStorage.getItem('nesture-admin') === 'true');
  const [loginEmail, setLoginEmail]       = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError]       = useState('');

  // ── Navigation ───────────────────────────────────────────────────────────
  const [activeTab, setActiveTab]         = useState('sessions');
  const [sidebarOpen, setSidebarOpen]     = useState(false);

  // ── Sessions tab ─────────────────────────────────────────────────────────
  const [parents, setParents]             = useState([]);
  const [parentSearch, setParentSearch]   = useState('');
  const [selectedParent, setSelectedParent] = useState(null);
  const [children, setChildren]           = useState([]);
  const [selectedChild, setSelectedChild] = useState(null);
  const [sessions, setSessions]           = useState([]);
  const [sessionsPage, setSessionsPage]   = useState(1);
  const [loadingSessions, setLoadingSessions] = useState(false);

  // ── Specialists tab ──────────────────────────────────────────────────────
  const { profile: adminProfile, impersonate, user, originalProfile } = useAuthStore();
  const adminId = adminProfile?.id || user?.id || 'admin-id';

  useEffect(() => {
    if (user && adminProfile && adminProfile.role !== 'admin' && !originalProfile) {
      toast.error('Access Denied. Admins only.');
      navigate('/');
    }
  }, [user, adminProfile, originalProfile, navigate]);

  const [specialists, setSpecialists]     = useState([]);
  const [showSpecForm, setShowSpecForm]   = useState(false);
  const [specForm, setSpecForm]           = useState({
    email: '', first_name: '', last_name: '',
    specialty: '', location: '', bio: '', avatar_url: '', is_featured: false,
  });
  const [specAvatarFile, setSpecAvatarFile] = useState(null);
  const [specSaving, setSpecSaving]       = useState(false);

  // Specialist search, filtering, and modal states
  const [specSearch, setSpecSearch] = useState('');
  const [specFilterStatus, setSpecFilterStatus] = useState('all'); // 'all', 'active', 'deactivated'
  const [selectedSpecialist, setSelectedSpecialist] = useState(null);
  const [editingSpecialist, setEditingSpecialist] = useState(null);
  const [showAuditLogs, setShowAuditLogs] = useState(false);
  const [auditLogs, setAuditLogs] = useState([]);
  const [loadingAuditLogs, setLoadingAuditLogs] = useState(false);

  // ── Resources tab ────────────────────────────────────────────────────────
  const [resources, setResources]         = useState([]);
  const [showResForm, setShowResForm]     = useState(false);
  const [resForm, setResForm]             = useState({
    title: '', description: '', type: 'video', url: '',
    duration: '', tags: [], featured: false,
  });
  const [thumbnailFile, setThumbnailFile] = useState(null);
  const [resSaving, setResSaving]         = useState(false);

  // ── Exercises tab ─────────────────────────────────────────────────────────
  const [exercises, setExercises] = useState([]);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [editingExerciseId, setEditingExerciseId] = useState(null);
  const [uploadForm, setUploadForm] = useState({ name: '', target_reflex: '', description: '', duration_minutes: '', difficulty_level: 'medium', video_url: '' });
  const [uploadFile, setUploadFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [activeVideo, setActiveVideo] = useState(null);

  // ── Feature flags states ──────────────────────────────────────────────────
  const [featureFlags, setFeatureFlags] = useState({});
  const [loadingFlags, setLoadingFlags] = useState(false);

  // ── Confirm dialog ───────────────────────────────────────────────────────
  const [confirmDialog, setConfirmDialog] = useState(null);

  // ── Login handler ────────────────────────────────────────────────────────
  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      // 1. Attempt to sign in to Supabase Auth
      const { data, error } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password: loginPassword,
      });

      if (error) {
        throw error;
      }

      // 2. Validate email and role (if sign in succeeded, user email should match ADMIN_EMAIL)
      if (data.user?.email === ADMIN_EMAIL) {
        sessionStorage.setItem('nesture-admin', 'true');
        setIsAdmin(true);
        setLoginError('');
        
        // Retrieve and sync with useAuthStore
        const { data: profile } = await supabase
          .from('users')
          .select('*')
          .eq('id', data.user.id)
          .single();
        
        useAuthStore.getState().setAuth({ 
          user: data.user, 
          profile: profile || { id: data.user.id, role: 'admin', email: ADMIN_EMAIL, first_name: 'Admin', last_name: 'User' } 
        });

        toast.success('Admin signed in successfully');
      } else {
        // Prevent non-admin users from accessing the admin dashboard
        await supabase.auth.signOut();
        setLoginError('Accès refusé. Cet email n\'est pas un administrateur.');
      }
    } catch (err) {
      console.error('Admin Supabase Auth Sign In failed:', err);
      // Fallback for prototype testing if database/internet/auth user is missing
      if (loginEmail === ADMIN_EMAIL && loginPassword === ADMIN_PASSWORD) {
        sessionStorage.setItem('nesture-admin', 'true');
        setIsAdmin(true);
        setLoginError('');
        
        // Set fallback admin auth state
        useAuthStore.getState().setAuth({
          user: { id: 'admin-id', email: ADMIN_EMAIL },
          profile: { id: 'admin-id', role: 'admin', email: ADMIN_EMAIL, first_name: 'Admin', last_name: 'Local' }
        });
        
        toast.error('Warning: Signed in as local admin only (Supabase Auth failed)');
      } else {
        setLoginError('Invalid credentials. Please try again.');
      }
    }
  };

  const handleLogout = async () => {
    sessionStorage.removeItem('nesture-admin');
    try {
      await useAuthStore.getState().logout();
    } catch (e) {
      console.warn('Logout error:', e);
    }
    setIsAdmin(false);
    navigate('/login');
  };

  // ── Data fetching ────────────────────────────────────────────────────────
  const fetchParents = useCallback(async () => {
    try {
      const res = await api.get('/admin/parents');
      setParents(res.data || []);
    } catch { toast.error('Failed to load parents'); }
  }, []);

  const fetchChildren = useCallback(async (parentId) => {
    try {
      const res = await api.get(`/learners/by-parent/${parentId}`);
      setChildren(res.data || []);
    } catch { toast.error('Failed to load children'); }
  }, []);

  const fetchSessions = useCallback(async (learnerId) => {
    setLoadingSessions(true);
    try {
      const res = await api.get(`/sessions/learner/${learnerId}?limit=500`);
      setSessions(res.data || []);
    } catch { toast.error('Failed to load sessions'); }
    finally { setLoadingSessions(false); }
  }, []);

  const fetchSpecialists = useCallback(async () => {
    try {
      const res = await api.get('/admin/specialists');
      setSpecialists(res.data || []);
    } catch { toast.error('Failed to load specialists'); }
  }, []);

  const fetchResources = useCallback(async () => {
    try {
      const res = await api.get('/admin/learn-content');
      setResources(res.data || []);
    } catch { toast.error('Failed to load resources'); }
  }, []);

  const fetchExercises = useCallback(async () => {
    try {
      const res = await api.get('/exercises/');
      setExercises(res.data || []);
    } catch { toast.error('Failed to load exercises'); }
  }, []);

  const fetchFeatureFlags = useCallback(async () => {
    setLoadingFlags(true);
    try {
      const { data, error } = await supabase
        .from('user_feature_flags')
        .select('*');
      if (error) throw error;
      
      const flagsMap = {};
      data?.forEach(flag => {
        flagsMap[flag.user_id] = flag;
      });
      setFeatureFlags(flagsMap);
    } catch (err) {
      toast.error('Failed to load feature flags');
      console.error(err);
    } finally {
      setLoadingFlags(false);
    }
  }, []);

  const handleToggleFlag = async (userId, currentState) => {
    const nextState = !currentState;
    try {
      const adminId = useAuthStore.getState().user?.id || 'admin-id';
      const payload = {
        user_id: userId,
        feature_name: 'agentic_ai_upload',
        enabled: nextState,
        enabled_by: nextState ? adminId : null,
        enabled_at: nextState ? new Date().toISOString() : null,
      };

      const { error } = await supabase
        .from('user_feature_flags')
        .upsert(payload, { onConflict: 'user_id,feature_name' });

      if (error) throw error;

      // Update local state
      setFeatureFlags(prev => ({
        ...prev,
        [userId]: {
          ...prev[userId],
          enabled: nextState,
          enabled_by: nextState ? adminId : null,
          enabled_at: nextState ? payload.enabled_at : null,
        }
      }));

      toast.success(`Feature flag ${nextState ? 'enabled' : 'disabled'} successfully!`);
    } catch (err) {
      toast.error('Failed to update feature flag: ' + err.message);
      console.error(err);
    }
  };

  // ── Load data on tab change ──────────────────────────────────────────────
  useEffect(() => {
    if (!isAdmin) return;
    if (activeTab === 'sessions')     fetchParents();
    if (activeTab === 'specialists')  fetchSpecialists();
    if (activeTab === 'resources')    fetchResources();
    if (activeTab === 'exercises')    fetchExercises();
    if (activeTab === 'flags') {
      fetchParents();
      fetchFeatureFlags();
    }
  }, [isAdmin, activeTab, fetchParents, fetchSpecialists, fetchResources, fetchFeatureFlags, fetchExercises]);

  // ── Parent selection ─────────────────────────────────────────────────────
  const selectParent = (parent) => {
    setSelectedParent(parent);
    setSelectedChild(null);
    setSessions([]);
    setSessionsPage(1);
    fetchChildren(parent.id);
  };

  const selectChild = (child) => {
    setSelectedChild(child);
    setSessions([]);
    setSessionsPage(1);
    fetchSessions(child.id);
  };

  const resetSessionFlow = () => {
    setSelectedParent(null);
    setSelectedChild(null);
    setSessions([]);
    setChildren([]);
    setSessionsPage(1);
  };

  // ── Excel export ───────────────────────────────────────────────────────────
  const exportExcel = async (singleSession = null) => {
    const sessionsToExport = singleSession ? [singleSession] : sessions;
    if (sessionsToExport.length === 0) return;

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Sessions Export');

    // 1. Title
    sheet.mergeCells('A1:C1');
    const titleCell = sheet.getCell('A1');
    titleCell.value = 'NestureAI Session Export';
    titleCell.font = { name: 'Arial', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
    sheet.getRow(1).height = 30;

    // 2. Metadata properties
    const metadata = [
      ['Generated On', new Date().toLocaleString()],
      ['Learner Name', `${selectedChild?.first_name || ''} ${selectedChild?.last_name || ''}`.trim()],
      ['Learner Age', selectedChild?.age || 'N/A'],
      ['Diagnosis', selectedChild?.diagnosis || 'N/A'],
      ['Parent/Guardian', selectedParent?.name || 'N/A']
    ];

    let rowCursor = 3;
    metadata.forEach(([label, val]) => {
      sheet.getCell(`A${rowCursor}`).value = label;
      sheet.getCell(`A${rowCursor}`).font = { bold: true, color: { argb: 'FF334155' } };
      sheet.getCell(`A${rowCursor}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      sheet.getCell(`A${rowCursor}`).border = { bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } } };

      sheet.getCell(`B${rowCursor}`).value = val;
      sheet.getCell(`B${rowCursor}`).font = { color: { argb: 'FF0F172A' } };
      sheet.getCell(`B${rowCursor}`).border = { bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } } };
      
      rowCursor++;
    });

    rowCursor += 2; // skip a row

    // 3. Table Headers
    const headers = ['Date', 'Duration (s)', 'Accuracy', 'Difficulty', 'LPI Score', 'Perfect Grabs', 'Failed Grabs', 'Avg Response (ms)', 'Smoothness', 'Fatigue'];
    const headerRow = sheet.getRow(rowCursor);
    headers.forEach((header, index) => {
      const cell = headerRow.getCell(index + 1);
      cell.value = header;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3B82F6' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF2563EB' } },
        bottom: { style: 'thin', color: { argb: 'FF2563EB' } }
      };
    });
    headerRow.height = 25;
    rowCursor++;

    // 4. Session Data
    sessionsToExport.forEach((s) => {
      const row = sheet.getRow(rowCursor);
      row.getCell(1).value = s.start_time?.slice(0, 19).replace('T', ' ') || '';
      row.getCell(2).value = s.duration_seconds || 0;
      row.getCell(3).value = s.accuracy_score !== undefined ? `${s.accuracy_score}%` : '0%';
      row.getCell(4).value = s.difficulty || '';
      row.getCell(5).value = s.lpi_score || 0;
      row.getCell(6).value = s.perfect_grabs || 0;
      row.getCell(7).value = s.failed_grabs || 0;
      row.getCell(8).value = s.avg_response_time_ms || 0;
      row.getCell(9).value = s.trajectory_smoothness ? Number(s.trajectory_smoothness).toFixed(2) : 0;
      row.getCell(10).value = s.fatigue_index ? Number(s.fatigue_index).toFixed(2) : 0;
      
      row.eachCell((cell) => {
        cell.alignment = { horizontal: 'center' };
        cell.border = { bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } } };
      });
      rowCursor++;
    });

    // 5. Column widths adjustment
    sheet.columns = [
      { width: 22 }, { width: 15 }, { width: 12 }, { width: 15 }, { width: 12 },
      { width: 15 }, { width: 15 }, { width: 20 }, { width: 15 }, { width: 15 }
    ];

    // 6. Raw Hand Tracking Data Sheet — always create the tab
    const trackSheet = workbook.addWorksheet('Hand Positions');
    trackSheet.columns = [
      { header: 'Session ID', key: 'session', width: 38 },
      { header: 'Recorded At', key: 'date', width: 22 },
      { header: 'Point Index', key: 'idx', width: 12 },
      { header: 'X (Normalized)', key: 'x', width: 18 },
      { header: 'Y (Normalized)', key: 'y', width: 18 },
      { header: 'Timestamp (ms)', key: 'ts', width: 18 }
    ];
    trackSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    trackSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8B5CF6' } };
    trackSheet.getRow(1).alignment = { horizontal: 'center' };

    try {
      toast.loading('Fetching hand tracking data...', { id: 'export-toast' });
      let query = supabase
        .from('raw_hand_tracking')
        .select('session_id, positions, created_at')
        .eq('child_id', selectedChild.id);
        
      if (singleSession) {
        query = query.eq('session_id', singleSession.id);
      }
      
      const { data: trackingData, error } = await query;

      if (error) {
        console.error('Hand tracking query error:', error);
        toast.dismiss('export-toast');
        toast.error('Could not fetch hand tracking data.');
        const errRow = trackSheet.addRow({ session: `Error: ${error.message || 'Failed to fetch tracking data'}` });
        errRow.getCell(1).font = { italic: true, color: { argb: 'FFEF4444' } };
      } else if (!trackingData || trackingData.length === 0) {
        toast.dismiss('export-toast');
        const emptyRow = trackSheet.addRow({ session: 'No hand tracking data recorded for this learner.' });
        emptyRow.getCell(1).font = { italic: true, color: { argb: 'FF94A3B8' } };
      } else {
        trackingData.forEach(track => {
          if (Array.isArray(track.positions)) {
            track.positions.forEach((p, i) => {
              const r = trackSheet.addRow({
                session: track.session_id,
                date: new Date(track.created_at).toLocaleString(),
                idx: i + 1,
                x: p.x !== undefined ? Number(p.x).toFixed(4) : '',
                y: p.y !== undefined ? Number(p.y).toFixed(4) : '',
                ts: p.timestamp || ''
              });
              r.alignment = { horizontal: 'center' };
            });
          }
        });
        toast.dismiss('export-toast');
      }
    } catch (e) {
      toast.dismiss('export-toast');
      console.error('Failed to fetch raw tracking for Excel', e);
      toast.error('Hand tracking fetch failed.');
      const errRow = trackSheet.addRow({ session: `Error: ${e.message || 'Unexpected error'}` });
      errRow.getCell(1).font = { italic: true, color: { argb: 'FFEF4444' } };
    }

    // Export to Blob
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    const childName = `${selectedChild?.first_name || 'child'}_${selectedChild?.last_name || ''}`.trim();
    const fileNameSuffix = singleSession ? `SingleSession_${singleSession.id.slice(0,6)}` : 'AllSessions';
    a.href = url;
    a.download = `NestureAI_Session_Export_${childName}_${fileNameSuffix}_${new Date().toISOString().slice(0,10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    toast.success('Professional Excel exported successfully!');
  };

  // ── Specialist CRUD ──────────────────────────────────────────────────────
  const handleSpecSubmit = async (e) => {
    e.preventDefault();
    if (!specForm.email || !specForm.first_name) {
      toast.error('Email and first name are required');
      return;
    }
    setSpecSaving(true);
    try {
      let finalAvatarUrl = null;
      if (specAvatarFile) {
        toast.success('Uploading avatar...');
        const uploadRes = await api.post('/admin/upload-thumbnail', { file: specAvatarFile });
        finalAvatarUrl = uploadRes.data;
      }

      await api.post('/admin/specialists', { ...specForm, avatar_url: finalAvatarUrl });
      toast.success('Specialist invited successfully!');
      setSpecForm({ email: '', first_name: '', last_name: '', specialty: '', location: '', bio: '', is_featured: false });
      setSpecAvatarFile(null);
      setShowSpecForm(false);
      fetchSpecialists();
    } catch (err) {
      toast.error(err?.response?.data?.detail || err.message || 'Failed to add specialist');
    } finally { setSpecSaving(false); }
  };

  const confirmDeleteSpec = (spec) => {
    setConfirmDialog({
      title: 'Delete Specialist',
      text: `Are you sure you want to delete ${spec.name || spec.first_name}? This action cannot be undone.`,
      onConfirm: async () => {
        try {
          await api.delete(`/admin/specialists/${spec.id}`);
          toast.success('Specialist deleted');
          fetchSpecialists();
        } catch { toast.error('Failed to delete specialist'); }
        setConfirmDialog(null);
      },
    });
  };

  const handleToggleStatus = async (specialist) => {
    const newStatus = !specialist.is_active;
    try {
      await api.post(`/admin/specialists/${specialist.id}/status`, {
        isActive: newStatus,
        adminId: adminId
      });
      toast.success(`Specialist ${newStatus ? 'reactivated' : 'deactivated'} successfully`);
      fetchSpecialists();
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Failed to toggle status');
    }
  };

  const handleResendInvitation = async (specialist) => {
    setConfirmDialog({
      title: 'Resend Invitation',
      text: `Are you sure you want to resend the invitation to ${specialist.first_name || ''} ${specialist.last_name || ''}? This will extend the expiry by 15 days.`,
      confirmLabel: 'Resend',
      type: 'primary',
      onConfirm: async () => {
        const tId = toast.loading(`Sending invitation to ${specialist.email}...`);
        try {
          await api.post(`/admin/specialists/${specialist.id}/resend-invitation`, { adminId });
          toast.success(`Invitation sent to ${specialist.email}`, { id: tId });
          fetchSpecialists();
          fetchAuditLogs();
        } catch (err) {
          toast.error(err?.response?.data?.detail || err?.message || 'Failed to send invitation', { id: tId });
        }
        setConfirmDialog(null);
      }
    });
  };

  const handleResetPassword = async (specialist) => {
    setConfirmDialog({
      title: '🔐 Reset Specialist Password',
      text: `Send password reset email to ${specialist.first_name || ''} ${specialist.last_name || ''} (${specialist.email})?\n\nAs an administrator, you cannot view plain text passwords, but clicking confirm will send an official password reset link directly to their email address.`,
      confirmLabel: 'Send Reset Link',
      type: 'primary',
      onConfirm: async () => {
        const tId = toast.loading(`Sending password reset link to ${specialist.email}...`);
        try {
          await api.post(`/admin/specialists/${specialist.id}/reset-password`, {
            adminId: adminId
          });
          toast.success(`Password reset email sent to ${specialist.email}`, { id: tId });
          fetchAuditLogs();
        } catch (err) {
          toast.error(err?.response?.data?.detail || err?.message || 'Failed to send password reset email', { id: tId });
        }
        setConfirmDialog(null);
      }
    });
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    if (!editingSpecialist.first_name) {
      toast.error('First name is required');
      return;
    }
    try {
      await api.put(`/admin/specialists/${editingSpecialist.id}`, {
        updates: {
          first_name: editingSpecialist.first_name,
          last_name: editingSpecialist.last_name,
          specialty: editingSpecialist.specialty,
          location: editingSpecialist.location,
          bio: editingSpecialist.bio,
          is_featured: editingSpecialist.is_featured
        },
        adminId: adminId
      });
      toast.success('Specialist updated successfully');
      setEditingSpecialist(null);
      fetchSpecialists();
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Failed to update specialist');
    }
  };

  const handleImpersonateUser = async (userProfile, role) => {
    if (userProfile.is_active === false) {
      toast.error('Cannot impersonate a deactivated user');
      return;
    }
    try {
      const targetName = userProfile.name || `${userProfile.first_name || ''} ${userProfile.last_name || ''}`.trim() || 'User';
      
      // Log impersonation action
      await api.post('/admin/audit-logs', {
        adminId: adminId,
        action: 'impersonate',
        targetUserId: userProfile.id,
        details: `Impersonated user: ${targetName} (Role: ${role}, Email: ${userProfile.email || 'N/A'})`
      });

      const profileToImpersonate = {
        ...userProfile,
        role: role
      };

      impersonate(profileToImpersonate);
      toast.success(`Impersonating ${targetName}`);
      
      const route = role === 'practitioner' ? '/ot' : '/parent';
      navigate(route);
    } catch (err) {
      console.error('Failed to impersonate:', err);
      toast.error('Impersonation failed');
    }
  };

  const fetchAuditLogs = async () => {
    setLoadingAuditLogs(true);
    try {
      const res = await api.get('/admin/audit-logs');
      setAuditLogs(res.data || []);
    } catch {
      toast.error('Failed to load audit logs');
    } finally {
      setLoadingAuditLogs(false);
    }
  };

  useEffect(() => {
    if (showAuditLogs) {
      fetchAuditLogs();
    }
  }, [showAuditLogs]);

  // ── Resource CRUD ────────────────────────────────────────────────────────
  const handleResSubmit = async (e) => {
    e.preventDefault();
    if (!resForm.title || !resForm.url || !resForm.type) {
      toast.error('Title, URL, and type are required');
      return;
    }
    setResSaving(true);
    try {
      let finalThumbnailUrl = null;
      if (thumbnailFile) {
        toast.success('Uploading image...');
        const uploadRes = await api.post('/admin/upload-thumbnail', { file: thumbnailFile });
        finalThumbnailUrl = uploadRes.data;
      }

      await api.post('/admin/learn-content', { ...resForm, thumbnail_url: finalThumbnailUrl });
      toast.success('Resource added successfully!');
      setResForm({ title: '', description: '', type: 'video', url: '', duration: '', tags: [], featured: false });
      setThumbnailFile(null);
      setShowResForm(false);
      fetchResources();
    } catch (err) {
      toast.error(err?.response?.data?.detail || err.message || 'Failed to add resource');
    } finally { setResSaving(false); }
  };

  const confirmDeleteRes = (res) => {
    setConfirmDialog({
      title: 'Delete Resource',
      text: `Are you sure you want to delete "${res.title}"? This action cannot be undone.`,
      onConfirm: async () => {
        try {
          await api.delete(`/admin/learn-content/${res.id}`);
          toast.success('Resource deleted');
          fetchResources();
        } catch { toast.error('Failed to delete resource'); }
        setConfirmDialog(null);
      },
    });
  };

  // ── Exercise Handlers ────────────────────────────────────────────────────
  const handleUploadExercise = async (e) => {
    e.preventDefault();
    if (uploading) return;
    setUploading(true);
    try {
      let finalUrl = uploadForm.video_url;
      if (uploadFile) {
        const formData = new FormData();
        formData.append('file', uploadFile);
        const res = await api.post('/exercises/upload-video', formData);
        finalUrl = res.data; // Fix: res.data is the URL string, not an object
      }
      
      if (editingExerciseId) {
        await api.put(`/exercises/${editingExerciseId}`, { ...uploadForm, video_url: finalUrl });
        toast.success('Exercise updated successfully!');
      } else {
        await api.post('/exercises', { ...uploadForm, video_url: finalUrl });
        toast.success('Exercise uploaded successfully!');
      }
      setShowUploadModal(false);
      setEditingExerciseId(null);
      setUploadForm({ name: '', target_reflex: '', description: '', duration_minutes: '', difficulty_level: 'medium', video_url: '' });
      setUploadFile(null);
      fetchExercises();
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
      fetchExercises();
    } catch (err) {
      console.error(err);
      toast.error('Failed to delete exercise');
    }
  };

  // ── Parent & Child Deletion ──────────────────────────────────────────────
  const handleGrantFreeAccess = async (e, parent) => {
    e.stopPropagation();
    setConfirmDialog({
      title: 'Grant Free Access',
      text: `Are you sure you want to grant a 1-year complimentary Family subscription to ${parent.name}?`,
      confirmLabel: 'Grant Access',
      type: 'primary',
      onConfirm: async () => {
        const tId = toast.loading(`Granting access to ${parent.name}...`);
        try {
          await api.post('/admin/parents/grant-free-access', {
            parentId: parent.id,
            adminId: adminId
          });
          toast.success(`Granted complimentary access to ${parent.name}`, { id: tId });
          fetchAuditLogs();
        } catch (err) {
          toast.error(err?.response?.data?.detail || err?.message || 'Failed to grant access', { id: tId });
        }
        setConfirmDialog(null);
      }
    });
  };
  const confirmDeleteParent = (e, parent) => {
    e.stopPropagation(); // Prevent row click
    setConfirmDialog({
      title: 'Delete Parent & Children',
      text: `Are you sure you want to delete ${parent.name}? This will also delete ALL their children and session data. This action cannot be undone.`,
      onConfirm: async () => {
        try {
          await api.delete(`/admin/parents/${parent.id}`);
          toast.success('Parent and all associated data deleted');
          fetchParents();
          if (selectedParent?.id === parent.id) resetSessionFlow();
        } catch { toast.error('Failed to delete parent'); }
        setConfirmDialog(null);
      },
    });
  };

  const confirmDeleteChild = (e, child) => {
    e.stopPropagation(); // Prevent row click
    setConfirmDialog({
      title: 'Delete Child',
      text: `Are you sure you want to delete ${child.first_name}? This will delete all their session data. This action cannot be undone.`,
      onConfirm: async () => {
        try {
          await api.delete(`/learners/${child.id}`);
          toast.success('Child deleted');
          if (selectedParent) fetchChildren(selectedParent.id);
          if (selectedChild?.id === child.id) {
            setSelectedChild(null);
            setSessions([]);
          }
        } catch { toast.error('Failed to delete child'); }
        setConfirmDialog(null);
      },
    });
  };

  const toggleResTag = (tag) => {
    setResForm(f => ({
      ...f,
      tags: f.tags.includes(tag) ? f.tags.filter(t => t !== tag) : [...f.tags, tag],
    }));
  };

  // ── Pagination ───────────────────────────────────────────────────────────
  const PER_PAGE = 10;
  const totalSessionPages = Math.ceil(sessions.length / PER_PAGE);
  const pagedSessions = sessions.slice((sessionsPage - 1) * PER_PAGE, sessionsPage * PER_PAGE);

  // ── Filtered parents ─────────────────────────────────────────────────────
  const filteredParents = parents.filter(p =>
    p.name.toLowerCase().includes(parentSearch.toLowerCase())
  );

  // ── Filtered specialists ──────────────────────────────────────────────────
  const filteredSpecialists = specialists.filter(spec => {
    const term = specSearch.toLowerCase();
    const nameMatch = spec.name?.toLowerCase().includes(term) || `${spec.first_name || ''} ${spec.last_name || ''}`.toLowerCase().includes(term);
    const specialtyMatch = spec.specialty?.toLowerCase().includes(term);
    const locationMatch = spec.location?.toLowerCase().includes(term);
    const emailMatch = spec.email?.toLowerCase().includes(term);
    const matchesSearch = nameMatch || specialtyMatch || locationMatch || emailMatch;

    const matchesStatus = 
      specFilterStatus === 'all' ? true :
      specFilterStatus === 'active' ? spec.is_active !== false :
      spec.is_active === false;

    return matchesSearch && matchesStatus;
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ── LOGIN SCREEN ──────────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════
  if (!isAdmin) {
    return (
      <div className="admin-login-root">
        <div className="admin-login-card">
          <div className="admin-login-logo">
            <div className="admin-login-logo-icon">🛡️</div>
            <div className="admin-login-title">Nesture<span style={{ color: '#1A8FA0' }}>AI</span> Admin</div>
            <div className="admin-login-subtitle">Secure administration panel</div>
          </div>

          {loginError && <div className="admin-login-error">{loginError}</div>}

          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="admin-form-group">
              <label className="admin-form-label">Email</label>
              <input className="admin-form-input" type="email" placeholder=""
                value={loginEmail} onChange={e => setLoginEmail(e.target.value)} required />
            </div>
            <div className="admin-form-group">
              <label className="admin-form-label">Password</label>
              <input className="admin-form-input" type="password" placeholder=""
                value={loginPassword} onChange={e => setLoginPassword(e.target.value)} required />
            </div>
            <button type="submit" className="admin-btn admin-btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '13px', marginTop: 8 }}>
              <Shield size={16} /> Sign In
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ── MAIN ADMIN PANEL ──────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════

  const NAV_ITEMS = [
    { id: 'sessions',    icon: FileSpreadsheet, label: 'Sessions CSV' },
    { id: 'specialists', icon: Users,            label: 'Specialists' },
    { id: 'resources',   icon: BookOpen,         label: 'Resources' },
    { id: 'exercises',   icon: Video,            label: 'Exercise Library' },
    { id: 'flags',       icon: Shield,           label: 'Feature Flags' },
  ];

  return (
    <div className="admin-root">
      <VideoModal isOpen={!!activeVideo} onClose={() => setActiveVideo(null)} videoUrl={activeVideo?.video_url} title={activeVideo?.name} />
      {/* ── Mobile toggle ── */}
      <button className="admin-mobile-toggle" onClick={() => setSidebarOpen(!sidebarOpen)}>
        {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
        Admin
      </button>

      {/* ── Sidebar overlay (mobile) ── */}
      {sidebarOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2000 }}
          onClick={() => setSidebarOpen(false)} />
      )}

      {/* ── Sidebar ── */}
      <aside className={`admin-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="admin-sidebar-logo">
          <div className="admin-sidebar-logo-icon">🛡️</div>
          <div className="admin-sidebar-logo-text">Nesture<span>AI</span></div>
        </div>
        <div className="admin-sidebar-role">Administration</div>

        <nav className="admin-sidebar-nav">
          {NAV_ITEMS.map(item => (
            <button key={item.id}
              className={`admin-nav-item ${activeTab === item.id ? 'active' : ''}`}
              onClick={() => { setActiveTab(item.id); setSidebarOpen(false); }}>
              <item.icon size={18} />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="admin-sidebar-spacer" />

        <button className="admin-logout-btn" onClick={handleLogout}>
          <LogOut size={16} /> Sign Out
        </button>
      </aside>

      {showUploadModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 500, padding: 24, boxShadow: '0 20px 40px rgba(0,0,0,0.2)' }}>
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
          </div>
        </div>
      )}

      {/* ── Main ── */}
      <main className="admin-main">

        {/* ═══════════════════ TAB: Sessions CSV ═══════════════════ */}
        {activeTab === 'sessions' && (
          <>
            <div className="admin-page-header">
              <h1 className="admin-page-title">📊 Export Sessions CSV</h1>
              <p className="admin-page-subtitle">Select a parent → child → download session data</p>
            </div>

            {/* Breadcrumb */}
            {(selectedParent || selectedChild) && (
              <div className="admin-breadcrumb">
                <span className="admin-breadcrumb-item" onClick={resetSessionFlow}>Parents</span>
                <span className="admin-breadcrumb-sep">/</span>
                {selectedParent && (
                  <span className={selectedChild ? 'admin-breadcrumb-item' : 'admin-breadcrumb-current'}
                    onClick={() => { if (selectedChild) { setSelectedChild(null); setSessions([]); setSessionsPage(1); } }}>
                    {selectedParent.name}
                  </span>
                )}
                {selectedChild && (
                  <>
                    <span className="admin-breadcrumb-sep">/</span>
                    <span className="admin-breadcrumb-current">{selectedChild.first_name} {selectedChild.last_name}</span>
                  </>
                )}
              </div>
            )}

            {/* Step 1: Parents list */}
            {!selectedParent && (
              <div className="admin-card">
                <div className="admin-card-header">
                  <div className="admin-card-title"><Users size={18} /> Registered Parents</div>
                  <span className="admin-badge admin-badge-teal">{parents.length} total</span>
                </div>
                <div className="admin-search-wrap">
                  <Search size={16} />
                  <input className="admin-search-input" placeholder="Search parents..."
                    value={parentSearch} onChange={e => setParentSearch(e.target.value)} />
                </div>
                {filteredParents.length > 0 ? (
                  <div className="table-scroll">
                    <table className="admin-table admin-table-clickable">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Registered</th>
                          <th>ID</th>
                          <th style={{ width: 60 }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredParents.map(p => (
                          <tr key={p.id} onClick={() => selectParent(p)}>
                            <td data-label="Name" style={{ fontWeight: 700, color: '#F1F5F9' }}>{p.name}</td>
                            <td data-label="Registered">{p.created_at?.slice(0, 10) || '—'}</td>
                            <td data-label="ID" style={{ fontSize: '0.72rem', color: '#475569' }}>{p.id?.slice(0, 8)}...</td>
                            <td data-label="Actions" style={{ whiteSpace: 'nowrap' }}>
                              <button className="admin-btn" style={{ padding: '6px 10px', marginRight: 6, display: 'inline-flex', alignItems: 'center', background: 'rgba(16, 185, 129, 0.2)', color: '#34d399', border: '1px solid rgba(16, 185, 129, 0.4)', borderRadius: '6px' }}
                                onClick={(e) => handleGrantFreeAccess(e, p)} title="Grant Free Access">
                                <Gift size={14} style={{ marginRight: 4 }} /> Grant Access
                              </button>
                              <button className="admin-btn" style={{ padding: '6px 10px', marginRight: 6, display: 'inline-flex', alignItems: 'center', background: 'rgba(79, 70, 229, 0.2)', color: '#a5b4fc', border: '1px solid rgba(79, 70, 229, 0.4)', borderRadius: '6px' }}
                                onClick={(e) => { e.stopPropagation(); handleImpersonateUser(p, 'parent'); }} title="Impersonate Parent">
                                <Eye size={14} style={{ marginRight: 4 }} /> Impersonate
                              </button>
                              <button className="admin-btn admin-btn-danger" style={{ padding: '6px', minWidth: 0 }}
                                onClick={(e) => confirmDeleteParent(e, p)} title="Delete Parent">
                                <Trash2 size={14} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="admin-empty">
                    <div className="admin-empty-emoji">👨‍👩‍👧</div>
                    No parents found
                  </div>
                )}
              </div>
            )}

            {/* Step 2: Children list */}
            {selectedParent && !selectedChild && (
              <div className="admin-card">
                <div className="admin-card-header">
                  <div className="admin-card-title">👧 Children of {selectedParent.name}</div>
                  <span className="admin-badge admin-badge-orange">{children.length} children</span>
                </div>
                {children.length > 0 ? (
                  <div className="table-scroll">
                    <table className="admin-table admin-table-clickable">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Age</th>
                          <th>Diagnosis</th>
                          <th style={{ width: 60 }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {children.map(c => (
                          <tr key={c.id} onClick={() => selectChild(c)}>
                            <td data-label="Name" style={{ fontWeight: 700, color: '#F1F5F9' }}>{c.first_name} {c.last_name}</td>
                            <td data-label="Age">{c.age || '—'}</td>
                            <td data-label="Diagnosis">{c.diagnosis || '—'}</td>
                            <td data-label="Actions">
                              <button className="admin-btn admin-btn-danger" style={{ padding: '6px', minWidth: 0 }}
                                onClick={(e) => confirmDeleteChild(e, c)} title="Delete Child">
                                <Trash2 size={14} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="admin-empty">
                    <div className="admin-empty-emoji">🚫</div>
                    No children registered for this parent
                  </div>
                )}
              </div>
            )}

            {/* Step 3: Sessions */}
            {selectedChild && (
              <div className="admin-card">
                <div className="admin-card-header">
                  <div className="admin-card-title">🎮 Sessions — {selectedChild.first_name}</div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span className="admin-badge admin-badge-green">{sessions.length} sessions</span>
                    {sessions.length > 0 && (
                      <button className="admin-btn admin-btn-csv" onClick={() => exportExcel()}>
                        <Download size={14} /> Download All (Excel)
                      </button>
                    )}
                  </div>
                </div>
                {loadingSessions ? (
                  <div className="admin-empty"><div className="spinner" style={{ margin: '0 auto' }} /></div>
                ) : pagedSessions.length > 0 ? (
                  <>
                    <div className="table-scroll">
                      <table className="admin-table">
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Duration</th>
                            <th>Accuracy</th>
                            <th>Difficulty</th>
                            <th>LPI</th>
                            <th>Perfect</th>
                            <th>Failed</th>
                            <th style={{ width: 80 }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pagedSessions.map(s => (
                            <tr key={s.id}>
                              <td data-label="Date">{s.start_time?.slice(0, 10) || '—'}</td>
                              <td data-label="Duration">{Math.round((parseFloat(s.duration_seconds) || 0) / 60)} min</td>
                              <td data-label="Accuracy">
                                <span style={{ fontWeight: 700, color: parseFloat(s.accuracy_score) > 0.7 ? '#86EFAC' : '#FDBA74' }}>
                                  {Math.round(parseFloat(s.accuracy_score || 0) * 100)}%
                                </span>
                              </td>
                              <td data-label="Difficulty">
                                <span className={`admin-badge ${s.difficulty === 'hard' ? 'admin-badge-red' : s.difficulty === 'medium' ? 'admin-badge-orange' : 'admin-badge-green'}`}>
                                  {s.difficulty || '—'}
                                </span>
                              </td>
                              <td data-label="LPI" style={{ fontWeight: 700 }}>{s.lpi_score || 0}</td>
                              <td data-label="Perfect" style={{ color: '#86EFAC' }}>{s.perfect_grabs || 0}</td>
                              <td data-label="Failed" style={{ color: '#FCA5A5' }}>{s.failed_grabs || 0}</td>
                              <td data-label="Actions">
                                <button className="admin-btn admin-btn-csv" style={{ padding: '6px 10px', fontSize: '0.75rem' }} onClick={() => exportExcel(s)}>
                                  <Download size={12} style={{ marginRight: 4 }} /> Export
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Pagination */}
                    {totalSessionPages > 1 && (
                      <div className="admin-pagination">
                        <button className="admin-page-btn" disabled={sessionsPage <= 1}
                          onClick={() => setSessionsPage(p => p - 1)}>
                          <ChevronLeft size={14} /> Prev
                        </button>
                        {Array.from({ length: totalSessionPages }, (_, i) => (
                          <button key={i} className={`admin-page-num ${sessionsPage === i + 1 ? 'active' : ''}`}
                            onClick={() => setSessionsPage(i + 1)}>
                            {i + 1}
                          </button>
                        ))}
                        <button className="admin-page-btn" disabled={sessionsPage >= totalSessionPages}
                          onClick={() => setSessionsPage(p => p + 1)}>
                          Next <ChevronRight size={14} />
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="admin-empty">
                    <div className="admin-empty-emoji">📭</div>
                    No sessions found for this child
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ═══════════════════ TAB: Specialists ═══════════════════ */}
        {activeTab === 'specialists' && (
          <>
            <div className="admin-page-header">
              <h1 className="admin-page-title">🩺 Manage Specialists</h1>
              <p className="admin-page-subtitle">NestureConnect practitioner directory</p>
            </div>

            <div className="admin-card">
              <div className="admin-card-header">
                <div className="admin-card-title"><Users size={18} /> Specialists ({specialists.length})</div>
                <button className="admin-btn admin-btn-primary" onClick={() => setShowSpecForm(!showSpecForm)}>
                  {showSpecForm ? <><X size={14} /> Cancel</> : <><UserPlus size={14} /> Add Specialist</>}
                </button>
              </div>

              {/* Add form */}
              {showSpecForm && (
                <form onSubmit={handleSpecSubmit} style={{ marginBottom: 24, background: '#0F172A', borderRadius: 14, padding: 20, border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#67E8F9', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <UserPlus size={16} /> New Specialist
                  </div>
                  <div className="admin-form-grid">
                    <div className="admin-form-group">
                      <label className="admin-form-label">Email *</label>
                      <input className="admin-form-input" type="email" placeholder="specialist@email.com" required
                        value={specForm.email} onChange={e => setSpecForm(f => ({ ...f, email: e.target.value }))} />
                    </div>
                    <div className="admin-form-group">
                      <label className="admin-form-label">First Name *</label>
                      <input className="admin-form-input" placeholder="Emily" required
                        value={specForm.first_name} onChange={e => setSpecForm(f => ({ ...f, first_name: e.target.value }))} />
                    </div>
                    <div className="admin-form-group">
                      <label className="admin-form-label">Last Name</label>
                      <input className="admin-form-input" placeholder="Carter"
                        value={specForm.last_name} onChange={e => setSpecForm(f => ({ ...f, last_name: e.target.value }))} />
                    </div>
                    <div className="admin-form-group">
                      <label className="admin-form-label">Specialty</label>
                      <input className="admin-form-input" placeholder="Occupational Therapist"
                        value={specForm.specialty} onChange={e => setSpecForm(f => ({ ...f, specialty: e.target.value }))} />
                    </div>
                    <div className="admin-form-group">
                      <label className="admin-form-label">Location</label>
                      <input className="admin-form-input" placeholder="London, UK"
                        value={specForm.location} onChange={e => setSpecForm(f => ({ ...f, location: e.target.value }))} />
                    </div>
                    <div className="admin-form-group full-width">
                      <label className="admin-form-label">Bio</label>
                      <textarea className="admin-form-textarea" placeholder="Brief description of expertise..."
                        value={specForm.bio} onChange={e => setSpecForm(f => ({ ...f, bio: e.target.value }))} />
                    </div>
                    <div className="admin-form-group">
                      <label className="admin-form-label">Avatar Image (optional)</label>
                      <input className="admin-form-input" type="file" accept="image/*"
                        onChange={e => setSpecAvatarFile(e.target.files[0])} style={{ padding: '8px 14px' }} />
                    </div>
                    <div className="admin-form-group">
                      <div className="admin-toggle-wrap" style={{ marginTop: 22 }}>
                        <button type="button" className={`admin-toggle ${specForm.is_featured ? 'active' : ''}`}
                          onClick={() => setSpecForm(f => ({ ...f, is_featured: !f.is_featured }))} />
                        <span className="admin-toggle-label">Featured specialist</span>
                      </div>
                    </div>
                  </div>
                  <div style={{ padding: '0 20px', color: '#94A3B8', fontSize: '0.8rem', marginTop: 10 }}>
                    * An invitation email will be sent automatically with a link to set their password.
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
                    <button type="button" className="admin-btn admin-btn-secondary" onClick={() => setShowSpecForm(false)}>Cancel</button>
                    <button type="submit" className="admin-btn admin-btn-primary" disabled={specSaving}>
                      {specSaving ? 'Creating...' : <><Plus size={14} /> Invite Specialist</>}
                    </button>
                  </div>
                </form>
              )}

              {/* Search, Filters, and Logs Controls */}
              <div style={{ display: 'flex', gap: 16, margin: '16px 20px 20px 20px', flexWrap: 'wrap', alignItems: 'center' }}>
                <div className="admin-search-wrap" style={{ flex: 1, minWidth: 200, margin: 0 }}>
                  <Search size={16} />
                  <input className="admin-search-input" placeholder="Search by name, specialty, location, email..."
                    value={specSearch} onChange={e => setSpecSearch(e.target.value)} />
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <select 
                    className="admin-form-select" 
                    style={{ width: 180, background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: 8, padding: '8px 12px' }}
                    value={specFilterStatus} 
                    onChange={e => setSpecFilterStatus(e.target.value)}
                  >
                    <option value="all">All Statuses</option>
                    <option value="active">Active Only</option>
                    <option value="deactivated">Deactivated Only</option>
                  </select>
                  <button className="admin-btn admin-btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: showAuditLogs ? 'rgba(103, 232, 249, 0.1)' : 'rgba(255,255,255,0.05)', color: showAuditLogs ? '#67E8F9' : '#fff', border: showAuditLogs ? '1px solid rgba(103, 232, 249, 0.3)' : '1px solid rgba(255,255,255,0.1)' }}
                    onClick={() => { setShowAuditLogs(!showAuditLogs); }}>
                    <ScrollText size={14} />
                    {showAuditLogs ? 'Hide Audit Logs' : 'View Audit Logs'}
                  </button>
                </div>
              </div>

              {/* Collapsible Audit Logs Section */}
              {showAuditLogs && (
                <div style={{ margin: '0 20px 24px 20px', background: '#090d16', borderRadius: 14, padding: 20, border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#67E8F9', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <ScrollText size={16} /> Administrative Audit Logs
                    </div>
                    <button className="admin-btn admin-btn-secondary" style={{ padding: '4px 10px', fontSize: '0.75rem', background: '#1e293b' }} onClick={fetchAuditLogs}>
                      Refresh Logs
                    </button>
                  </div>
                  {loadingAuditLogs ? (
                    <div style={{ display: 'flex', justifyContent: 'center', padding: 30 }}>
                      <div className="spinner" style={{ borderTopColor: '#67E8F9' }} />
                    </div>
                  ) : auditLogs.length > 0 ? (
                    <div className="table-scroll" style={{ maxHeight: 300, overflowY: 'auto' }}>
                      <table className="admin-table">
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Admin</th>
                            <th>Action</th>
                            <th>Target User ID</th>
                            <th>Details</th>
                          </tr>
                        </thead>
                        <tbody>
                          {auditLogs.map(log => (
                            <tr key={log.id}>
                              <td data-label="Date" style={{ fontSize: '0.75rem', color: '#64748B' }}>{new Date(log.created_at).toLocaleString()}</td>
                              <td data-label="Admin" style={{ fontWeight: 600, color: '#E2E8F0' }}>{log.admin ? `${log.admin.first_name || ''} ${log.admin.last_name || ''}`.trim() : 'System'}</td>
                              <td data-label="Action">
                                <span className={`admin-badge ${
                                  log.action === 'deactivate' ? 'admin-badge-red' :
                                  log.action === 'reactivate' ? 'admin-badge-green' :
                                  log.action === 'impersonate' ? 'admin-badge-purple' :
                                  log.action === 'reset_password' ? 'admin-badge-orange' : 'admin-badge-teal'
                                }`}>
                                  {log.action}
                                </span>
                              </td>
                              <td data-label="Target ID" style={{ fontSize: '0.7rem', fontFamily: 'monospace', color: '#64748B' }}>{log.target_user_id?.slice(0, 8)}...</td>
                              <td data-label="Details" style={{ fontSize: '0.78rem', color: '#94A3B8' }}>{log.details}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div style={{ textAlign: 'center', color: '#64748B', padding: '20px 0', fontSize: '0.85rem' }}>No audit logs recorded yet.</div>
                  )}
                </div>
              )}

              {/* Specialists grid */}
              {filteredSpecialists.length > 0 ? (
                <div className="admin-spec-grid" style={{ padding: '0 20px 20px 20px' }}>
                  {filteredSpecialists.map(spec => (
                    <div key={spec.id} className="admin-spec-card" style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'stretch', padding: 18, background: '#0F172A', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px' }}>
                      
                      {/* Avatar and top level details */}
                      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                        <img className="admin-spec-avatar"
                          src={spec.avatar_url || DEFAULT_AVATAR}
                          alt={spec.name}
                          style={{ width: 50, height: 50, borderRadius: '50%', objectFit: 'cover' }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, fontWeight: 700, color: '#fff', fontSize: '0.95rem' }}>
                            {spec.name || `${spec.first_name || ''} ${spec.last_name || ''}`}
                            {spec.is_featured && <Star size={12} color="#FBBF24" fill="#FBBF24" />}
                            <span className={`admin-badge ${spec.is_active !== false ? 'admin-badge-green' : 'admin-badge-red'}`} style={{ fontSize: '0.62rem', padding: '1px 6px', lineHeight: 1.2 }}>
                              {spec.is_active !== false ? 'Active' : 'Deactivated'}
                            </span>
                            {spec.must_reset_password && (
                              <span className={`admin-badge ${spec.invitation_expires_at && new Date(spec.invitation_expires_at) < new Date() ? 'admin-badge-red' : 'admin-badge-orange'}`} style={{ fontSize: '0.62rem', padding: '1px 6px', lineHeight: 1.2 }}>
                                {spec.invitation_expires_at && new Date(spec.invitation_expires_at) < new Date() ? 'Invite Expired' : 'Invite Pending'}
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: '0.8rem', color: '#67E8F9', fontWeight: 500, marginTop: 1 }}>{spec.specialty || 'Specialist'}</div>
                          {spec.location && (
                            <div style={{ fontSize: '0.72rem', color: '#64748B', display: 'flex', alignItems: 'center', marginTop: 3 }}>
                              <MapPin size={10} style={{ marginRight: 3 }} />{spec.location}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Bio */}
                      {spec.bio && (
                        <p style={{ fontSize: '0.78rem', color: '#94A3B8', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', lineHeight: '1.4' }}>
                          {spec.bio}
                        </p>
                      )}

                      {/* Middle row: Metadata */}
                      <div style={{ fontSize: '0.72rem', color: '#475569', display: 'flex', flexDirection: 'column', gap: 3, borderTop: '1px solid rgba(255,255,255,0.03)', paddingTop: 10 }}>
                        <div style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>Email: <span style={{ color: '#94A3B8' }}>{spec.email || 'N/A'}</span></div>
                        <div>Code: <span style={{ color: '#FCD34D', fontWeight: 600, fontFamily: 'monospace' }}>{spec.connection_code || 'N/A'}</span></div>
                      </div>

                      {/* Primary actions row */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 'auto', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: 10 }}>
                        <button className="admin-btn" style={{ padding: '6px 8px', flex: 1, minWidth: 65, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, background: 'rgba(255, 255, 255, 0.04)', color: '#F1F5F9', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: 6 }}
                          onClick={() => setSelectedSpecialist(spec)} title="View Details">
                          <Eye size={12} /> <span style={{ fontSize: '0.7rem' }}>Details</span>
                        </button>
                        <button className="admin-btn" style={{ padding: '6px 8px', flex: 1, minWidth: 65, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, background: 'rgba(26, 143, 160, 0.08)', color: '#67E8F9', border: '1px solid rgba(26, 143, 160, 0.15)', borderRadius: 6 }}
                          onClick={() => setEditingSpecialist({ ...spec })} title="Edit Profile">
                          <Edit size={12} /> <span style={{ fontSize: '0.7rem' }}>Edit</span>
                        </button>
                        <button className="admin-btn" style={{ padding: '6px 8px', flex: 1, minWidth: 65, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, background: 'rgba(232, 132, 26, 0.08)', color: '#FDBA74', border: '1px solid rgba(232, 132, 26, 0.15)', borderRadius: 6 }}
                          onClick={() => handleResetPassword(spec)} title="Reset Password via Email">
                          <Key size={12} /> <span style={{ fontSize: '0.7rem' }}>Reset</span>
                        </button>
                        {spec.must_reset_password && spec.invitation_expires_at && new Date(spec.invitation_expires_at) < new Date() && (
                          <button className="admin-btn" style={{ padding: '6px 8px', flex: 1, minWidth: 65, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, background: 'rgba(59, 130, 246, 0.08)', color: '#60A5FA', border: '1px solid rgba(59, 130, 246, 0.15)', borderRadius: 6 }}
                            onClick={() => handleResendInvitation(spec)} title="Resend Expired Invitation">
                            <Send size={12} /> <span style={{ fontSize: '0.7rem' }}>Resend Invite</span>
                          </button>
                        )}
                        <button className="admin-btn" style={{ 
                          padding: '6px 8px', 
                          flex: 1, 
                          minWidth: 65, 
                          display: 'inline-flex', 
                          alignItems: 'center', 
                          justifyContent: 'center', 
                          gap: 4, 
                          background: spec.is_active !== false ? 'rgba(239, 68, 68, 0.08)' : 'rgba(34, 197, 94, 0.08)', 
                          color: spec.is_active !== false ? '#FCA5A5' : '#86EFAC', 
                          border: spec.is_active !== false ? '1px solid rgba(239, 68, 68, 0.15)' : '1px solid rgba(34, 197, 94, 0.15)',
                          borderRadius: 6
                        }}
                          onClick={() => handleToggleStatus(spec)} title={spec.is_active !== false ? 'Deactivate Specialist' : 'Reactivate Specialist'}>
                          <span style={{ fontSize: '0.7rem' }}>{spec.is_active !== false ? 'Deactivate' : 'Reactivate'}</span>
                        </button>
                      </div>

                      {/* Impersonation exit and Delete row */}
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="admin-btn" style={{ 
                          flex: 1, 
                          padding: '6px 10px', 
                          fontSize: '0.72rem', 
                          display: 'inline-flex', 
                          alignItems: 'center', 
                          justifyContent: 'center', 
                          gap: 6, 
                          background: spec.is_active !== false ? 'rgba(79, 70, 229, 0.12)' : 'rgba(255,255,255,0.03)', 
                          color: spec.is_active !== false ? '#a5b4fc' : '#475569', 
                          border: spec.is_active !== false ? '1px solid rgba(79, 70, 229, 0.25)' : '1px solid rgba(255,255,255,0.03)',
                          borderRadius: '6px',
                          cursor: spec.is_active !== false ? 'pointer' : 'not-allowed'
                        }}
                          disabled={spec.is_active === false}
                          onClick={() => handleImpersonateUser(spec, 'practitioner')} title="Impersonate Specialist Dashboard">
                          <Eye size={12} /> Impersonate
                        </button>
                        <button className="admin-btn admin-btn-danger" style={{ padding: '6px 10px', minWidth: 40 }}
                          onClick={() => confirmDeleteSpec(spec)} title="Delete Specialist Account">
                          <Trash2 size={14} />
                        </button>
                      </div>

                    </div>
                  ))}
                </div>
              ) : (
                <div className="admin-empty" style={{ padding: '40px 0' }}>
                  <div className="admin-empty-emoji">🩺</div>
                  No matching specialists found
                </div>
              )}
            </div>
          </>
        )}

        {/* ═══════════════════ TAB: Resources ═══════════════════ */}
        {activeTab === 'resources' && (
          <>
            <div className="admin-page-header">
              <h1 className="admin-page-title">📚 Manage Resources</h1>
              <p className="admin-page-subtitle">NestureLearn educational content</p>
            </div>

            <div className="admin-card">
              <div className="admin-card-header">
                <div className="admin-card-title"><BookOpen size={18} /> Resources ({resources.length})</div>
                <button className="admin-btn admin-btn-primary" onClick={() => setShowResForm(!showResForm)}>
                  {showResForm ? <><X size={14} /> Cancel</> : <><Plus size={14} /> Add Resource</>}
                </button>
              </div>

              {/* Add form */}
              {showResForm && (
                <form onSubmit={handleResSubmit} style={{ marginBottom: 24, background: '#0F172A', borderRadius: 14, padding: 20, border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#67E8F9', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Plus size={16} /> New Resource
                  </div>
                  <div className="admin-form-grid">
                    <div className="admin-form-group full-width">
                      <label className="admin-form-label">Title *</label>
                      <input className="admin-form-input" placeholder="Understanding Sensory Processing" required
                        value={resForm.title} onChange={e => setResForm(f => ({ ...f, title: e.target.value }))} />
                    </div>
                    <div className="admin-form-group full-width">
                      <label className="admin-form-label">Description</label>
                      <textarea className="admin-form-textarea" placeholder="Brief description..."
                        value={resForm.description} onChange={e => setResForm(f => ({ ...f, description: e.target.value }))} />
                    </div>
                    <div className="admin-form-group">
                      <label className="admin-form-label">Type *</label>
                      <select className="admin-form-select" value={resForm.type}
                        onChange={e => setResForm(f => ({ ...f, type: e.target.value }))}>
                        <option value="video">🎬 Video</option>
                        <option value="podcast">🎧 Podcast</option>
                        <option value="article">📖 Article</option>
                      </select>
                    </div>
                    <div className="admin-form-group">
                      <label className="admin-form-label">Duration</label>
                      <input className="admin-form-input" placeholder="12 min"
                        value={resForm.duration} onChange={e => setResForm(f => ({ ...f, duration: e.target.value }))} />
                    </div>
                    <div className="admin-form-group full-width">
                      <label className="admin-form-label">URL *</label>
                      <input className="admin-form-input" type="url" placeholder="https://..." required
                        value={resForm.url} onChange={e => setResForm(f => ({ ...f, url: e.target.value }))} />
                    </div>
                    <div className="admin-form-group">
                      <label className="admin-form-label">Thumbnail Image</label>
                      <input className="admin-form-input" type="file" accept="image/*"
                        onChange={e => setThumbnailFile(e.target.files[0])} style={{ padding: '8px 14px' }} />
                    </div>
                    <div className="admin-form-group">
                      <div className="admin-toggle-wrap" style={{ marginTop: 22 }}>
                        <button type="button" className={`admin-toggle ${resForm.featured ? 'active' : ''}`}
                          onClick={() => setResForm(f => ({ ...f, featured: !f.featured }))} />
                        <span className="admin-toggle-label">Featured resource</span>
                      </div>
                    </div>
                    <div className="admin-form-group full-width">
                      <label className="admin-form-label">Tags</label>
                      <div className="admin-tags-wrap">
                        {AVAILABLE_TAGS.map(tag => (
                          <button type="button" key={tag}
                            className={`admin-tag ${resForm.tags.includes(tag) ? 'selected' : ''}`}
                            onClick={() => toggleResTag(tag)}>
                            {tag.replace('_', ' ')}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
                    <button type="button" className="admin-btn admin-btn-secondary" onClick={() => setShowResForm(false)}>Cancel</button>
                    <button type="submit" className="admin-btn admin-btn-primary" disabled={resSaving}>
                      {resSaving ? 'Creating...' : <><Plus size={14} /> Add Resource</>}
                    </button>
                  </div>
                </form>
              )}

              {/* Resources grid */}
              {resources.length > 0 ? (
                <div className="admin-resource-grid">
                  {resources.map(res => {
                    const Icon = TYPE_ICONS[res.type] || BookOpenText;
                    return (
                      <div key={res.id} className="admin-resource-card">
                        {res.thumbnail_url ? (
                          <img className="admin-resource-thumb" src={res.thumbnail_url} alt={res.title} />
                        ) : (
                          <div className="admin-resource-thumb" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Icon size={24} color="#64748B" />
                          </div>
                        )}
                        <div className="admin-resource-info">
                          <div className="admin-resource-title">{res.title}</div>
                          <div className="admin-resource-meta">
                            <span className={`admin-badge ${res.type === 'video' ? 'admin-badge-red' : res.type === 'podcast' ? 'admin-badge-purple' : 'admin-badge-teal'}`}>
                              {res.type}
                            </span>
                            {res.duration && <span style={{ fontSize: '0.72rem', color: '#475569' }}>{res.duration}</span>}
                            {res.featured && <Star size={12} color="#FBBF24" fill="#FBBF24" />}
                          </div>
                        </div>
                        <button className="admin-btn admin-btn-danger" style={{ padding: '6px 10px', flexShrink: 0, alignSelf: 'center' }}
                          onClick={() => confirmDeleteRes(res)} title="Delete">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="admin-empty">
                  <div className="admin-empty-emoji">📚</div>
                  No resources yet
                </div>
              )}
            </div>
          </>
        )}

        {/* ═══════════════════ TAB: Exercises ═══════════════════ */}
        {activeTab === 'exercises' && (
          <div className="admin-page-content" style={{ animation: 'fadeIn 0.3s' }}>
            <div className="admin-page-header">
              <h1 className="admin-page-title">🏋️ Exercise Library</h1>
              <p className="admin-page-subtitle">Manage all exercise videos available to practitioners</p>
            </div>
            
            <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'flex-end' }}>
              <button className="admin-btn admin-btn-primary" onClick={() => { setEditingExerciseId(null); setUploadForm({ name: '', target_reflex: '', description: '', duration_minutes: '', difficulty_level: 'medium', video_url: '' }); setUploadFile(null); setShowUploadModal(true); }}>
                <Plus size={16} /> Upload Exercise
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
              <div key={reflex} className="admin-card" style={{ padding: 24, marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
                  <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 800, color: '#0D5E6B', fontSize: '1rem' }}>{reflex} Reflex</span>
                  <span className="admin-badge admin-badge-teal">{exList.length} exercises</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
                  {exList.map((ex) => (
                    <div key={ex.id} style={{ background: '#F8FAFB', border: '1.5px solid #DDE8EB', borderRadius: 14, padding: '16px 14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                        <span style={{ fontWeight: 700, color: '#0D3D47', fontSize: '0.92rem' }}>{ex.name}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className={`admin-badge admin-badge-${ex.difficulty_level === 'medium' ? 'warning' : 'success'}`}>{ex.difficulty_level}</span>
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
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ═══════════════════ TAB: Feature Flags ═══════════════════ */}
        {activeTab === 'flags' && (
          <>
            <div className="admin-page-header">
              <h1 className="admin-page-title">🛡️ User Feature Flags</h1>
              <p className="admin-page-subtitle">Manage feature flag access for registered parents</p>
            </div>

            <div className="admin-card">
              <div className="admin-card-header">
                <div className="admin-card-title"><Users size={18} /> User Accounts & Feature Flags</div>
                <span className="admin-badge admin-badge-teal">{parents.length} users</span>
              </div>
              <div className="admin-search-wrap">
                <Search size={16} />
                <input className="admin-search-input" placeholder="Search parents by name..."
                  value={parentSearch} onChange={e => setParentSearch(e.target.value)} />
              </div>
              {loadingFlags ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
                  <div className="spinner" style={{ borderTopColor: '#0EA5E9' }} />
                </div>
              ) : filteredParents.length > 0 ? (
                <div className="table-scroll">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Parent Name</th>
                        <th>Email</th>
                        <th>Registered</th>
                        <th>Agentic AI Upload Flag</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredParents.map(p => {
                        const flag = featureFlags[p.id] || {};
                        const isEnabled = !!flag.enabled;
                        const enabledAtDate = flag.enabled_at ? new Date(flag.enabled_at).toLocaleString() : '';

                        return (
                          <tr key={p.id}>
                            <td data-label="Parent Name" style={{ fontWeight: 700, color: '#F1F5F9' }}>{p.name}</td>
                            <td data-label="Email" style={{ color: '#E2E8F0' }}>{p.email || 'N/A'}</td>
                            <td data-label="Registered">{p.created_at?.slice(0, 10) || '—'}</td>
                            <td data-label="Agentic AI Upload Flag">
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                <label style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer', gap: 10 }}>
                                  <div style={{ position: 'relative', display: 'inline-block', width: 44, height: 24 }} onClick={(e) => { e.preventDefault(); handleToggleFlag(p.id, isEnabled); }}>
                                    <input 
                                      type="checkbox" 
                                      checked={isEnabled} 
                                      readOnly
                                      style={{
                                        opacity: 0, width: 0, height: 0
                                      }}
                                    />
                                    <span style={{
                                      position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                                      backgroundColor: isEnabled ? '#10B981' : '#475569',
                                      transition: '0.3s', borderRadius: 24
                                    }}>
                                      <span style={{
                                        position: 'absolute', content: '""', height: 16, width: 16, left: isEnabled ? 24 : 4, bottom: 4,
                                        backgroundColor: '#fff', transition: '0.3s', borderRadius: '50%'
                                      }} />
                                    </span>
                                  </div>
                                  <span style={{ fontSize: '0.85rem', fontWeight: 600, color: isEnabled ? '#10B981' : '#94A3B8' }}>
                                    {isEnabled ? 'Enabled' : 'Disabled'}
                                  </span>
                                </label>
                                {isEnabled && flag.enabled_at && (
                                  <div style={{ fontSize: '0.72rem', color: '#64748B' }}>
                                    Enabled by admin on {enabledAtDate}
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="admin-empty">
                  <div className="admin-empty-emoji">👨‍👩‍👧</div>
                  No users found
                </div>
              )}
            </div>
          </>
        )}
      </main>

      {/* ── Confirm dialog ── */}
      {confirmDialog && (
        <div className="admin-confirm-overlay" onClick={() => setConfirmDialog(null)}>
          <div className="admin-confirm-box" onClick={e => e.stopPropagation()}>
            <AlertTriangle size={32} color="#FBBF24" style={{ marginBottom: 12 }} />
            <div className="admin-confirm-title">{confirmDialog.title}</div>
            <div className="admin-confirm-text" style={{ whiteSpace: 'pre-line' }}>{confirmDialog.text}</div>
            <div className="admin-confirm-actions">
              <button className="admin-btn admin-btn-secondary" onClick={() => setConfirmDialog(null)}>Cancel</button>
              <button 
                className={`admin-btn ${confirmDialog.type === 'primary' ? 'admin-btn-primary' : 'admin-btn-danger'}`} 
                onClick={confirmDialog.onConfirm}
              >
                {confirmDialog.confirmLabel || (confirmDialog.title.toLowerCase().includes('delete') ? <><Trash2 size={14} /> Delete</> : 'Confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── View Specialist Modal ── */}
      {selectedSpecialist && (
        <div className="admin-confirm-overlay" onClick={() => setSelectedSpecialist(null)}>
          <div className="admin-confirm-box" style={{ maxWidth: 500, textAlign: 'left' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 12, marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: '1.1rem', color: '#67E8F9' }}>Practitioner Details</div>
              <button style={{ background: 'none', border: 'none', color: '#64748B', cursor: 'pointer' }} onClick={() => setSelectedSpecialist(null)}>
                <X size={18} />
              </button>
            </div>
            
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 20 }}>
              <img src={selectedSpecialist.avatar_url || DEFAULT_AVATAR}
                alt={selectedSpecialist.name}
                style={{ width: 70, height: 70, borderRadius: '50%', border: '2px solid rgba(103, 232, 249, 0.2)', objectFit: 'cover' }} />
              <div>
                <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#fff', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {selectedSpecialist.name || `${selectedSpecialist.first_name || ''} ${selectedSpecialist.last_name || ''}`}
                  {selectedSpecialist.is_featured && <Star size={14} color="#FBBF24" fill="#FBBF24" />}
                </h3>
                <p style={{ margin: '2px 0 0 0', color: '#67E8F9', fontSize: '0.9rem' }}>{selectedSpecialist.specialty}</p>
                <span className={`admin-badge ${selectedSpecialist.is_active !== false ? 'admin-badge-green' : 'admin-badge-red'}`} style={{ marginTop: 6, display: 'inline-block' }}>
                  {selectedSpecialist.is_active !== false ? 'Active Account' : 'Deactivated Account'}
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: '0.9rem', color: '#E2E8F0' }}>
              <div>
                <span style={{ color: '#64748B', fontWeight: 600, display: 'block', fontSize: '0.8rem', textTransform: 'uppercase' }}>Email</span>
                <span style={{ color: '#fff' }}>{selectedSpecialist.email || 'N/A'}</span>
              </div>
              <div>
                <span style={{ color: '#64748B', fontWeight: 600, display: 'block', fontSize: '0.8rem', textTransform: 'uppercase' }}>Location</span>
                <span style={{ color: '#fff' }}>{selectedSpecialist.location || 'Not Specified'}</span>
              </div>
              <div>
                <span style={{ color: '#64748B', fontWeight: 600, display: 'block', fontSize: '0.8rem', textTransform: 'uppercase' }}>Connection Code</span>
                <span style={{ color: '#FCD34D', fontWeight: 700, fontFamily: 'monospace' }}>{selectedSpecialist.connection_code || 'N/A'}</span>
              </div>
              <div>
                <span style={{ color: '#64748B', fontWeight: 600, display: 'block', fontSize: '0.8rem', textTransform: 'uppercase' }}>Bio</span>
                <p style={{ margin: '4px 0 0 0', color: '#94A3B8', lineHeight: '1.5' }}>{selectedSpecialist.bio || 'No bio provided.'}</p>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 24, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 16 }}>
              <button 
                className="admin-btn" 
                style={{ background: 'rgba(232, 132, 26, 0.12)', color: '#FDBA74', border: '1px solid rgba(232, 132, 26, 0.25)', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', padding: '8px 12px' }}
                onClick={() => {
                  const specToReset = selectedSpecialist;
                  setSelectedSpecialist(null);
                  handleResetPassword(specToReset);
                }}
              >
                <Key size={14} /> Reset Password
              </button>
              <button className="admin-btn admin-btn-secondary" onClick={() => setSelectedSpecialist(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Specialist Modal ── */}
      {editingSpecialist && (
        <div className="admin-confirm-overlay" onClick={() => setEditingSpecialist(null)}>
          <div className="admin-confirm-box" style={{ maxWidth: 550, textAlign: 'left' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 12, marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: '1.1rem', color: '#67E8F9', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Edit size={18} /> Edit Practitioner Profile
              </div>
              <button style={{ background: 'none', border: 'none', color: '#64748B', cursor: 'pointer' }} onClick={() => setEditingSpecialist(null)}>
                <X size={18} />
              </button>
            </div>
            
            <form onSubmit={handleEditSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="admin-form-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="admin-form-group">
                  <label className="admin-form-label">First Name *</label>
                  <input className="admin-form-input" required
                    value={editingSpecialist.first_name || ''} 
                    onChange={e => setEditingSpecialist(f => ({ ...f, first_name: e.target.value }))} />
                </div>
                <div className="admin-form-group">
                  <label className="admin-form-label">Last Name</label>
                  <input className="admin-form-input" 
                    value={editingSpecialist.last_name || ''} 
                    onChange={e => setEditingSpecialist(f => ({ ...f, last_name: e.target.value }))} />
                </div>
                <div className="admin-form-group">
                  <label className="admin-form-label">Specialty</label>
                  <input className="admin-form-input" 
                    value={editingSpecialist.specialty || ''} 
                    onChange={e => setEditingSpecialist(f => ({ ...f, specialty: e.target.value }))} />
                </div>
                <div className="admin-form-group">
                  <label className="admin-form-label">Location</label>
                  <input className="admin-form-input" 
                    value={editingSpecialist.location || ''} 
                    onChange={e => setEditingSpecialist(f => ({ ...f, location: e.target.value }))} />
                </div>
              </div>
              
              <div className="admin-form-group">
                <label className="admin-form-label">Bio</label>
                <textarea className="admin-form-textarea" style={{ height: 100 }}
                  value={editingSpecialist.bio || ''} 
                  onChange={e => setEditingSpecialist(f => ({ ...f, bio: e.target.value }))} />
              </div>

              <div className="admin-form-group">
                <div className="admin-toggle-wrap">
                  <button type="button" className={`admin-toggle ${editingSpecialist.is_featured ? 'active' : ''}`}
                    onClick={() => setEditingSpecialist(f => ({ ...f, is_featured: !f.is_featured }))} />
                  <span className="admin-toggle-label">Featured specialist</span>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 16, marginTop: 8 }}>
                <button type="button" className="admin-btn admin-btn-secondary" onClick={() => setEditingSpecialist(null)}>Cancel</button>
                <button type="submit" className="admin-btn admin-btn-primary">Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
