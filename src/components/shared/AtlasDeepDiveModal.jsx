import React, { useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import toast from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Shield, Brain, Activity, Target, Ear, Eye, HeartPulse, Stethoscope, Download, Home, Dna, ClipboardList, Dumbbell, UserCheck, MessageCircle, BookOpen, Smile, Sparkles } from 'lucide-react';

export default function AtlasDeepDiveModal({ 
  isOpen, 
  onClose, 
  childName = "your child", 
  profile, 
  domainScores,
  questionnaireResponses,
  onDownloadPDF, 
  initialDomain, 
  hasValidatedDocs = false, 
  validDocuments = [] 
}) {
  // ── Hooks (Declared Unconditionally at the Top) ──
  const pdfRef = useRef(null);
  const [isExporting, setIsExporting] = useState(false);

  React.useEffect(() => {
    if (isOpen && initialDomain) {
      setTimeout(() => {
        const el = document.getElementById(`deepdive-${initialDomain}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          const originalShadow = el.style.boxShadow;
          el.style.boxShadow = '0 0 0 4px #0D5E6B';
          setTimeout(() => el.style.boxShadow = originalShadow || '0 4px 15px rgba(0,0,0,0.02)', 1500);
        }
      }, 100);
    }
  }, [isOpen, initialDomain]);

  if (!isOpen) return null;

  // ── Helper functions & safe checks ──
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

  const getItemLabel = (item) => {
    if (typeof item === 'string') return item;
    if (item?.label) return item.label;
    if (item?.title) return item.title;
    if (item?.name) return item.name;
    return '';
  };

  const rawMotor = Array.isArray(profile?.motor_reflexes) ? profile.motor_reflexes : [];
  const motorReflexes = rawMotor.filter(item => {
    if (!item) return false;
    if (typeof item === 'object') {
      if (item.name === 'score' || item.name === 'band') return false;
      if (!item.status || item.status === 'Not sure' || item.status === 'Not assessed' || item.status === 'Unknown') return false;
    }
    return true;
  });
  const sensory = profile?.sensory_profile || {};
  const comms = profile?.communication_profile || {};
  const homePlan = profile?.home_plan?.daily_routine || [];
  const rawWellness = Array.isArray(profile?.functional_wellness) ? profile.functional_wellness : [];
  const wellness = rawWellness.filter(item => {
    if (!item) return false;
    if (typeof item === 'object') {
      if (item.name === 'score' || item.name === 'band') return false;
      if (!item.status || item.status === 'Not sure' || item.status === 'Not assessed' || item.status === 'Unknown') return false;
    }
    return true;
  });
  
  const strengthsRaw = hasValidatedDocs && Array.isArray(profile?.strengths) ? profile.strengths : [];
  const challengesRaw = hasValidatedDocs && Array.isArray(profile?.challenges) ? profile.challenges : [];

  const lowercaseChallenges = challengesRaw.map(c => getItemLabel(c).toLowerCase().trim());
  const strengths = strengthsRaw.filter(s => {
    const label = getItemLabel(s).toLowerCase().trim();
    if (label.includes('non-verbal') || label.includes('non verbal')) return false;
    return !lowercaseChallenges.includes(label);
  });
  const challenges = challengesRaw;

  const academic = hasValidatedDocs ? [...strengths.filter(s => s.domain === 'Academic'), ...challenges.filter(c => c.domain === 'Academic')] : [];
  const behavioral = hasValidatedDocs ? [...strengths.filter(s => s.domain?.startsWith('Behavior') || s.domain?.startsWith('Behaviour')), ...challenges.filter(c => c.domain?.startsWith('Behavior') || c.domain?.startsWith('Behaviour'))] : [];
  const genetic = hasValidatedDocs ? [...strengths.filter(s => s.domain === 'Genetic'), ...challenges.filter(c => c.domain === 'Genetic')] : [];
  const environment = hasValidatedDocs ? [...strengths.filter(s => s.domain === 'Environment'), ...challenges.filter(c => c.domain === 'Environment')] : [];
  const brain = hasValidatedDocs ? [...strengths.filter(s => s.domain === 'Brain'), ...challenges.filter(c => c.domain === 'Brain')] : [];
  const dailyLiving = hasValidatedDocs ? [...strengths.filter(s => s.domain === 'DailyLiving'), ...challenges.filter(c => c.domain === 'DailyLiving')] : [];

  const cleanLabel = (text) => text.replace(/\s*\([^)]*\)\s*$/, '');

  const getCardEvidenceAndSource = (domainKey) => {
    if (!validDocuments || validDocuments.length === 0) {
      return { source: 'Evidence Required', quotes: [] };
    }

    const keywordMap = {
      'domain-1': ['development', 'cognitive', 'behavior', 'regulation', 'strength', 'challenge', 'verbal', 'motor'],
      'domain-2': ['academic', 'learning', 'school', 'read', 'write', 'math'],
      'domain-3': ['behavior', 'regulation', 'emotional', 'calm', 'meltdown', 'attention'],
      'domain-4': ['support', 'iep', 'plan', 'routine', 'schedule', 'home', 'diet'],
      'domain-5': ['sensory', 'sound', 'light', 'touch', 'auditory', 'tactile', 'proprioceptive', 'vestibular'],
      'domain-6': ['wellness', 'medical', 'sleep', 'diet', 'health', 'physical'],
      'domain-7': ['genetics', 'genetic', 'dna', 'mutation', 'inherited'],
      'domain-8': ['environment', 'home', 'school', 'room', 'noise', 'lighting'],
      'domain-9': ['reflex', 'motor', 'movement', 'moro', 'atnr', 'stnr', 'tlr', 'grasp'],
      'domain-10': ['speech', 'comm', 'language', 'verbal', 'vocal', 'talk', 'social', 'non-verbal', 'non verbal'],
      'domain-11': ['brain', 'neurology', 'neuro', 'development', 'seizure', 'eeg'],
      'domain-12': ['daily living', 'adl', 'dress', 'feed', 'hygiene', 'toilet']
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

  const renderSourceFooter = (domainKey) => {
    const evidence = getCardEvidenceAndSource(domainKey);
    return (
      <div style={{
        marginTop: 'auto',
        paddingTop: 10,
        borderTop: '1px solid #F3F4F6',
        fontSize: '0.72rem',
        color: '#6B7280'
      }}>
        {evidence.source === 'Evidence Required' ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>Source: None</span>
            <span style={{
              background: '#FEF3C7',
              color: '#D97706',
              fontSize: '0.6rem',
              fontWeight: 800,
              padding: '1px 6px',
              borderRadius: 3,
              letterSpacing: '0.05em'
            }}>
              EVIDENCE REQUIRED
            </span>
          </div>
        ) : (
          <>
            <div style={{ fontWeight: 600, color: '#374151', marginBottom: 2 }}>
              Source: <span style={{ fontWeight: 400, color: '#4B5563' }}>{evidence.source}</span>
            </div>
            {evidence.quotes && evidence.quotes.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                {evidence.quotes.map((q, idx) => (
                  <div key={idx} style={{ fontStyle: 'italic', background: '#F9FAFB', padding: '4px 8px', borderRadius: 4, borderLeft: '2px solid #0D5E6B', color: '#4B5563', fontSize: '0.7rem' }}>
                    "{q.quote}" <span style={{ fontSize: '0.6rem', color: '#9CA3AF' }}>— p.{q.page}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  const renderScoreBadge = (score, band) => {
    if (score === undefined || score === null) return null;
    const bandMap = {
      'strength': { bg: '#D1FAE5', color: '#065F46', label: 'Support level: Key strength (independent)' },
      'developing': { bg: '#FEF3C7', color: '#92400E', label: 'Support level: Developing skill' },
      'support_area': { bg: '#FEE2E2', color: '#991B1B', label: 'Support level: Needs support' },
    };
    const b = bandMap[band] || {
      bg: '#F3F4F6',
      color: '#374151',
      label: band ? `Support level: ${band.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}` : 'Assessed'
    };
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
        <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#111827', background: '#F3F4F6', padding: '2px 8px', borderRadius: 6 }}>
          Score: {score}%
        </span>
        <span style={{ fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', background: b.bg, color: b.color, padding: '3px 8px', borderRadius: 4, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {b.label}
          <TooltipInfo text="Shows the level of support recommended for this area, based on questionnaire scores and uploaded documents." />
        </span>
      </div>
    );
  };

  const renderQnARows = (responsesObj) => {
    if (!responsesObj || Object.keys(responsesObj).length === 0) return <div style={styles.emptyText}>Not Assessed</div>;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4, background: '#F9FAFB', padding: 12, borderRadius: 10, border: '1px solid #E5E7EB' }}>
        {Object.entries(responsesObj).map(([key, val]) => {
          const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          return (
            <div key={key} style={{ fontSize: '0.8rem', color: '#4B5563', lineHeight: 1.4 }}>
              <strong>{label}:</strong> {String(val)}
            </div>
          );
        })}
      </div>
    );
  };

  const handleExportPDF = () => {
    const el = pdfRef.current;
    if (!el) return;

    setIsExporting(true);
    const toastId = toast.loading('Preparing PDF...');

    try {
      const iframe = document.createElement('iframe');
      iframe.style.position = 'absolute';
      iframe.style.width = '0px';
      iframe.style.height = '0px';
      iframe.style.border = 'none';
      document.body.appendChild(iframe);

      const doc = iframe.contentWindow.document;

      let stylesHtml = '';
      for (let sheet of document.styleSheets) {
        try {
          if (sheet.cssRules) {
            for (let rule of sheet.cssRules) {
              stylesHtml += rule.cssText;
            }
          }
        } catch (e) {
          // Ignore stylesheet rule errors
        }
      }

      doc.open();
      doc.write(`
        <html>
          <head>
            <title>Atlas_DeepDive_${childName.replace(/\s+/g, '_')}</title>
            <style>
              ${stylesHtml}
              body { 
                font-family: 'Inter', system-ui, -apple-system, sans-serif; 
                background: #fff; 
                padding: 0; 
                margin: 0;
              }
              .modal-content { 
                width: 100%; 
                max-width: 1000px; 
                margin: 0 auto; 
                background: #fff !important; 
                padding: 20px; 
              }
              .deep-dive-scroll { 
                overflow: visible !important; 
                height: auto !important; 
              }
              @media print {
                *, html, body {
                  overflow: visible !important;
                  height: auto !important;
                  max-height: none !important;
                }
                div[style*="grid-template-columns"], 
                div[style*="display: grid"] {
                  display: block !important;
                }
                .bentoCard, div[style*="border-radius: 16px"] { 
                  page-break-inside: avoid !important; 
                  break-inside: avoid !important; 
                  margin-bottom: 24px !important;
                  display: block !important;
                  width: 100% !important;
                  box-sizing: border-box !important;
                }
                button { display: none !important; }
              }
            </style>
          </head>
          <body>
            <div class="modal-content">
              ${el.innerHTML}
            </div>
          </body>
        </html>
      `);
      doc.close();

      setTimeout(() => {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
        document.body.removeChild(iframe);
        toast.success('PDF ready!', { id: toastId });
        setIsExporting(false);
      }, 500);
      
    } catch (err) {
      console.error(err);
      toast.error('Failed to export PDF.', { id: toastId });
      setIsExporting(false);
    }
  };

  return (
    <div style={styles.overlay}>
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        style={styles.modal}
        ref={pdfRef}
      >
        {/* ── HEADER ── */}
        <div style={styles.header}>
          <div style={styles.headerLeft}>
            <div style={styles.iconWrap}>
              <Brain size={26} color="#0D5E6B" />
            </div>
            <div>
              <h2 style={styles.title}>Atlas Deep Dive</h2>
              <p style={styles.subtitle}>Comprehensive 12-Domain AI Synthesis for {childName}</p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {onDownloadPDF && (
              <button onClick={handleExportPDF} disabled={isExporting} style={{...styles.downloadBtn, opacity: isExporting ? 0.5 : 1}}>
                <Download size={16} /> Export PDF
              </button>
            )}
            <button onClick={onClose} style={styles.closeBtn}>
              <X size={20} />
            </button>
          </div>
        </div>

        {/* ── BODY ── */}
        <div style={styles.body} className="deep-dive-scroll">
          <div style={styles.bentoGrid}>
            
            {/* 1. Developmental Profile */}
            <div id="deepdive-domain-1" style={{...styles.bentoCard, ...styles.bentoCardPrimary}}>
              <div style={styles.cardHeader}>
                <div style={styles.cardIconWrapPrimary}><Smile size={18} /></div>
                <h3 style={styles.cardTitlePrimary}>1. Developmental Profile</h3>
              </div>
              {questionnaireResponses ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 12, width: '100%' }}>
                  {questionnaireResponses.d1_communication_mode && (
                    <div style={styles.dataRow}>
                      <strong>Preferred Mode of Communication:</strong> {questionnaireResponses.d1_communication_mode}
                    </div>
                  )}
                  {questionnaireResponses.d1_strengths_checklist && questionnaireResponses.d1_strengths_checklist.length > 0 && (
                    <div>
                      <strong style={{ color: '#065F46', display: 'block', marginBottom: 4, fontSize: '0.85rem' }}>Strengths Checklist:</strong>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {questionnaireResponses.d1_strengths_checklist.map((str, idx) => (
                          <span key={idx} style={{ background: '#D1FAE5', color: '#065F46', padding: '2px 8px', borderRadius: 12, fontSize: '0.75rem', fontWeight: 600 }}>{str}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {questionnaireResponses.d1_who_is && (
                    <div style={styles.dataRow}><strong>Who {childName} is:</strong> <em>"{questionnaireResponses.d1_who_is}"</em></div>
                  )}
                  {questionnaireResponses.d1_enjoys && (
                    <div style={styles.dataRow}><strong>What {childName} enjoys:</strong> <em>"{questionnaireResponses.d1_enjoys}"</em></div>
                  )}
                  {questionnaireResponses.d1_what_helps && (
                    <div style={styles.dataRow}><strong>What would help most:</strong> <em>"{questionnaireResponses.d1_what_helps}"</em></div>
                  )}
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 12 }}>
                  <div>
                    <strong style={{ color: '#065F46', fontSize: '0.85rem', display: 'block', marginBottom: 6 }}>Strengths</strong>
                    {strengths.length > 0 ? strengths.map((s, i) => <div key={i} style={styles.listItem}>• {cleanLabel(getItemLabel(s))}</div>) : <div style={styles.emptyText}>Not Assessed</div>}
                  </div>
                  <div>
                    <strong style={{ color: '#92400E', fontSize: '0.85rem', display: 'block', marginBottom: 6 }}>Challenges</strong>
                    {challenges.length > 0 ? challenges.map((c, i) => <div key={i} style={styles.listItem}>• {cleanLabel(getItemLabel(c))}</div>) : <div style={styles.emptyText}>Not Assessed</div>}
                  </div>
                </div>
              )}
              {renderSourceFooter('domain-1')}
            </div>

            {/* 2. Academic & Learning */}
            <div id="deepdive-domain-2" style={styles.bentoCard}>
              <div style={styles.cardHeader}>
                <div style={{...styles.cardIconWrap, color: '#3B82F6', background: '#EFF6FF'}}><BookOpen size={16} /></div>
                <h3 style={styles.cardTitle}>2. Academic & Learning</h3>
                {renderScoreBadge(domainScores?.d3_score, domainScores?.d3_band)}
              </div>
              <div style={{ marginBottom: 12 }}>
                {questionnaireResponses?.d3_responses ? (
                  renderQnARows(questionnaireResponses.d3_responses)
                ) : (
                  academic.length > 0 ? academic.map((a, i) => (
                    <div key={i} style={styles.dataRow}><strong>{cleanLabel(getItemLabel(a))}:</strong> {a.description}</div>
                  )) : <div style={styles.emptyText}>Not Assessed</div>
                )}
              </div>
              {renderSourceFooter('domain-2')}
            </div>

            {/* 3. Behaviour & Regulation */}
            <div id="deepdive-domain-3" style={styles.bentoCard}>
              <div style={styles.cardHeader}>
                <div style={{...styles.cardIconWrap, color: '#8B5CF6', background: '#F5F3FF'}}><HeartPulse size={16} /></div>
                <h3 style={styles.cardTitle}>3. Behaviour & Regulation</h3>
                {renderScoreBadge(domainScores?.d4_score, domainScores?.d4_band)}
              </div>
              <div style={{ marginBottom: 12 }}>
                {questionnaireResponses?.d4_responses ? (
                  renderQnARows(questionnaireResponses.d4_responses)
                ) : (
                  behavioral.length > 0 ? behavioral.map((b, i) => (
                    <div key={i} style={styles.dataRow}><strong>{cleanLabel(getItemLabel(b))}:</strong> {b.description}</div>
                  )) : <div style={styles.emptyText}>Not Assessed</div>
                )}
              </div>
              {renderSourceFooter('domain-3')}
            </div>

            {/* 9. Primitive Motor Reflexes */}
            <div id="deepdive-domain-9" style={{...styles.bentoCard, gridColumn: '1 / -1', background: '#FFF1F2', borderColor: '#FFE4E6'}}>
              <div style={styles.cardHeader}>
                <div style={{...styles.cardIconWrap, color: '#E11D48', background: '#FFE4E6'}}><Activity size={16} /></div>
                <h3 style={styles.cardTitle}>9. Primitive Motor Reflexes</h3>
                {renderScoreBadge(domainScores?.d7_score, domainScores?.d7_band)}
              </div>
              {questionnaireResponses?.d7_responses ? (
                renderQnARows(questionnaireResponses.d7_responses)
              ) : (
                motorReflexes.length > 0 ? (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 12 }}>
                      {motorReflexes.map(r => {
                        const scoreVal = r.score !== undefined && r.score !== null && r.score !== '' ? parseInt(r.score) : NaN;
                        const hasScore = !isNaN(scoreVal);
                        const displayScore = hasScore ? `${scoreVal}/4` : 'Not Assessed';
                        const label = r.severity || r.status || r.label || 'Not Assessed';
                        
                        let color = '#6B7280';
                        const lowerLabel = String(label).toLowerCase();
                        if (lowerLabel.includes('severe') || lowerLabel.includes('retained') || lowerLabel.includes('strong')) color = '#E11D48';
                        else if (lowerLabel.includes('mod') || lowerLabel.includes('emerging') || lowerLabel.includes('mild') || lowerLabel.includes('weak')) color = '#F59E0B';
                        else if (lowerLabel.includes('integrated') || lowerLabel.includes('typical') || lowerLabel.includes('none')) color = '#10B981';

                        return (
                          <div key={r.name} style={{ background: '#fff', padding: 12, borderRadius: 10, border: '1px solid #FFE4E6', boxShadow: '0 2px 8px rgba(225,29,72,0.04)' }}>
                            <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1F2937' }}>{r.name}</div>
                            <div style={{ fontSize: '1.1rem', fontWeight: 800, color, margin: '4px 0' }}>{displayScore}</div>
                            <div style={{ fontSize: '0.75rem', color: '#6B7280', lineHeight: 1.4 }}>{label}</div>
                          </div>
                        );
                      })}
                    </div>
                    {renderSourceFooter('domain-9')}
                  </>
                ) : <div style={styles.emptyText}>Not Assessed</div>
              )}
            </div>

            {/* 4. Support Plan */}
            <div id="deepdive-domain-4" style={styles.bentoCard}>
              <div style={styles.cardHeader}>
                <div style={{...styles.cardIconWrap, color: '#0D5E6B', background: '#EEF6F8'}}><ClipboardList size={16} /></div>
                <h3 style={styles.cardTitle}>4. Support Plan</h3>
              </div>
              <div style={{ marginBottom: 12 }}>
                {domainScores?.d12_support_plan ? (
                  <div style={{ background: '#FFFDF5', border: '1px solid #FDE68A', padding: '14px 18px', borderRadius: 10, color: '#78350F', fontSize: '0.82rem', lineHeight: 1.6, fontStyle: 'italic' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, marginBottom: 6, color: '#92400E' }}>
                      <Sparkles size={14} color="#F59E0B" />
                      Personalized Plan Narrative
                    </div>
                    {domainScores.d12_support_plan}
                  </div>
                ) : (
                  homePlan.length > 0 ? homePlan.map((hp, i) => (
                    <div key={i} style={styles.dataRow}>
                      <strong style={{ color: '#0D5E6B' }}>{hp.time}:</strong> {hp.activity} ({hp.duration_min}m)
                      <div style={{ fontSize: '0.75rem', color: '#6B7280', marginTop: 2 }}>↳ {hp.rationale}</div>
                    </div>
                  )) : <div style={styles.emptyText}>Not Assessed</div>
                )}
              </div>
              {renderSourceFooter('domain-4')}
            </div>

            {/* 5. Sensory Profile */}
            <div id="deepdive-domain-5" style={styles.bentoCard}>
              <div style={styles.cardHeader}>
                <div style={{...styles.cardIconWrap, color: '#EA580C', background: '#FFEDD5'}}><Ear size={16} /></div>
                <h3 style={styles.cardTitle}>5. Sensory Profile</h3>
                {renderScoreBadge(domainScores?.d5_score, domainScores?.d5_band)}
              </div>
              <div style={{ marginBottom: 12 }}>
                {questionnaireResponses?.d5_responses ? (
                  renderQnARows(questionnaireResponses.d5_responses)
                ) : (
                  Object.entries(sensory).filter(([_, val]) => isValidAIExtraction(val)).length > 0 ? (
                    <>
                      {Object.entries(sensory)
                        .filter(([_, val]) => isValidAIExtraction(val))
                        .map(([key, val]) => {
                          const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                          const displayVal = Array.isArray(val) ? val.join(', ') : typeof val === 'object' ? JSON.stringify(val) : val;
                          return (
                            <div key={key} style={styles.dataRow}>
                              <strong>{label}:</strong> {displayVal}
                            </div>
                          );
                        })}
                    </>
                  ) : <div style={styles.emptyText}>Not Assessed</div>
                )}
              </div>
              {renderSourceFooter('domain-5')}
            </div>

            {/* 10. Social & Communication */}
            <div id="deepdive-domain-10" style={styles.bentoCard}>
              <div style={styles.cardHeader}>
                <div style={{...styles.cardIconWrap, color: '#0284C7', background: '#E0F2FE'}}><MessageCircle size={16} /></div>
                <h3 style={styles.cardTitle}>10. Social & Communication</h3>
                {renderScoreBadge(domainScores?.d2_score, domainScores?.d2_band)}
              </div>
              <div style={{ marginBottom: 12 }}>
                {questionnaireResponses?.d2_responses ? (
                  renderQnARows(questionnaireResponses.d2_responses)
                ) : (
                  Object.entries(comms).filter(([_, val]) => isValidAIExtraction(val)).length > 0 ? (
                    <>
                      {Object.entries(comms)
                        .filter(([_, val]) => isValidAIExtraction(val))
                        .map(([key, val]) => {
                          const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                          const displayVal = Array.isArray(val) ? val.join(', ') : typeof val === 'object' ? JSON.stringify(val) : val;
                          return (
                            <div key={key} style={styles.dataRow}>
                              <strong>{label}:</strong> {displayVal}
                            </div>
                          );
                        })}
                    </>
                  ) : <div style={styles.emptyText}>Not Assessed</div>
                )}
              </div>
              {renderSourceFooter('domain-10')}
            </div>

            {/* 6. Functional Wellness */}
            <div id="deepdive-domain-6" style={styles.bentoCard}>
              <div style={styles.cardHeader}>
                <div style={{...styles.cardIconWrap, color: '#059669', background: '#D1FAE5'}}><Stethoscope size={16} /></div>
                <h3 style={styles.cardTitle}>6. Functional Wellness</h3>
                {renderScoreBadge(domainScores?.d6_score, domainScores?.d6_band)}
              </div>
              <div style={{ marginBottom: 12 }}>
                {questionnaireResponses?.d6_responses ? (
                  renderQnARows(questionnaireResponses.d6_responses)
                ) : (
                  wellness.length > 0 ? wellness.map((fw, i) => (
                    <div key={i} style={{ ...styles.dataRow, background: '#F8FAFB', padding: 8, borderRadius: 8, border: '1px solid #F3F4F6' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <strong style={{ color: '#374151' }}>{fw.title}</strong>
                        <span style={{ fontSize: '0.65rem', background: fw.confidence === 'DEFINITIVE' ? '#D1FAE5' : '#FEF3C7', color: fw.confidence === 'DEFINITIVE' ? '#065F46' : '#92400E', padding: '2px 6px', borderRadius: 10, fontWeight: 700 }}>{fw.confidence === 'DEFINITIVE' ? 'VALIDATED' : fw.confidence}</span>
                      </div>
                      <div style={{ color: '#4B5563' }}>{fw.description}</div>
                    </div>
                  )) : <div style={styles.emptyText}>Not Assessed</div>
                )}
              </div>
              {renderSourceFooter('domain-6')}
            </div>

            {/* 7. Genetic */}
            <div id="deepdive-domain-7" style={styles.bentoCard}>
              <div style={styles.cardHeader}>
                <div style={{...styles.cardIconWrap, color: '#4F46E5', background: '#E0E7FF'}}><Dna size={16} /></div>
                <h3 style={styles.cardTitle}>7. Genetic</h3>
              </div>
              <div style={{ marginBottom: 12 }}>
                {questionnaireResponses ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {questionnaireResponses.d10_family_differences && (
                      <div style={styles.dataRow}><strong>Family differences & neurodivergence history:</strong> {questionnaireResponses.d10_family_differences}</div>
                    )}
                    {questionnaireResponses.d10_genetic_notes && (
                      <div style={styles.dataRow}><strong>Genetic testing notes:</strong> {questionnaireResponses.d10_genetic_notes}</div>
                    )}
                    {!questionnaireResponses.d10_family_differences && !questionnaireResponses.d10_genetic_notes && <div style={styles.emptyText}>Not Assessed</div>}
                  </div>
                ) : (
                  genetic.length > 0 ? genetic.map((g, i) => (
                    <div key={i} style={styles.dataRow}><strong>{cleanLabel(getItemLabel(g))}:</strong> {g.description}</div>
                  )) : <div style={styles.emptyText}>Not Assessed</div>
                )}
              </div>
              {renderSourceFooter('domain-7')}
            </div>

            {/* 8. Environment */}
            <div id="deepdive-domain-8" style={styles.bentoCard}>
              <div style={styles.cardHeader}>
                <div style={{...styles.cardIconWrap, color: '#D97706', background: '#FEF3C7'}}><Home size={16} /></div>
                <h3 style={styles.cardTitle}>8. Environment</h3>
              </div>
              <div style={{ marginBottom: 12 }}>
                {questionnaireResponses ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {questionnaireResponses.d11_location && (
                      <div style={styles.dataRow}><strong>Daytime location:</strong> {questionnaireResponses.d11_location}</div>
                    )}
                    {questionnaireResponses.d11_calm_space && (
                      <div style={styles.dataRow}><strong>Access to calm space:</strong> {questionnaireResponses.d11_calm_space}</div>
                    )}
                    {questionnaireResponses.d11_what_helps && (
                      <div style={styles.dataRow}>
                        <strong>What helps calm down:</strong> {Array.isArray(questionnaireResponses.d11_what_helps) ? questionnaireResponses.d11_what_helps.join(', ') : String(questionnaireResponses.d11_what_helps)}
                      </div>
                    )}
                    {!questionnaireResponses.d11_location && !questionnaireResponses.d11_calm_space && !questionnaireResponses.d11_what_helps && <div style={styles.emptyText}>Not Assessed</div>}
                  </div>
                ) : (
                  environment.length > 0 ? environment.map((e, i) => (
                    <div key={i} style={styles.dataRow}><strong>{cleanLabel(getItemLabel(e))}:</strong> {e.description}</div>
                  )) : <div style={styles.emptyText}>Not Assessed</div>
                )}
              </div>
              {renderSourceFooter('domain-8')}
            </div>

            {/* 11. Brain Development */}
            <div id="deepdive-domain-11" style={styles.bentoCard}>
              <div style={styles.cardHeader}>
                <div style={{...styles.cardIconWrap, color: '#7C3AED', background: '#EDE9FE'}}><Brain size={16} /></div>
                <h3 style={styles.cardTitle}>11. Brain Development</h3>
                {renderScoreBadge(domainScores?.d8_score, domainScores?.d8_band)}
              </div>
              <div style={{ marginBottom: 12 }}>
                {questionnaireResponses?.d8_responses ? (
                  renderQnARows(questionnaireResponses.d8_responses)
                ) : (
                  brain.length > 0 ? brain.map((b, i) => (
                    <div key={i} style={styles.dataRow}><strong>{cleanLabel(getItemLabel(b))}:</strong> {b.description}</div>
                  )) : <div style={styles.emptyText}>Not Assessed</div>
                )}
              </div>
              {renderSourceFooter('domain-11')}
            </div>

            {/* 12. Daily Living Skills */}
            <div id="deepdive-domain-12" style={styles.bentoCard}>
              <div style={styles.cardHeader}>
                <div style={{...styles.cardIconWrap, color: '#0891B2', background: '#CFFAFE'}}><UserCheck size={16} /></div>
                <h3 style={styles.cardTitle}>12. Daily Living Skills</h3>
                {renderScoreBadge(domainScores?.d9_score, domainScores?.d9_band)}
              </div>
              <div style={{ marginBottom: 12 }}>
                {questionnaireResponses?.d9_responses ? (
                  renderQnARows(questionnaireResponses.d9_responses)
                ) : (
                  dailyLiving.length > 0 ? dailyLiving.map((d, i) => (
                    <div key={i} style={styles.dataRow}><strong>{cleanLabel(getItemLabel(d))}:</strong> {d.description}</div>
                  )) : <div style={styles.emptyText}>Not Assessed</div>
                )}
              </div>
              {renderSourceFooter('domain-12')}
            </div>

          </div>
          
          {/* ── FOOTER DISCLAIMER ── */}
          <div style={styles.disclaimer}>
            <Shield size={18} color="#B45309" style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <strong>Disclaimer:</strong> This deep dive profile is generated by NestureAI using the uploaded reports and historical session data. It is intended for informational and educational planning purposes only and does not replace a formal medical diagnosis.
            </div>
          </div>
        </div>
      </motion.div>
      <style>{`
        .deep-dive-scroll::-webkit-scrollbar { width: 8px; }
        .deep-dive-scroll::-webkit-scrollbar-track { background: transparent; }
        .deep-dive-scroll::-webkit-scrollbar-thumb { background: #D1D5DB; border-radius: 10px; }
        .deep-dive-scroll::-webkit-scrollbar-thumb:hover { background: #9CA3AF; }
      `}</style>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 99999, background: 'rgba(17, 24, 39, 0.7)',
    backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '3vh 3vw'
  },
  modal: {
    background: '#F4F7F9', borderRadius: 24, width: '100%', maxWidth: 1200,
    height: '94vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
    boxShadow: '0 25px 50px -12px rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.2)'
  },
  header: {
    padding: '24px 32px', background: '#fff', borderBottom: '1px solid #E5E7EB',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0,
    boxShadow: '0 4px 20px rgba(0,0,0,0.02)', zIndex: 10
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 16 },
  iconWrap: {
    width: 52, height: 52, background: 'linear-gradient(135deg, #EEF6F8, #C8E8ED)', borderRadius: 14,
    display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: 'inset 0 2px 4px rgba(255,255,255,0.5)'
  },
  title: { margin: 0, fontSize: '1.5rem', fontWeight: 800, color: '#111827', fontFamily: 'Inter, sans-serif', letterSpacing: '-0.02em' },
  subtitle: { margin: '4px 0 0 0', fontSize: '0.9rem', color: '#6B7280', fontWeight: 500 },
  downloadBtn: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px',
    background: '#111827', color: '#fff', border: 'none', borderRadius: 10,
    fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s',
    boxShadow: '0 4px 12px rgba(17,24,39,0.15)'
  },
  closeBtn: {
    width: 42, height: 42, borderRadius: '50%', background: '#F3F4F6', border: '1px solid #E5E7EB',
    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
    color: '#4B5563', transition: 'all 0.2s'
  },
  body: {
    flex: 1, overflowY: 'auto', padding: '32px', display: 'flex', flexDirection: 'column'
  },
  bentoGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20, flex: 1
  },
  bentoCard: {
    background: '#fff', borderRadius: 16, padding: 24, border: '1px solid #E5E7EB',
    boxShadow: '0 4px 15px rgba(0,0,0,0.02)', transition: 'transform 0.2s, box-shadow 0.2s',
    display: 'flex', flexDirection: 'column', gap: 12
  },
  bentoCardPrimary: {
    gridColumn: '1 / -1', background: 'linear-gradient(135deg, #F8FAFB, #fff)', border: '1px solid #C8E8ED',
    boxShadow: '0 8px 30px rgba(13,94,107,0.06)'
  },
  cardHeader: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8, paddingBottom: 12, borderBottom: '1px solid #F3F4F6' },
  cardIconWrap: { width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  cardIconWrapPrimary: { width: 36, height: 36, borderRadius: 10, background: '#0D5E6B', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  cardTitle: { margin: 0, fontSize: '1rem', fontWeight: 700, color: '#1F2937', fontFamily: 'Inter, sans-serif' },
  cardTitlePrimary: { margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#0D5E6B', fontFamily: 'Inter, sans-serif' },
  dataRow: { fontSize: '0.85rem', color: '#4B5563', lineHeight: 1.5, marginBottom: 8 },
  listItem: { fontSize: '0.85rem', color: '#374151', lineHeight: 1.5, marginBottom: 6 },
  emptyText: { fontSize: '0.85rem', color: '#9CA3AF', fontStyle: 'italic', margin: 0 },
  disclaimer: {
    marginTop: 32, padding: '16px 20px', background: '#FEF3C7', borderRadius: 12,
    display: 'flex', gap: 12, fontSize: '0.85rem', color: '#92400E', lineHeight: 1.5,
    border: '1px solid #FDE68A', boxShadow: '0 4px 15px rgba(146,64,14,0.05)'
  }
};
