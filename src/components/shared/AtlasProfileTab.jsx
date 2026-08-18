import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../../services/supabaseClient';
import toast from 'react-hot-toast';

import AtlasDeepDiveModal from './AtlasDeepDiveModal';
import AIEngineProcessingModal from './AIEngineProcessingModal';
import { generateAtlasProfileReport } from '../../services/reportBuilder';
import { motion } from 'framer-motion';
import { Brain, Sparkles, ChevronRight, Download, Activity, Share2, Plus, Edit2, Info, Search, FileText, User, BookOpen, Ear, Heart, Dna, Home, MessageCircle, Coffee, AlertTriangle, Folder, Trash2, Camera, Shield, Target } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';

// ── Score Snapshot — circular gauge ────────────────────────────────────────────
function CircularGauge({ label, value, color }) {
  const isNA = value === null || value === undefined;
  const displayVal = isNA ? 'N/A' : value;
  const pct = isNA ? 0 : Math.min(100, Math.max(0, value));
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <svg width="68" height="68" viewBox="0 0 68 68">
        <circle cx="34" cy="34" r={radius} fill="none" stroke="#F3F4F6" strokeWidth="5" />
        <circle cx="34" cy="34" r={radius} fill="none" stroke={isNA ? '#D1D5DB' : color} strokeWidth="5"
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round" transform="rotate(-90 34 34)"
          style={{ transition: 'stroke-dashoffset 0.8s ease' }}
        />
        <text x="34" y="34" textAnchor="middle" dominantBaseline="central"
          style={{ fontSize: isNA ? '0.7rem' : '0.85rem', fontWeight: 800, fill: isNA ? '#9CA3AF' : '#111827' }}>
          {displayVal}
        </text>
      </svg>
      <span style={{ fontSize: '0.65rem', fontWeight: 600, color: '#6B7280', textAlign: 'center', lineHeight: 1.2, maxWidth: 80 }}>
        {label}
      </span>
    </div>
  );
}

// ── Profile Card ──────────────────────────────────────────────────────────────
// ── Tooltip Component ────────────────────────────────────────────────────────
function TooltipInfo({ text }) {
  const [show, setShow] = useState(false);
  return (
    <span
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', cursor: 'pointer', marginLeft: 4 }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onClick={(e) => { e.stopPropagation(); setShow(!show); }}
    >
      <Info size={13} color="#0D5E6B" />
      {show && (
        <span style={{
          position: 'absolute',
          bottom: '100%',
          left: '50%',
          transform: 'translateX(-50%)',
          marginBottom: 6,
          background: '#0F172A',
          color: '#F8FAFC',
          fontSize: '0.72rem',
          lineHeight: 1.45,
          padding: '8px 12px',
          borderRadius: 8,
          whiteSpace: 'normal',
          width: 230,
          zIndex: 9999,
          boxShadow: '0 10px 15px -3px rgba(0,0,0,0.3)',
          pointerEvents: 'none',
          textAlign: 'left',
          fontWeight: 400
        }}>
          {text}
        </span>
      )}
    </span>
  );
}

// ── Profile Card ──────────────────────────────────────────────────────────────
function ProfileCard({ title, icon, color = '#0D5E6B', badge, badgeColor, children, id, source, quotes, showSourceFooter = true }) {
  return (
    <div id={id} style={{
      background: '#fff', borderRadius: 14, padding: 22,
      borderTop: `3.5px solid ${color}`,
      boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
      scrollMarginTop: 24,
      transition: 'all 0.3s ease',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h3 style={{
          fontFamily: 'Inter, sans-serif', fontSize: '0.95rem', fontWeight: 700, color: '#1F2937',
          margin: 0, display: 'flex', alignItems: 'center', gap: 8
        }}>
          {icon} {title}
        </h3>
        {badge && (
          <span style={{
            background: badgeColor === 'dark' ? '#1F2937' : badgeColor === 'warning' ? '#FEF3C7' : '#D1FAE5',
            color: badgeColor === 'dark' ? '#fff' : badgeColor === 'warning' ? '#92400E' : '#065F46',
            fontSize: '0.6rem', fontWeight: 800,
            padding: '3px 8px', borderRadius: 4, letterSpacing: '0.05em',
            textTransform: 'uppercase'
          }}>{badge}</span>
        )}
      </div>
      <div style={{ fontSize: '0.85rem', color: '#4B5563', lineHeight: 1.6 }}>
        {children}
      </div>
      
      {/* Evidence and Source footer (only when feature flag allows) */}
      {showSourceFooter && source && (
        <div style={{
          marginTop: 14,
          paddingTop: 10,
          borderTop: '1px solid #E5E7EB',
          fontSize: '0.75rem',
          color: '#6B7280'
        }}>
          {source === 'Evidence Required' ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <FileText size={12} /> Source: Caregiver Questionnaire
                <TooltipInfo text="Information provenaant du questionnaire parent. L'upload de documents permet de croiser les observations et valider le profil par un spécialiste." />
              </span>
              <span style={{
                background: '#FEF3C7',
                color: '#D97706',
                fontSize: '0.65rem',
                fontWeight: 800,
                padding: '2px 8px',
                borderRadius: 4,
                letterSpacing: '0.05em',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4
              }}>
                EVIDENCE REQUIRED
                <TooltipInfo text="Aucun rapport médical/clinique n'est encore associé à ce domaine. Importez un document pour valider ces observations." />
              </span>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
                <FileText size={12} color="#0D5E6B" /> Source: <span style={{ fontWeight: 400, color: '#4B5563' }}>{source}</span>
                <TooltipInfo text="Indique la provenance des données (questionnaire parent et/ou rapports cliniques analysés par IA). Les insights doivent être confirmés par un praticien." />
              </div>
              {quotes && quotes.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                  {quotes.map((q, idx) => (
                    <div key={idx} style={{ fontStyle: 'italic', background: '#F9FAFB', padding: '6px 10px', borderRadius: 6, borderLeft: '2px solid #0D5E6B', color: '#4B5563' }}>
                      "{q.quote}" <span style={{ fontSize: '0.65rem', color: '#9CA3AF' }}>— p.{q.page} ({q.section})</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Reflex Row ─────────────────────────────────────────────────────────────────
function ReflexRow({ name, severity, score }) {
  const severityMap = {
    'Severe': { bg: '#FEE2E2', color: '#991B1B', label: 'Retained (Severe)' },
    'Retained': { bg: '#FEE2E2', color: '#991B1B', label: 'Retained' },
    'Moderate': { bg: '#FEF3C7', color: '#92400E', label: 'Retained (Mod)' },
    'Emerging': { bg: '#FEF3C7', color: '#92400E', label: 'Emerging' },
    'Integrated': { bg: '#D1FAE5', color: '#065F46', label: 'Integrated' },
    'Typical': { bg: '#D1FAE5', color: '#065F46', label: 'Typical' },
  };

  // Try to determine severity from score or severity field
  let sev = severityMap[severity];
  if (!sev && score !== undefined && score !== null && score !== '') {
    const s = parseInt(score);
    if (!isNaN(s)) {
      if (s <= 1) sev = severityMap['Integrated'];
      else if (s <= 2) sev = severityMap['Emerging'];
      else if (s <= 3) sev = severityMap['Moderate'];
      else sev = severityMap['Severe'];
    }
  }
  if (!sev) {
    sev = { bg: '#F3F4F6', color: '#6B7280', label: 'Not Assessed' };
  }

  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '9px 14px', background: '#F9FAFB', borderRadius: 10,
      border: '1px solid #E5E7EB'
    }}>
      <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#374151' }}>{name}</span>
      <span style={{
        fontSize: '0.7rem', fontWeight: 700, padding: '3px 10px', borderRadius: 12,
        background: sev.bg, color: sev.color
      }}>{sev.label}</span>
    </div>
  );
}

// ── Tag Chip ───────────────────────────────────────────────────────────────────
function TagChip({ label, type = 'strength' }) {
  const cleanLabel = typeof label === 'string' ? label.replace(/\s*\([^)]*\)\s*$/, '') : '';
  const isStrength = type === 'strength';
  return (
    <span style={{
      padding: '5px 12px', borderRadius: 16, fontSize: '0.75rem', fontWeight: 600,
      background: isStrength ? '#D1FAE5' : '#FEE2E2',
      color: isStrength ? '#065F46' : '#991B1B',
    }}>
      {cleanLabel || label?.label || label?.title || 'Item'}
    </span>
  );
}

// ── Derived Insight Block ──────────────────────────────────────────────────────
function DerivedInsight({ children }) {
  return (
    <div style={{
      background: '#EEF6F8', borderLeft: '4px solid #1A8FA0', padding: '12px 16px',
      fontSize: '0.82rem', color: '#0D5E6B', borderRadius: '0 10px 10px 0',
      lineHeight: 1.5, marginTop: 12
    }}>
      <strong>AI Cross-Report Insight (DERIVED):</strong> {children}
    </div>
  );
}

// ── 12 Atlas Domains config (for wheel) ─────────────────────────────────────
const ATLAS_DOMAINS = [
  { key: 'domain-1',  label: 'Developmental\nProfile',     icon: <User size={24} color="#10B981" />, color: '#10B981' },
  { key: 'domain-2',  label: 'Academics &\nLearning',      icon: <BookOpen size={24} color="#3B82F6" />, color: '#3B82F6' },
  { key: 'domain-3',  label: 'Behaviour &\nRegulation',    icon: <Activity size={24} color="#A78BFA" />, color: '#A78BFA' },
  { key: 'domain-4',  label: 'Support\nPlan',              icon: <FileText size={24} color="#F59E0B" />, color: '#F59E0B' },
  { key: 'domain-5',  label: 'Sensory',                    icon: <Ear size={24} color="#E8841A" />, color: '#E8841A' },
  { key: 'domain-6',  label: 'Functional\nWellness',       icon: <Heart size={24} color="#10B981" />, color: '#10B981' },
  { key: 'domain-7',  label: 'Genetics',                   icon: <Dna size={24} color="#6B7280" />, color: '#6B7280' },
  { key: 'domain-8',  label: 'Environment',                icon: <Home size={24} color="#22C55E" />, color: '#22C55E' },
  { key: 'domain-9',  label: 'Primitive Motor\nReflexes',   icon: <Activity size={24} color="#EF4444" />, color: '#EF4444' },
  { key: 'domain-10', label: 'Social &\nCommunication',    icon: <MessageCircle size={24} color="#0EA5E9" />, color: '#0EA5E9' },
  { key: 'domain-11', label: 'Brain\nDevelopment',         icon: <Brain size={24} color="#8B5CF6" />, color: '#8B5CF6' },
  { key: 'domain-12', label: 'Daily Living\nSkills',       icon: <Coffee size={24} color="#78716C" />, color: '#78716C' },
];

// ── Atlas 360° Interactive Wheel ─────────────────────────────────────────────
function Atlas360Wheel({ childName, onDomainClick, domainStatuses, childAvatarUrl }) {
  const [hovered, setHovered] = useState(null);
  const cx = 180, cy = 180, outerR = 150, innerR = 60;
  const total = ATLAS_DOMAINS.length;
  const gapAngle = 1.5;
  const segAngle = (360 - total * gapAngle) / total;

  const polarToCart = (angleDeg, r) => {
    const rad = (angleDeg - 90) * (Math.PI / 180);
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };

  const makeArc = (startAngle, endAngle, r) => {
    const s = polarToCart(startAngle, r);
    const e = polarToCart(endAngle, r);
    const large = endAngle - startAngle > 180 ? 1 : 0;
    return `A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
  };

  const segments = ATLAS_DOMAINS.map((d, i) => {
    const start = i * (segAngle + gapAngle);
    const end = start + segAngle;
    const mid = start + segAngle / 2;
    const isHov = hovered === d.key;
    const status = domainStatuses?.[d.key] || 'Not assessed';
    const os = polarToCart(start, outerR);
    const is_ = polarToCart(start, innerR);
    const ie = polarToCart(end, innerR);
    const path = [
      `M ${os.x} ${os.y}`,
      makeArc(start, end, outerR),
      `L ${ie.x} ${ie.y}`,
      `A ${innerR} ${innerR} 0 0 0 ${is_.x} ${is_.y}`,
      'Z'
    ].join(' ');
    const iconR = (outerR + innerR) / 2;
    const iconPos = polarToCart(mid, iconR);
    return { ...d, path, iconPos, mid, start, end, isHov, status };
  });

  return (
    <div style={{
      background: '#fff', borderRadius: 16, border: '1px solid #E5E7EB',
      overflow: 'hidden', marginTop: 16,
    }}>
      <div style={{
        padding: '16px 24px', background: '#F9FAFB', borderBottom: '1px solid #E5E7EB',
        display: 'flex', alignItems: 'center', gap: 10
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10, background: '#EEF6F8',
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <Activity size={18} color="#0D5E6B" />
        </div>
        <div>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#111827', fontFamily: 'Inter, sans-serif' }}>
            Atlas 360° — The Complete Picture
          </h3>
          <p style={{ margin: 0, fontSize: '0.78rem', color: '#6B7280' }}>
            Click any segment to jump to that domain
          </p>
        </div>
      </div>
      <div style={{ padding: 24, background: '#F3F4F6' }}>
        <div style={{ display: 'flex', gap: 32, alignItems: 'flex-start', flexWrap: 'wrap', justifyContent: 'center' }}>
          <svg width="360" height="360" viewBox="0 0 360 360" style={{ flexShrink: 0 }}>
            {segments.map(seg => (
              <g key={seg.key}
                onClick={() => onDomainClick(seg.key)}
                onMouseEnter={() => setHovered(seg.key)}
                onMouseLeave={() => setHovered(null)}
                style={{ cursor: 'pointer' }}
              >
                <path d={seg.path}
                  fill={seg.isHov ? seg.color : `${seg.color}22`}
                  stroke={seg.color}
                  strokeWidth={seg.isHov ? 2.5 : 1.5}
                  style={{ transition: 'fill 0.2s, stroke-width 0.15s' }}
                />
                <g transform={`translate(${seg.iconPos.x - 12}, ${seg.iconPos.y - 12})`} style={{ pointerEvents: 'none' }}>
                  {seg.icon}
                </g>
              </g>
            ))}
            <defs>
              <clipPath id="avatar-clip">
                <circle cx={cx} cy={cy} r={innerR - 4} />
              </clipPath>
            </defs>
            <circle cx={cx} cy={cy} r={innerR - 2} fill="#fff" style={{ pointerEvents: 'none' }} />
            {childAvatarUrl ? (
              <image 
                href={childAvatarUrl} 
                x={cx - (innerR - 4)} 
                y={cy - (innerR - 4)} 
                width={(innerR - 4) * 2} 
                height={(innerR - 4) * 2} 
                clipPath="url(#avatar-clip)"
                preserveAspectRatio="xMidYMid slice"
                style={{ pointerEvents: 'none' }}
              />
            ) : (
              <>
                <text x={cx} y={cy - 8} textAnchor="middle" style={{ fontSize: '0.75rem', fontWeight: 800, fill: '#0D5E6B' }}>Atlas</text>
                <text x={cx} y={cy + 10} textAnchor="middle" style={{ fontSize: '0.7rem', fontWeight: 600, fill: '#9CA3AF' }}>360°</text>
              </>
            )}
          </svg>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 24px', alignSelf: 'center', minWidth: 280 }}>
            {ATLAS_DOMAINS.map(d => {
              const status = domainStatuses?.[d.key] || 'Not assessed';
              return (
                <div key={d.key}
                  onClick={() => onDomainClick(d.key)}
                  onMouseEnter={() => setHovered(d.key)}
                  onMouseLeave={() => setHovered(null)}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '3px 0', transition: 'opacity 0.15s', opacity: hovered && hovered !== d.key ? 0.5 : 1 }}
                >
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: d.color, flexShrink: 0 }} />
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#374151', lineHeight: 1.2 }}>{d.label.replace('\n', ' ')}</span>
                  <span style={{ fontSize: '0.6rem', color: '#9CA3AF', fontStyle: 'italic', marginLeft: 'auto', whiteSpace: 'nowrap' }}>{status}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function AtlasProfileTab({ childId, childName = 'your child', readOnly = false, refreshTrigger = 0, onNavigateTab }) {
  const { t } = useTranslation();
  const { enabled: isAgenticEnabled, loading: isAgenticLoading } = useFeatureFlag('agentic_ai_upload');
  const { enabled: isReportEnabled, loading: isReportLoading } = useFeatureFlag('upload_report');
  const isUploadEnabled = isAgenticEnabled || isReportEnabled;
  const isFlagLoading = isAgenticLoading && isReportLoading;
  const [profile, setProfile] = useState(null);
  const [domainScores, setDomainScores] = useState(null);
  const [questionnaireResponses, setQuestionnaireResponses] = useState(null);
  const [childAge, setChildAge] = useState('Not Assessed');
  const [childDiagnosis, setChildDiagnosis] = useState('Not Assessed');
  const [childAvatarUrl, setChildAvatarUrl] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const [showDeepDive, setShowDeepDive] = useState(false);
  const [showProcessingModal, setShowProcessingModal] = useState(false);
  const [processingDone, setProcessingDone] = useState(false);
  const [processingError, setProcessingError] = useState(false);
  const [deepDiveInitialDomain, setDeepDiveInitialDomain] = useState(null);
  const [analysisTimeoutError, setAnalysisTimeoutError] = useState(false);
  const [deleteConfirmDoc, setDeleteConfirmDoc] = useState(null);

  const isUUID = (str) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
  const DEMO_AKHIL_ID = '00000000-0000-0000-0000-000000000010';
  const isProcessingDoc = documents.some(d => d.status === 'processing');

  const validDocuments = documents.filter(d => ['definitive', 'completed'].includes(d.status));

  useEffect(() => { fetchAtlasData(); }, [childId, refreshTrigger]);

  useEffect(() => {
    let timer;
    if (isProcessingDoc) {
      setAnalysisTimeoutError(false);
      timer = setTimeout(() => setAnalysisTimeoutError(true), 45000);
    } else {
      setAnalysisTimeoutError(false);
    }
    return () => clearTimeout(timer);
  }, [isProcessingDoc]);

  useEffect(() => {
    let intervalId;
    if (isProcessingDoc) {
      intervalId = setInterval(() => { fetchAtlasDataSilent(); }, 5000);
    }
    return () => { if (intervalId) clearInterval(intervalId); };
  }, [isProcessingDoc, childId]);

  const fetchAtlasData = async () => {
    setProfile(null);
    setDomainScores(null);
    setQuestionnaireResponses(null);
    setDocuments([]);
    setChildAge('Not Assessed');
    setChildDiagnosis('Not Assessed');
    setChildAvatarUrl(null);
    setLoading(true);
    await loadData();
    setLoading(false);
  };
  const fetchAtlasDataSilent = async () => { await loadData(); };

  const loadData = async () => {
    try {
      let targetId;
      if (!childId) { targetId = DEMO_AKHIL_ID; }
      else if (isUUID(childId)) { targetId = childId; }
      else { setProfile(null); return; }

      const { data: profilesData, error: profileErr } = await supabase
        .from('atlas_profiles').select('*').eq('child_id', targetId).limit(1);
      if (profileErr) throw profileErr;

      if (profilesData && profilesData.length > 0) {
        setProfile(profilesData[0]);
      } else {
        setProfile(null);
      }

      const { data: childData } = await supabase
        .from('children').select('age, diagnosis, avatar_url').eq('id', targetId).single();
      if (childData) {
        setChildAge(childData.age || 'Not Assessed');
        setChildDiagnosis(childData.diagnosis || 'Not Assessed');
        setChildAvatarUrl(childData.avatar_url || null);
      }

      const { data: docsData, error: docsErr } = await supabase
        .from('documents').select('*').eq('child_id', targetId);
      if (!docsErr && docsData) { setDocuments(docsData); } else { setDocuments([]); }

      // Fetch domain scores
      const { data: scoresData } = await supabase
        .from('atlas_domain_scores')
        .select('*')
        .eq('child_id', targetId)
        .maybeSingle();
      setDomainScores(scoresData);

      // Fetch questionnaire responses
      const { data: qResponsesData } = await supabase
        .from('atlas_questionnaire_responses')
        .select('*')
        .eq('child_id', targetId)
        .maybeSingle();
      setQuestionnaireResponses(qResponsesData);
    } catch (err) {
      console.error(err);
      toast.error(t('atlas.fetchError', 'Failed to load Atlas Profile'));
    }
  };

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    if (documents.length + files.length > 8) {
      toast('Warning: You are merging more than 8 reports total.', { icon: <AlertTriangle size={16} />, duration: 6000 });
    }
    setUploading(true);
    toast.loading(`Uploading ${files.length} document${files.length > 1 ? 's' : ''}...`, { id: 'upload' });

    let successCount = 0;
    const targetChildId = (childId && isUUID(childId)) ? childId : DEMO_AKHIL_ID;

    for (const file of files) {
      try {
        const fileName = `${Date.now()}_${file.name}`;
        const filePath = `demo/${fileName}`;
        const { error: uploadError } = await supabase.storage.from('patient-documents').upload(filePath, file);
        if (uploadError) throw uploadError;

        const { data: docData, error: dbError } = await supabase
          .from('documents')
          .insert([{ child_id: targetChildId, file_name: file.name, file_path: filePath, file_type: 'Other', status: 'processing' }])
          .select()
          .single();
        if (dbError) throw dbError;

        successCount++;
        setShowProcessingModal(true);
        setProcessingDone(false);
        setProcessingError(false);

        supabase.functions.invoke('process-document', {
          body: { child_id: targetChildId, file_path: filePath, document_id: docData.id, operation_type: 'upload' }
        }).then(({ data, error: funcError }) => {
          if (funcError) {
            toast.error(`${t('atlas.processingError', 'AI Pipeline error:')} ${funcError.message}`);
            setProcessingError(true);
          } else if (data && data.success === false) {
            toast.error(data.error || `Could not process ${file.name}`, { duration: 8000, icon: <AlertTriangle size={16} color="#EF4444" />, style: { maxWidth: '500px', fontSize: '0.9rem', lineHeight: '1.4' } });
            setProcessingError(true);
          } else {
            setProcessingDone(true);
            fetchAtlasData();
          }
        }).catch(err => {
          toast.error(`${t('atlas.processingError', 'Pipeline error:')} ${err.message}`);
          setProcessingError(true);
        });
      } catch (err) {
        console.error(`Failed to upload ${file.name}:`, err);
        toast.error(`Upload failed for ${file.name}: ${err.message}`);
      }
    }

    if (successCount > 0) {
      toast.success(`${successCount} document${successCount > 1 ? 's' : ''} uploaded! 6 AI Agents are now analyzing...`, { id: 'upload' });
    }
    e.target.value = '';
    setTimeout(fetchAtlasData, 3000);
    setUploading(false);
  };

  const handleDeleteDocument = (docId, filePath) => {
    setDeleteConfirmDoc({ id: docId, filePath });
  };

  const executeDeleteDocument = async (docId, filePath) => {
    const tId = toast.loading('Deleting document & cleaning up data...');
    try {
      // 1. Get the session token explicitly to prevent authorization issues
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      // 2. Call the new transactional Edge Function Delete Service with token
      const { data, error } = await supabase.functions.invoke('delete-document', {
        body: { document_id: docId },
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      
      if (error || (data && data.success === false)) {
        throw new Error(data?.error || error?.message || 'Unable to delete report.');
      }

      // 3. Update UI Local State
      const remainingDocs = documents.filter(d => d.id !== docId);
      setDocuments(remainingDocs);
      
      // Clear profile temporarily as it was wiped from DB to prevent ghosts
      setProfile(null);
      
      const successMsg = data.message || 'Report deleted successfully.';
      const targetChildId = (childId && isUUID(childId)) ? childId : DEMO_AKHIL_ID;
      
      if (remainingDocs.length > 0) {
        toast.success(`${successMsg} Re-analyzing remaining reports...`, { id: tId });
        setDocuments(remainingDocs.map(d => ({ ...d, status: 'processing' })));
        
        // Fire and forget re-analysis
        Promise.allSettled(remainingDocs.map(doc => 
          supabase.functions.invoke('process-document', {
            body: { child_id: targetChildId, file_path: doc.file_path, document_id: doc.id, operation_type: 'refresh' }
          })
        )).then(() => {
          fetchAtlasData();
        });
      } else {
        toast.success(`${successMsg} No validated reports available.`, { id: tId });
        fetchAtlasData();
      }
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Unable to delete report.', { id: tId });
    }
  };

  // ── Helper: extract text from profile items ──────────────────────────────────
  const getItemLabel = (item) => {
    if (typeof item === 'string') return item;
    if (item?.label) return item.label;
    if (item?.title) {
      if (item.description) return `${item.title}: ${item.description}`;
      return item.title;
    }
    if (item?.name) return item.name;
    if (item?.time) {
      const dur = item.duration_min ? ` (${item.duration_min} min)` : '';
      const rat = item.rationale ? ` - Rationale: ${item.rationale}` : '';
      return `${item.time}: ${item.activity || ''}${dur}${rat}`;
    }
    return 'Assessed';
  };

  // ── Derived data ─────────────────────────────────────────────────────────────
  const hasValidatedDocs = validDocuments.length > 0 || (profile && profile.completeness_percentage > 0);
  const hasQuestionnaire = questionnaireResponses !== null;
  const sourceText = (validDocuments.length === 0 && hasQuestionnaire)
    ? t('atlas.profileFromQuestionnaire', 'Profile built from Atlas 360° questionnaire')
    : `${t('atlas.synthesizedFrom', 'AI-synthesized profile from')} ${validDocuments.length} ${t('atlas.docs', 'uploaded document')}${validDocuments.length !== 1 ? 's' : ''}`;
  const homePlan = hasValidatedDocs ? (profile?.home_plan || {}) : {};
  const supportPlanText = domainScores?.d12_support_plan || homePlan?.support_plan || '';

  const strengthsListRaw = hasValidatedDocs && Array.isArray(profile?.strengths) ? profile.strengths : [];
  const challengesListRaw = hasValidatedDocs && Array.isArray(profile?.challenges) ? profile.challenges : [];

  // Filter overlapping items. If an item is in both, remove it from Strengths.
  // Also specifically exclude any label containing "non-verbal" or "non verbal" from strengths.
  const lowercaseChallenges = challengesListRaw.map(c => getItemLabel(c).toLowerCase().trim());
  const strengthsList = strengthsListRaw.filter(s => {
    const label = getItemLabel(s).toLowerCase().trim();
    if (label.includes('non-verbal') || label.includes('non verbal')) return false;
    return !lowercaseChallenges.includes(label);
  });
  const challengesList = challengesListRaw;

  const academicItems = hasValidatedDocs ? [...strengthsList.filter(s => s.domain === 'Academic'), ...challengesList.filter(c => c.domain === 'Academic')] : [];
  const behavioralItems = hasValidatedDocs ? [...strengthsList.filter(s => s.domain?.startsWith('Behavior') || s.domain?.startsWith('Behaviour')), ...challengesList.filter(c => c.domain?.startsWith('Behavior') || c.domain?.startsWith('Behaviour'))] : [];
  const geneticItems = hasValidatedDocs ? [...strengthsList.filter(s => s.domain === 'Genetic'), ...challengesList.filter(c => c.domain === 'Genetic')] : [];
  const environmentItems = hasValidatedDocs ? [...strengthsList.filter(s => s.domain === 'Environment'), ...challengesList.filter(c => c.domain === 'Environment')] : [];
  const brainItems = hasValidatedDocs ? [...strengthsList.filter(s => s.domain === 'Brain'), ...challengesList.filter(c => c.domain === 'Brain')] : [];
  const dailyLivingItems = hasValidatedDocs ? [...strengthsList.filter(s => s.domain === 'DailyLiving'), ...challengesList.filter(c => c.domain === 'DailyLiving')] : [];

  const getDomainScore = (domainKeys) => {
    if (!profile) return null;
    const sCount = strengthsList.filter(s => domainKeys.some(k => s.domain?.startsWith(k))).length;
    const cCount = challengesList.filter(c => domainKeys.some(k => c.domain?.startsWith(k))).length;
    if (sCount === 0 && cCount === 0) return null;
    const ratio = sCount / (sCount + cCount);
    return Math.max(20, Math.round(ratio * 100));
  };

  let socialScore = getDomainScore(['Social', 'Communication', 'Behavior']);
  let dailyLivingScore = getDomainScore(['DailyLiving', 'Environment']);
  let academicScore = getDomainScore(['Academic', 'Learning']);
  let sensoryScore = getDomainScore(['Sensory', 'Motor', 'Brain']);
  let compositeScore = null;
  let completenessVal = profile?.completeness_percentage || 0;

  if (domainScores) {
    socialScore = domainScores.d2_score;
    dailyLivingScore = domainScores.d9_score;
    academicScore = domainScores.d3_score;
    
    const hasD5 = domainScores.d5_score !== null;
    const hasD7 = domainScores.d7_score !== null;
    if (hasD5 && hasD7) {
      sensoryScore = Math.round((domainScores.d5_score + domainScores.d7_score) / 2);
    } else if (hasD5) {
      sensoryScore = domainScores.d5_score;
    } else if (hasD7) {
      sensoryScore = domainScores.d7_score;
    } else {
      sensoryScore = null;
    }

    compositeScore = domainScores.composite_score;

    const scoredDomains = [
      domainScores.d2_score,
      domainScores.d3_score,
      domainScores.d4_score,
      domainScores.d5_score,
      domainScores.d6_score,
      domainScores.d7_score,
      domainScores.d8_score,
      domainScores.d9_score
    ];
    const nonNullCount = scoredDomains.filter(s => s !== null).length;
    completenessVal = Math.round((nonNullCount / 8) * 100);
  } else {
    const validScores = [socialScore, dailyLivingScore, academicScore, sensoryScore].filter(s => s !== null);
    compositeScore = validScores.length > 0
      ? Math.round(validScores.reduce((a, b) => a + b, 0) / validScores.length) : null;
  }

  const scores = { social: socialScore, dailyLiving: dailyLivingScore, academic: academicScore, sensory: sensoryScore, composite: compositeScore };

  const isValidAIExtraction = (val) => {
    if (val === null || val === undefined || val === '') return false;
    if (Array.isArray(val) && val.length === 0) return false;
    if (typeof val === 'string') {
      const lower = val.toLowerCase();
      if (lower === 'unknown' || lower === 'not assessed' || lower === 'not applicable' || lower === 'n/a' || lower === 'none') return false;
      if (lower.includes('no specific') && lower.includes('information')) return false;
      if (lower.includes('not available')) return false;
    }
    return true;
  };

  // ── Communication profile helper ─────────────────────────────────────────────
  const commProfile = profile?.communication_profile || {};
  const commItems = Object.entries(commProfile)
    .filter(([key, val]) => key !== 'score' && key !== 'band' && isValidAIExtraction(val))
    .map(([key, val]) => {
      const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      const displayVal = Array.isArray(val) ? val.join(', ') : typeof val === 'object' ? JSON.stringify(val) : val;
      return `${label}: ${displayVal}`;
    });

  // ── Sensory profile helper ───────────────────────────────────────────────────
  const sensoryProfile = profile?.sensory_profile || {};
  const sensoryItems = Object.entries(sensoryProfile)
    .filter(([key, val]) => key !== 'score' && key !== 'band' && isValidAIExtraction(val))
    .map(([key, val]) => {
      const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      const displayVal = Array.isArray(val) ? val.join(', ') : typeof val === 'object' ? JSON.stringify(val) : val;
      return `${label}: ${displayVal}`;
    });

  // ── Home plan helper ─────────────────────────────────────────────────────────
  const routineItems = Array.isArray(homePlan.daily_routine)
    ? homePlan.daily_routine.filter(item => item && (item.activity || item.time))
    : [];

  // ── Functional wellness helper ───────────────────────────────────────────────
  const rawWellness = Array.isArray(profile?.functional_wellness) ? profile.functional_wellness : [];
  const wellnessItems = rawWellness.filter(item => {
    if (!item) return false;
    if (typeof item === 'object') {
      if (item.name === 'score' || item.name === 'band') return false;
      if (!item.status || item.status === 'Not sure' || item.status === 'Not assessed' || item.status === 'Unknown') return false;
      if (item.label && (item.label.includes('Not sure') || item.label.includes('Not assessed'))) return false;
    }
    if (typeof item === 'string') {
      const lower = item.toLowerCase();
      if (lower === 'score' || lower === 'band' || lower.includes('not sure') || lower.includes('not assessed') || lower === 'unknown') return false;
    }
    return true;
  });

  // ── Motor reflexes helper ────────────────────────────────────────────────────
  const rawMotor = Array.isArray(profile?.motor_reflexes) ? profile.motor_reflexes : [];
  const motorReflexes = rawMotor.filter(item => {
    if (!item) return false;
    if (typeof item === 'object') {
      if (item.name === 'score' || item.name === 'band') return false;
      if (item.status === 'Not sure' || item.status === 'Not assessed' || item.status === 'Unknown') return false;
    }
    if (typeof item === 'string') {
      const lower = item.toLowerCase();
      if (lower === 'score' || lower === 'band' || lower.includes('not sure') || lower.includes('not assessed')) return false;
    }
    return true;
  });

  // ── Card Evidence and Source helper ──────────────────────────────────────────
  const getCardEvidenceAndSource = (domainKey) => {
    if (!validDocuments || validDocuments.length === 0) {
      return { source: 'Evidence Required', quotes: [] };
    }

    const keywordMap = {
      'domain-1': ['development', 'cognitive', 'behavior', 'regulation', 'strength', 'challenge', 'verbal', 'motor'],
      'domain-4': ['support', 'iep', 'plan', 'routine', 'schedule', 'home', 'diet'],
      'domain-5': ['sensory', 'sound', 'light', 'touch', 'auditory', 'tactile', 'proprioceptive', 'vestibular'],
      'domain-6': ['wellness', 'medical', 'sleep', 'diet', 'health', 'physical'],
      'domain-9': ['reflex', 'motor', 'movement', 'moro', 'atnr', 'stnr', 'tlr', 'grasp'],
      'domain-10': ['speech', 'comm', 'language', 'verbal', 'vocal', 'talk', 'social', 'non-verbal', 'non verbal']
    };

    const keywords = keywordMap[domainKey] || [];
    const matchedQuotes = [];
    const sourceDocs = new Set();

    validDocuments.forEach(doc => {
      sourceDocs.add(doc.file_name);

      const metrics = doc.validation_metrics;
      if (metrics) {
        const evidenceList = [
          ...(metrics.positive_evidence || []),
          ...(metrics.negative_evidence || [])
        ];

        evidenceList.forEach(ev => {
          const textToSearch = `${ev.quote || ''} ${ev.section || ''} ${ev.justification || ''}`.toLowerCase();
          const matches = keywords.some(kw => textToSearch.includes(kw));
          if (matches) {
            matchedQuotes.push({
              fileName: doc.file_name,
              page: ev.page || 1,
              section: ev.section || 'General',
              quote: ev.quote
            });
          }
        });
      }
    });

    return {
      source: Array.from(sourceDocs).join(', '),
      quotes: matchedQuotes.slice(0, 2)
    };
  };

  const domainChecks = [
    strengthsList.length > 0 || challengesList.length > 0,
    academicItems.length > 0,
    behavioralItems.length > 0,
    routineItems.length > 0,
    sensoryItems.length > 0,
    wellnessItems.length > 0,
    geneticItems.length > 0,
    environmentItems.length > 0,
    motorReflexes.length > 0,
    commItems.length > 0,
    brainItems.length > 0,
    dailyLivingItems.length > 0,
  ];
  
  const assessedCount = domainChecks.filter(Boolean).length;
  const missingCount = 12 - assessedCount;
  const missingPercentage = Math.round((missingCount / 12) * 100);
  const completeness = domainScores ? completenessVal : (profile ? 100 - missingPercentage : 0);
  const isIncomplete = completeness < 100;

  useEffect(() => {
    if (profile && completeness !== profile.completeness_percentage) {
      const targetChildId = (childId && isUUID(childId)) ? childId : DEMO_AKHIL_ID;
      supabase.from('atlas_profiles').update({ completeness_percentage: completeness }).eq('child_id', targetChildId)
        .then(() => {
          supabase.from('children').update({ completeness_percentage: completeness }).eq('id', targetChildId);
        });
    }
  }, [profile, completeness, childId]);

  return (
    <>
      <AIEngineProcessingModal
        isOpen={showProcessingModal}
        isDone={processingDone}
        hasError={processingError}
        onClose={() => setShowProcessingModal(false)}
      />

      <style>{`
        .atlas-insights-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
          padding: 24px;
          background: #F3F4F6;
        }
        .atlas-scores-row {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 16px;
          padding: 20px 24px;
        }
        .atlas-docs-grid {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        @media (max-width: 768px) {
          .atlas-insights-grid {
            grid-template-columns: 1fr !important;
          }
          .atlas-scores-row {
            gap: 10px;
          }
        }
      `}</style>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center' }}>{t('atlas.loading', 'Loading Atlas Profile...')}</div>
      ) : (
        <div style={{ padding: '20px 0' }}>

          {isProcessingDoc ? (
              /* ── AI Processing State ── */
              <div className="card" style={{
                padding: '60px 40px', textAlign: 'center',
                background: 'linear-gradient(to bottom, #fff, #F8FAFB)',
                borderRadius: 24, border: '1.5px solid #C8E8ED',
                boxShadow: '0 10px 30px rgba(13,94,107,0.05)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20
              }}>
                <div style={{
                  width: 80, height: 80, borderRadius: 24, background: '#EEF6F8', border: '2px solid #C8E8ED',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto'
                }}>
                  <span style={{ animation: 'pulseGlow 2s infinite' }}><Brain size={32} color="#0D5E6B" /></span>
                </div>
                <h3 style={{ color: '#0D5E6B', fontSize: '1.5rem', fontWeight: 800, margin: 0 }}>
                  {t('atlas.aiAnalyzing', 'AI Engine Analyzing Reports...')}
                </h3>
                <p style={{ color: '#4B5563', maxWidth: 460, margin: 0, fontSize: '0.9rem', lineHeight: 1.6 }}>
                  {t('atlas.pipelineExplanation', 'Our 6-agent cognitive pipeline is processing your uploaded documents to extract strengths, challenges, primitive motor reflexes, and daily routine strategies.')}
                </p>
                <div style={{
                  background: '#fff', border: '1px solid #E5E7EB', borderRadius: 16,
                  width: '100%', maxWidth: 440, padding: 16, textAlign: 'left',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.02)'
                }}>
                  <div style={{ fontWeight: 700, fontSize: '0.8rem', color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
                    {t('atlas.docsAnalyzing', 'Documents Being Analyzed')} ({documents.filter(d => d.status === 'processing').length})
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {documents.filter(d => d.status === 'processing').map(d => (
                      <div key={d.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: '#F8FAFB', borderRadius: 10, border: '1px solid #E5E7EB' }}>
                        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '240px' }}>
                          📄 {d.file_name}
                        </span>
                        <span style={{
                          background: '#FEF3C7', color: '#92400E', padding: '3px 8px', borderRadius: 20,
                          fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em',
                          display: 'flex', alignItems: 'center', gap: 6
                        }}>
                          <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5, borderColor: '#FEF3C7', borderTopColor: '#92400E', display: 'inline-block' }} />
                          {t('atlas.aiAnalyzingStatus', 'AI Analyzing')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                {analysisTimeoutError ? (
                  <div style={{ marginTop: 20, textAlign: 'center' }}>
                    <div style={{ color: '#991B1B', background: '#FEE2E2', padding: '12px 20px', borderRadius: 12, display: 'inline-block', marginBottom: 16, fontSize: '0.85rem', fontWeight: 600 }}>
                      ⚠️ {t('atlas.timeoutError', 'Analysis took longer than expected. It might be stuck.')}
                    </div>
                    <div>
                      <button onClick={() => {
                        setAnalysisTimeoutError(false);
                        fetchAtlasData();
                      }} style={{ background: '#0D5E6B', color: '#fff', padding: '10px 20px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}>
                        {t('atlas.refreshStatus', 'Refresh Status')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: '0.78rem', color: '#9CA3AF', fontStyle: 'italic', marginTop: 8 }}>
                    {t('atlas.autoRefresh', 'This usually takes 15-30 seconds. The page will automatically refresh.')}
                  </div>
                )}
                <style>{`
                  @keyframes pulseGlow {
                    0% { transform: scale(1); opacity: 0.8; }
                    50% { transform: scale(1.05); opacity: 1; }
                    100% { transform: scale(1); opacity: 0.8; }
                  }
                `}</style>
              </div>
          ) : (
            <>
              {/* ════════════════════════════════════════════════════════════════
                   CHILD PROFILE INSIGHTS LAYOUT (Inspired by OT Atlas)
                 ════════════════════════════════════════════════════════════════ */}

              <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #E5E7EB', overflow: 'hidden' }}>

                {/* ── Header Bar ── */}
                <div style={{
                  padding: '20px 24px', background: '#F9FAFB', borderBottom: '1px solid #E5E7EB',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  flexWrap: 'wrap', gap: 14
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{
                      width: 44, height: 44, borderRadius: 12, background: '#EEF6F8',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      boxShadow: '0 2px 8px rgba(13,94,107,0.1)'
                    }}>
                      <Brain size={22} color="#0D5E6B" />
                    </div>
                    <div>
                      <h2 style={{
                        fontFamily: 'Inter, sans-serif', fontSize: '1.2rem', fontWeight: 800,
                        color: '#111827', margin: '0 0 2px 0'
                      }}>
                        NestureAI Atlas — {childName}
                      </h2>
                      <p style={{ fontSize: '0.8rem', color: '#6B7280', margin: 0 }}>
                        {sourceText}
                        {completeness > 0 && ` · ${completeness}% ${t('atlas.complete', 'complete')}`}
                        {profile?.last_updated_at && ` · Last updated: ${new Date(profile.last_updated_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`}
                      </p>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <button onClick={async () => {
                      if (profile) {
                        toast.loading(t('atlas.genPDF', 'Generating PDF...'), { id: 'pdf-gen' });
                        try {
                          await generateAtlasProfileReport({ profile, childName, scores, childAge, childDiagnosis, childAvatarUrl, documentsCount: documents.length });
                          toast.success(t('atlas.pdfDownloaded', 'PDF downloaded!'), { id: 'pdf-gen' });
                        } catch (err) { 
                          console.error(err);
                          toast.error(`${t('atlas.pdfError', 'PDF Error:')} ${err.message || String(err)}`, { id: 'pdf-gen', duration: 10000 }); 
                        }
                      } else { toast.error(t('atlas.noData', 'No profile data to download yet.')); }
                    }} style={{
                      background: '#EEF6F8', color: '#0D5E6B', border: '1px solid #C8E8ED',
                      padding: '8px 14px', borderRadius: 10, cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem',
                      display: 'flex', alignItems: 'center', gap: 6
                    }}>
                      <Download size={14} /> PDF
                    </button>
                    {(isUploadEnabled || validDocuments.length > 0) && (
                      <button onClick={() => setShowDeepDive(true)} style={{
                        background: '#fff', color: '#0D5E6B', border: '1px solid #E5E7EB',
                        padding: '8px 14px', borderRadius: 10, cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem'
                      }}>
                        {t('atlas.deepDive', 'Deep Dive')}
                      </button>
                    )}
                    {!readOnly && !isFlagLoading && isUploadEnabled && (
                      <label style={{
                        background: '#0D5E6B', color: '#fff', padding: '8px 14px', borderRadius: 10,
                        border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem',
                        display: 'inline-flex', alignItems: 'center', gap: 6
                      }}>
                        <Plus size={14} /> {t('atlas.uploadReport', 'Upload Report')}
                        <input
                          type="file"
                          accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,application/pdf,image/jpeg,image/png,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                          multiple
                          style={{ display: 'none' }}
                          onChange={handleFileUpload}
                          disabled={uploading}
                        />
                      </label>
                    )}
                  </div>
                </div>

                {/* ── Processing Banner ── */}
                {isProcessingDoc && (
                  <div style={{
                    background: '#EEF6F8', borderBottom: '1px solid #C8E8ED', padding: '12px 24px',
                    display: 'flex', alignItems: 'center', gap: 12, fontSize: '0.85rem', color: '#0D5E6B',
                  }}>
                    <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2, borderColor: '#EEF6F8', borderTopColor: '#0D5E6B', flexShrink: 0, display: 'inline-block' }} />
                    <div style={{ flex: 1 }}>
                      <strong>⚡ {t('atlas.processingUpdate', 'AI Engine Update in Progress')}</strong> — {t('atlas.willAutoUpdate', 'Profile below will automatically update with new insights.')}
                    </div>
                  </div>
                )}

                {/* ── Incomplete Banner ── */}
                {isIncomplete && !isProcessingDoc && (
                  <div style={{
                    background: '#FEF3C7', borderBottom: '1px solid #FDE68A', padding: '10px 24px',
                    display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.82rem', color: '#92400E'
                  }}>
                    <AlertTriangle size={16} color="#F59E0B" />
                    <span><strong>{t('atlas.profileIncomplete', 'Profile Incomplete')} ({missingPercentage}% {t('atlas.missing', 'missing')})</strong> — {t('atlas.uploadMore', 'Upload additional documents to improve coverage.')}</span>
                  </div>
                )}

                {/* ── Score Snapshot — Horizontal KPI Bar ── */}
                <div style={{ borderBottom: '1px solid #E5E7EB', background: '#fff' }}>
                  <div className="atlas-scores-row">
                    <CircularGauge label={t('atlas.scoreSocial', 'Social & Communication')} value={scores.social} color="#0EA5E9" />
                    <CircularGauge label={t('atlas.scoreDaily', 'Daily Living')} value={scores.dailyLiving} color="#10B981" />
                    <CircularGauge label={t('atlas.scoreAcademic', 'Academic & Learning')} value={scores.academic} color="#3B82F6" />
                    <CircularGauge label={t('atlas.scoreSensory', 'Sensory & Motor')} value={scores.sensory} color="#E8841A" />
                    <div style={{ width: 1, background: '#E5E7EB', alignSelf: 'stretch', margin: '0 8px' }} />
                    <CircularGauge label={t('atlas.scoreComposite', 'Composite Score')} value={scores.composite} color="#8B5CF6" />
                  </div>
                  {/* Profile Completeness slim bar */}
                  <div style={{ padding: '0 24px 14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#6B7280' }}>{t('atlas.completeness', 'Profile Completeness')}</span>
                      <span style={{ fontSize: '0.72rem', fontWeight: 800, color: completeness >= 100 ? '#10B981' : '#F59E0B' }}>{completeness}%</span>
                    </div>
                    <div style={{ width: '100%', background: '#F3F4F6', borderRadius: 4, height: 5, overflow: 'hidden' }}>
                      <div style={{ width: `${completeness}%`, background: completeness >= 100 ? '#10B981' : '#F59E0B', height: '100%', borderRadius: 4, transition: 'width 0.6s ease' }} />
                    </div>
                  </div>
                </div>

                {/* ── Atlas 360° Wheel (Visual exploration) ── */}
                <Atlas360Wheel
                  childName={childName}
                  childAvatarUrl={childAvatarUrl}
                  onDomainClick={(key) => {
                    const domainToElementId = {
                      'domain-1': 'domain-1',
                      'domain-2': 'domain-1',
                      'domain-3': 'domain-1',
                      'domain-4': 'domain-4',
                      'domain-5': 'domain-5',
                      'domain-6': 'domain-6',
                      'domain-7': 'domain-1',
                      'domain-8': 'domain-1',
                      'domain-9': 'domain-9',
                      'domain-10': 'domain-10',
                      'domain-11': 'domain-1',
                      'domain-12': 'domain-1',
                    };
                    const targetId = domainToElementId[key] || key;
                    const element = document.getElementById(targetId);
                    if (element) {
                      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      const originalShadow = element.style.boxShadow;
                      element.style.boxShadow = '0 0 0 4px rgba(13, 94, 107, 0.4)';
                      setTimeout(() => {
                        element.style.boxShadow = originalShadow;
                      }, 1500);
                    }
                  }}
                  domainStatuses={{
                    'domain-1': (questionnaireResponses !== null) ? t('atlas.statusAssessed', 'Assessed') : ((strengthsList.length > 0 || challengesList.length > 0) ? t('atlas.statusAssessed', 'Assessed') : 'Not Assessed'),
                    'domain-2': (domainScores && domainScores.d3_score !== null) ? t('atlas.statusAssessed', 'Assessed') : (academicItems.length > 0 ? t('atlas.statusAssessed', 'Assessed') : 'Not Assessed'),
                    'domain-3': (domainScores && domainScores.d4_score !== null) ? t('atlas.statusAssessed', 'Assessed') : (behavioralItems.length > 0 ? t('atlas.statusAssessed', 'Assessed') : 'Not Assessed'),
                    'domain-4': (domainScores && domainScores.d12_support_plan) ? t('atlas.statusAssessed', 'Assessed') : (routineItems.length > 0 ? t('atlas.statusAssessed', 'Assessed') : 'Not Assessed'),
                    'domain-5': (domainScores && domainScores.d5_score !== null) ? t('atlas.statusAssessed', 'Assessed') : (sensoryItems.length > 0 ? t('atlas.statusAssessed', 'Assessed') : 'Not Assessed'),
                    'domain-6': (domainScores && domainScores.d6_score !== null) ? t('atlas.statusAssessed', 'Assessed') : (wellnessItems.length > 0 ? t('atlas.statusAssessed', 'Assessed') : 'Not Assessed'),
                    'domain-7': (questionnaireResponses !== null) ? t('atlas.statusAssessed', 'Assessed') : (geneticItems.length > 0 ? t('atlas.statusAssessed', 'Assessed') : 'Not Assessed'),
                    'domain-8': (questionnaireResponses !== null) ? t('atlas.statusAssessed', 'Assessed') : (environmentItems.length > 0 ? `${Math.round(completeness * 0.6)}% Partial` : 'Not Assessed'),
                    'domain-9': (domainScores && domainScores.d7_score !== null) ? t('atlas.statusAssessed', 'Assessed') : (motorReflexes.length > 0 ? t('atlas.statusAssessed', 'Assessed') : 'Not Assessed'),
                    'domain-10': (domainScores && domainScores.d2_score !== null) ? t('atlas.statusAssessed', 'Assessed') : (commItems.length > 0 ? t('atlas.statusAssessed', 'Assessed') : 'Not Assessed'),
                    'domain-11': (domainScores && domainScores.d8_score !== null) ? t('atlas.statusAssessed', 'Assessed') : (brainItems.length > 0 ? t('atlas.statusAssessed', 'Assessed') : 'Not Assessed'),
                    'domain-12': (domainScores && domainScores.d9_score !== null) ? t('atlas.statusAssessed', 'Assessed') : (dailyLivingItems.length > 0 ? t('atlas.statusAssessed', 'Assessed') : 'Not Assessed'),
                  }}
                />

                {/* ── Direct Shortcuts Banners (NestureConnect & NestureLearn) ── */}
                {!readOnly && (
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 16,
                    padding: '0 24px 24px',
                    background: '#fff'
                  }}>
                    <motion.div 
                      whileHover={{ y: -4, boxShadow: '0 12px 28px rgba(13,94,107,0.12)' }}
                      transition={{ duration: 0.2 }}
                      style={{
                        background: 'linear-gradient(135deg, #FFF, #F0FAFB)',
                        border: '1.5px solid #C8E8ED',
                        borderRadius: 16,
                        padding: 20,
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        boxShadow: '0 4px 16px rgba(13,94,107,0.04)'
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                          <div style={{
                            width: 38, height: 38, borderRadius: 10, background: '#EEF6F8',
                            display: 'flex', alignItems: 'center', justifyContent: 'center'
                          }}>
                            <Sparkles size={20} color="#0D5E6B" />
                          </div>
                          <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: '#0D5E6B', fontFamily: 'Inter, sans-serif' }}>{t('atlas.nestureConnect', 'NestureConnect')}</h4>
                        </div>
                        <p style={{ margin: '0 0 16px', fontSize: '0.82rem', color: '#4B5563', lineHeight: 1.5 }}>
                          {t('atlas.connectDesc', 'Link an OT or therapist to share session reports, request tailored exercises, and coordinate care plans.')}
                        </p>
                      </div>
                      <button 
                        onClick={() => onNavigateTab && onNavigateTab('connect')}
                        style={{
                          alignSelf: 'flex-start',
                          background: '#0D5E6B',
                          color: '#fff',
                          border: 'none',
                          padding: '8px 16px',
                          borderRadius: 8,
                          fontSize: '0.8rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          boxShadow: '0 2px 8px rgba(13,94,107,0.2)'
                        }}
                      >
                        {t('atlas.findSpecialists', 'Find Specialists')} <ChevronRight size={14} />
                      </button>
                    </motion.div>

                    <motion.div 
                      whileHover={{ y: -4, boxShadow: '0 12px 28px rgba(232,132,26,0.1)' }}
                      transition={{ duration: 0.2 }}
                      style={{
                        background: 'linear-gradient(135deg, #FFF, #FFFBEB)',
                        border: '1.5px solid #FDE68A',
                        borderRadius: 16,
                        padding: 20,
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        boxShadow: '0 4px 16px rgba(232,132,26,0.04)'
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                          <div style={{
                            width: 38, height: 38, borderRadius: 10, background: '#FFFDF2',
                            display: 'flex', alignItems: 'center', justifyContent: 'center'
                          }}>
                            <BookOpen size={20} color="#E8841A" />
                          </div>
                          <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: '#E8841A', fontFamily: 'Inter, sans-serif' }}>{t('atlas.nestureLearn', 'NestureLearn')}</h4>
                        </div>
                        <p style={{ margin: '0 0 16px', fontSize: '0.82rem', color: '#4B5563', lineHeight: 1.5 }}>
                          {t('atlas.learnDesc', 'Access articles, guidelines, and educational content curated specifically for your child\'s developmental milestones.')}
                        </p>
                      </div>
                      <button 
                        onClick={() => onNavigateTab && onNavigateTab('learn')}
                        style={{
                          alignSelf: 'flex-start',
                          background: '#E8841A',
                          color: '#fff',
                          border: 'none',
                          padding: '8px 16px',
                          borderRadius: 8,
                          fontSize: '0.8rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          boxShadow: '0 2px 8px rgba(232,132,26,0.2)'
                        }}
                      >
                        {t('atlas.startLearning', 'Start Learning')} <ChevronRight size={14} />
                      </button>
                    </motion.div>
                  </div>
                )}

                {/* ── 2-Column Profile Cards Grid ── */}
                <div className="atlas-insights-grid">

                  {/* ─── LEFT COLUMN ─── */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                    {/* Communication Profile */}
                    {(() => {
                      const evidence = getCardEvidenceAndSource('domain-10');
                      return (
                        <ProfileCard title={t('atlas.commProfile', 'Communication Profile')} icon={<MessageCircle size={16} color="#0EA5E9" />} color="#0EA5E9" badge={(isUploadEnabled && validDocuments.length > 0 && commItems.length > 0) ? t('atlas.validated', 'VALIDATED') : null} badgeColor="dark" id="domain-10" source={evidence.source} quotes={evidence.quotes} showSourceFooter={isUploadEnabled}>
                          {commItems.length > 0 ? (
                            <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
                              {commItems.slice(0, 5).map((item, i) => <li key={i}>{item}</li>)}
                            </ul>
                          ) : (
                            <p style={{ color: '#6B7280', fontStyle: 'italic', margin: 0 }}>Not Assessed</p>
                          )}
                        </ProfileCard>
                      );
                    })()}

                    {/* Strengths & Challenges */}
                    {(() => {
                      const evidence = getCardEvidenceAndSource('domain-1');
                      return (
                        <div style={{ display: 'flex', gap: 16 }}>
                          <ProfileCard title={t('atlas.strengths', 'Strengths')} icon={<Target size={16} color="#10B981" />} color="#10B981" id="domain-1" source={evidence.source} quotes={evidence.quotes} showSourceFooter={isUploadEnabled}>
                            {strengthsList.length > 0 ? (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                {strengthsList.slice(0, 6).map((s, i) => <TagChip key={i} label={getItemLabel(s)} type="strength" />)}
                              </div>
                            ) : (
                              <p style={{ color: '#6B7280', fontStyle: 'italic', margin: 0 }}>Not Assessed</p>
                            )}
                          </ProfileCard>
                          <ProfileCard title={t('atlas.challenges', 'Challenges')} icon={<AlertTriangle size={16} color="#EF4444" />} color="#EF4444" source={evidence.source} quotes={evidence.quotes} showSourceFooter={isUploadEnabled}>
                            {challengesList.length > 0 ? (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                {challengesList.slice(0, 6).map((c, i) => <TagChip key={i} label={getItemLabel(c)} type="challenge" />)}
                              </div>
                            ) : (
                              <p style={{ color: '#6B7280', fontStyle: 'italic', margin: 0 }}>Not Assessed</p>
                            )}
                          </ProfileCard>
                        </div>
                      );
                    })()}

                    {/* Support Plan / Home Routine */}
                    {(() => {
                      const evidence = getCardEvidenceAndSource('domain-4');
                      return (
                        <ProfileCard title={t('atlas.homeRoutine', 'Support Plan & Home Routine')} icon={<Home size={16} color="#F59E0B" />} color="#F59E0B" badge={(isUploadEnabled && validDocuments.length > 0 && (routineItems.length > 0 || supportPlanText)) ? t('atlas.validated', 'VALIDATED') : null} badgeColor="dark" id="domain-4" source={evidence.source} quotes={evidence.quotes} showSourceFooter={isUploadEnabled}>
                          {supportPlanText && (
                            <div style={{ marginBottom: 16, background: '#FFFDF5', border: '1px solid #FDE68A', padding: '14px 18px', borderRadius: 10, color: '#92400E', fontSize: '0.82rem', lineHeight: 1.6 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, marginBottom: 6 }}>
                                <Sparkles size={14} color="#F59E0B" />
                                {t('atlas.supportPlanTitle', 'Personalized Support Plan')}
                              </div>
                              <p style={{ margin: 0, fontStyle: 'italic', color: '#78350F' }}>{supportPlanText}</p>
                            </div>
                          )}
                          {routineItems.length > 0 ? (
                            <>
                              <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
                                {routineItems.slice(0, 5).map((item, i) => (
                                  <li key={i}>{getItemLabel(item)}</li>
                                ))}
                              </ul>
                              {isUploadEnabled && validDocuments.length > 1 && homePlan.sensory_diet && (
                                <DerivedInsight>
                                  {t('atlas.sensoryDiet', 'Sensory diet recommendation:')} {typeof homePlan.sensory_diet === 'string' ? homePlan.sensory_diet : ''}
                                </DerivedInsight>
                              )}
                            </>
                          ) : (
                            !supportPlanText && <p style={{ color: '#6B7280', fontStyle: 'italic', margin: 0 }}>Not Assessed</p>
                          )}
                        </ProfileCard>
                      );
                    })()}
                  </div>

                  {/* ─── RIGHT COLUMN ─── */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                    {/* Primitive Motor Reflex Profile */}
                    {(() => {
                      const evidence = getCardEvidenceAndSource('domain-9');
                      return (
                        <ProfileCard title={t('atlas.motorReflexes', 'Primitive Motor Reflex Profile')} icon={<Activity size={16} color="#EF4444" />} color="#EF4444" badge={(isUploadEnabled && validDocuments.length > 0 && motorReflexes.length > 0) ? t('atlas.validated', 'VALIDATED') : null} badgeColor="dark" id="domain-9" source={evidence.source} quotes={evidence.quotes} showSourceFooter={isUploadEnabled}>
                          {motorReflexes.length > 0 ? (
                            <>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                                {motorReflexes.slice(0, 6).map((reflex, i) => (
                                  <ReflexRow
                                    key={i}
                                    name={reflex.name || reflex.reflex_name || `Reflex ${i+1}`}
                                    severity={reflex.severity || reflex.status}
                                    score={reflex.score}
                                  />
                                ))}
                              </div>
                              {isUploadEnabled && validDocuments.length > 1 && motorReflexes.some(r => (r.severity === 'Severe' || r.severity === 'Retained') && challengesList.length > 0) && (
                                <DerivedInsight>
                                  {t('atlas.reflexInsight', 'Retained reflexes correlate with reported motor challenges. Recommend bilateral integration exercises targeting')} {motorReflexes.filter(r => r.severity === 'Severe' || r.severity === 'Retained').map(r => r.name || r.reflex_name).join(', ')}.
                                </DerivedInsight>
                              )}
                            </>
                          ) : (
                            <p style={{ color: '#6B7280', fontStyle: 'italic', margin: 0 }}>Not Assessed</p>
                          )}
                        </ProfileCard>
                      );
                    })()}

                    {/* Learning & Sensory Style */}
                    {(() => {
                      const evidence = getCardEvidenceAndSource('domain-5');
                      return (
                        <ProfileCard title={t('atlas.sensoryStyle', 'Learning & Sensory Style')} icon={<Ear size={16} color="#E8841A" />} color="#E8841A" badge={(isUploadEnabled && validDocuments.length > 0 && sensoryItems.length > 0) ? t('atlas.validated', 'VALIDATED') : null} badgeColor="dark" id="domain-5" source={evidence.source} quotes={evidence.quotes} showSourceFooter={isUploadEnabled}>
                          {sensoryItems.length > 0 ? (
                            <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
                              {sensoryItems.slice(0, 5).map((item, i) => <li key={i}>{item}</li>)}
                            </ul>
                          ) : (
                            <p style={{ color: '#6B7280', fontStyle: 'italic', margin: 0 }}>Not Assessed</p>
                          )}
                        </ProfileCard>
                      );
                    })()}

                    {/* Functional Wellness */}
                    {(() => {
                      const evidence = getCardEvidenceAndSource('domain-6');
                      return (
                        <ProfileCard title={t('atlas.wellness', 'Functional Wellness Insights')} icon={<Shield size={16} color="#10B981" />} color="#10B981" badge={(isUploadEnabled && validDocuments.length > 0 && wellnessItems.length > 0) ? t('atlas.validated', 'VALIDATED') : null} badgeColor="dark" id="domain-6" source={evidence.source} quotes={evidence.quotes} showSourceFooter={isUploadEnabled}>
                          {wellnessItems.length > 0 ? (
                            <>
                              <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
                                {wellnessItems.slice(0, 4).map((item, i) => (
                                  <li key={i}>{getItemLabel(item)}</li>
                                ))}
                              </ul>
                              {isUploadEnabled && validDocuments.length > 1 && (
                                <div style={{
                                  display: 'flex', gap: 12, background: '#FEF3C7', padding: '12px 16px',
                                  borderRadius: 10, fontSize: '0.78rem', color: '#92400E', lineHeight: 1.5,
                                  marginTop: 14, alignItems: 'flex-start'
                                }}>
                                  <AlertTriangle size={14} color="#B45309" style={{ flexShrink: 0, marginTop: 2 }} />
                                  <div>
                                    <strong>{t('atlas.disclaimer', 'Disclaimer:')}</strong> {t('atlas.derivedWarning', '"DERIVED" insights are generated by NestureAI by cross-referencing uploaded documents. They are not medical diagnoses and must be validated by a licensed practitioner.')}
                                  </div>
                                </div>
                              )}
                            </>
                          ) : (
                            <p style={{ color: '#6B7280', fontStyle: 'italic', margin: 0 }}>Not Assessed</p>
                          )}
                        </ProfileCard>
                      );
                    })()}
                  </div>
                </div>
              </div>

              {/* ── Documents on File ── */}
              {!isFlagLoading && !isUploadEnabled && validDocuments.length === 0 ? (
                <div style={{
                  background: '#F8FAFC', borderRadius: 16, border: '1.5px dashed #CBD5E1',
                  padding: '28px 24px', textAlign: 'center', marginTop: 20
                }}>
                  <Folder size={24} color="#64748B" style={{ display: 'block', margin: '0 auto 8px' }} />
                  <div style={{ fontWeight: 700, fontSize: '0.92rem', color: '#1E293B', marginBottom: 4 }}>
                    {t('atlas.featureComingSoon', 'Clinical Document Upload — Coming Soon')}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#64748B', maxWidth: 460, margin: '0 auto' }}>
                    {t('atlas.featureComingSoonDesc', 'The ability to attach medical and clinical reports to this profile will be available soon.')}
                  </div>
                </div>
              ) : (
                <div style={{
                  background: '#fff', borderRadius: 16, border: '1px solid #E5E7EB',
                  overflow: 'hidden', marginTop: 20
                }}>
                  <div style={{
                    padding: '16px 24px', background: '#F9FAFB', borderBottom: '1px solid #E5E7EB',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Folder size={18} color="#6B7280" />
                      <span style={{ fontWeight: 700, fontSize: '0.95rem', color: '#111827', fontFamily: 'Inter, sans-serif' }}>
                        {t('atlas.docsOnFile', 'Documents on File')}
                      </span>
                      <span style={{
                        background: '#EEF6F8', color: '#0D5E6B', padding: '2px 8px',
                        borderRadius: 12, fontSize: '0.7rem', fontWeight: 700
                      }}>
                        {validDocuments.length}
                      </span>
                    </div>
                    {!readOnly && !isFlagLoading && isUploadEnabled && (
                      <label style={{
                        background: '#F9FAFB', border: '1.5px dashed #D1D5DB', padding: '6px 14px',
                        borderRadius: 8, cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600,
                        color: '#6B7280', display: 'inline-flex', alignItems: 'center', gap: 6
                      }}>
                        📎 {t('atlas.addDoc', 'Add document')}
                        <input
                          type="file"
                          accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,application/pdf,image/jpeg,image/png,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                          multiple
                          style={{ display: 'none' }}
                          onChange={handleFileUpload}
                          disabled={uploading}
                        />
                      </label>
                    )}
                  </div>
                  <div style={{ padding: 20 }}>
                    <div className="atlas-docs-grid">
                      {validDocuments.length > 0 ? validDocuments.map(d => {
                        return (
                          <div key={d.id} style={{
                            display: 'flex', flexDirection: 'column',
                            background: '#F9FAFB', borderRadius: 12,
                            border: '1px solid #E5E7EB', overflow: 'hidden',
                            marginBottom: 10
                          }}>
                            {/* Main Row */}
                            <div style={{
                              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                              padding: '14px 16px', gap: 12, flexWrap: 'wrap'
                            }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 200 }}>
                                <FileText size={18} color="#6B7280" />
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#1F2937', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {d.file_name}
                                  </div>
                                  <div style={{ fontSize: '0.72rem', color: '#9CA3AF', marginTop: 2 }}>
                                    {d.file_type} · {new Date(d.created_at || d.uploaded_at || Date.now()).toLocaleDateString()}
                                  </div>
                                </div>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <span style={{
                                  background: d.status === 'definitive' || d.status === 'completed' ? '#D1FAE5' : d.status === 'error' ? '#FEE2E2' : '#FEF3C7',
                                  color: d.status === 'definitive' || d.status === 'completed' ? '#065F46' : d.status === 'error' ? '#991B1B' : '#92400E',
                                  padding: '4px 10px', borderRadius: 20, fontSize: '0.65rem', fontWeight: 800,
                                  textTransform: 'uppercase', letterSpacing: '0.04em'
                                }}>
                                  {d.status === 'definitive' ? 'Validated' : d.status}
                                </span>
                                {!readOnly && (
                                  <button
                                    onClick={() => handleDeleteDocument(d.id, d.file_path)}
                                    style={{
                                      background: '#FEE2E2', border: '1px solid #FECACA', color: '#991B1B',
                                      borderRadius: 8, padding: '5px 8px', cursor: 'pointer', fontSize: '0.8rem',
                                      display: 'flex', alignItems: 'center', justifyContent: 'center'
                                    }}
                                    title="Delete this report"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      }) : (
                        <div style={{ textAlign: 'center', padding: '20px', color: '#9CA3AF', fontSize: '0.85rem', fontStyle: 'italic' }}>
                          No documents uploaded yet.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}


            </>
          )}

          {/* ── Modals ── */}
          {deleteConfirmDoc && (
            <div style={{
              position: 'fixed',
              inset: 0,
              zIndex: 99999,
              background: 'rgba(15, 30, 34, 0.5)',
              backdropFilter: 'blur(4px)',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              padding: 16
            }}>
              <div style={{
                background: '#ffffff',
                borderRadius: 16,
                width: '100%',
                maxWidth: 400,
                padding: 24,
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
                border: '1px solid #E5E7EB'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    background: '#FEE2E2',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}>
                    <AlertTriangle size={20} color="#EF4444" />
                  </div>
                  <h3 style={{
                    fontFamily: 'Inter, sans-serif',
                    fontSize: '1.15rem',
                    fontWeight: 700,
                    color: '#111827',
                    margin: 0
                  }}>
                    Delete Report
                  </h3>
                </div>
                <p style={{
                  fontSize: '0.88rem',
                  color: '#4B5563',
                  lineHeight: 1.5,
                  margin: 0
                }}>
                  Delete this report permanently?
                </p>
                <div style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: 12,
                  marginTop: 8
                }}>
                  <button
                    onClick={() => setDeleteConfirmDoc(null)}
                    style={{
                      background: '#F3F4F6',
                      border: '1px solid #E5E7EB',
                      borderRadius: 8,
                      padding: '8px 16px',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      color: '#374151',
                      cursor: 'pointer',
                      transition: 'background 0.2s'
                    }}
                    onMouseEnter={(e) => e.target.style.background = '#E5E7EB'}
                    onMouseLeave={(e) => e.target.style.background = '#F3F4F6'}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={async () => {
                      const { id, filePath } = deleteConfirmDoc;
                      setDeleteConfirmDoc(null);
                      await executeDeleteDocument(id, filePath);
                    }}
                    style={{
                      background: '#EF4444',
                      border: 'none',
                      borderRadius: 8,
                      padding: '8px 16px',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      color: '#ffffff',
                      cursor: 'pointer',
                      transition: 'background 0.2s'
                    }}
                    onMouseEnter={(e) => e.target.style.background = '#DC2626'}
                    onMouseLeave={(e) => e.target.style.background = '#EF4444'}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          )}

          <AtlasDeepDiveModal
            isOpen={showDeepDive}
            onClose={() => { setShowDeepDive(false); setDeepDiveInitialDomain(null); }}
            childName={childName}
            profile={profile}
            domainScores={domainScores}
            questionnaireResponses={questionnaireResponses}
            initialDomain={deepDiveInitialDomain}
            hasValidatedDocs={hasValidatedDocs}
            validDocuments={validDocuments}
            onDownloadPDF={async () => {
              if (!profile) return;
              toast.loading('Generating PDF...', { id: 'pdf-gen-deep' });
              try {
                await generateAtlasProfileReport({ profile, childName, scores, childAge, childDiagnosis, childAvatarUrl });
                toast.success('PDF downloaded!', { id: 'pdf-gen-deep' });
              } catch (err) { toast.error('Failed to generate PDF', { id: 'pdf-gen-deep' }); }
            }}
          />
        </div>
      )}
    </>
  );
}
