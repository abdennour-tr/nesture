import React, { useState, useEffect } from 'react';
import { Target, Activity, Shield, Brain, AlertTriangle, FileText } from 'lucide-react';
import { supabase } from '../../services/supabaseClient';

export default function SpecialistAtlasInsights({ childName = 'Learner', childId, profile }) {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (childId) {
      setLoading(true);
      supabase.from('documents').select('*').eq('child_id', childId)
        .then(({ data }) => setDocuments(data || []))
        .catch(() => setDocuments([]))
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [childId]);

  const validDocuments = documents.filter(d => ['definitive', 'completed'].includes(d.status));
  const hasValidatedDocs = validDocuments.length > 0 || (profile && profile.completeness_percentage > 0);

  const getItemLabel = (item) => {
    if (typeof item === 'string') return item;
    if (item?.label) return item.label;
    if (item?.title) return item.title;
    if (item?.name) return item.name;
    if (item?.time) return `${item.time}: ${item.activity || ''}`;
    return 'Assessed';
  };

  const cleanLabel = (text) => {
    if (!text || typeof text !== 'string') return '';
    return text.replace(/\s*\([^)]*\)\s*$/, '');
  };

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

  // ── Derived data ──
  const strengthsRaw = hasValidatedDocs && Array.isArray(profile?.strengths) ? profile.strengths : [];
  const challengesRaw = hasValidatedDocs && Array.isArray(profile?.challenges) ? profile.challenges : [];

  const lowercaseChallenges = challengesRaw.map(c => getItemLabel(c).toLowerCase().trim());
  const strengths = strengthsRaw.filter(s => {
    const label = getItemLabel(s).toLowerCase().trim();
    if (label.includes('non-verbal') || label.includes('non verbal')) return false;
    return !lowercaseChallenges.includes(label);
  });
  const challenges = challengesRaw;

  const commProfile = hasValidatedDocs ? (profile?.communication_profile || {}) : {};
  const commItems = Object.entries(commProfile)
    .filter(([_, val]) => isValidAIExtraction(val))
    .map(([key, val]) => {
      const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      const displayVal = Array.isArray(val) ? val.join(', ') : typeof val === 'object' ? JSON.stringify(val) : val;
      return `${label}: ${displayVal}`;
    });

  const sensoryProfile = hasValidatedDocs ? (profile?.sensory_profile || {}) : {};
  const sensoryItems = Object.entries(sensoryProfile)
    .filter(([_, val]) => isValidAIExtraction(val))
    .map(([key, val]) => {
      const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      const displayVal = Array.isArray(val) ? val.join(', ') : typeof val === 'object' ? JSON.stringify(val) : val;
      return `${label}: ${displayVal}`;
    });

  const rawWellness = Array.isArray(profile?.functional_wellness) ? profile.functional_wellness : [];
  const wellnessItems = rawWellness.filter(item => {
    if (!item) return false;
    if (typeof item === 'object') {
      if (item.name === 'score' || item.name === 'band') return false;
      if (!item.status || item.status === 'Not sure' || item.status === 'Not assessed' || item.status === 'Unknown') return false;
    }
    if (typeof item === 'string') {
      const lower = item.toLowerCase();
      if (lower === 'score' || lower === 'band' || lower.includes('not sure') || lower.includes('not assessed')) return false;
    }
    return true;
  });

  const rawMotor = Array.isArray(profile?.motor_reflexes) ? profile.motor_reflexes : [];
  const motorReflexes = rawMotor.filter(item => {
    if (!item) return false;
    if (typeof item === 'object') {
      if (item.name === 'score' || item.name === 'band') return false;
      if (!item.status || item.status === 'Not sure' || item.status === 'Not assessed' || item.status === 'Unknown') return false;
    }
    if (typeof item === 'string') {
      const lower = item.toLowerCase();
      if (lower === 'score' || lower === 'band' || lower.includes('not sure') || lower.includes('not assessed')) return false;
    }
    return true;
  });

  // ── Card Evidence and Source helper ──
  const getCardEvidenceAndSource = (domainKey) => {
    if (!validDocuments || validDocuments.length === 0) {
      return { source: 'Evidence Required', quotes: [] };
    }

    const keywordMap = {
      'domain-1': ['development', 'cognitive', 'behavior', 'regulation', 'strength', 'challenge', 'verbal', 'motor'],
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

  if (loading) {
    return (
      <div style={{ ...styles.container, padding: 24, textAlign: 'center', color: '#6B7280' }}>
        Loading clinical insights...
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={styles.iconWrap}>
            <Brain size={20} color="#0D5E6B" />
          </div>
          <div>
            <h2 style={styles.title}>Atlas Insights</h2>
            <p style={styles.subtitle}>
              AI-synthesized profile from {validDocuments.length} validated document{validDocuments.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
      </div>

      <div style={styles.grid}>
        
        {/* COLUMN 1: Profiles */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          
          {/* Communication Profile */}
          <div style={styles.card}>
            <h3 style={styles.cardTitle}>Communication Profile</h3>
            {commItems.length > 0 ? (
              <ul style={styles.list}>
                {commItems.slice(0, 4).map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            ) : (
              <p style={{ fontSize: '0.85rem', color: '#6B7280', fontStyle: 'italic', margin: '0 0 16px' }}>Not Assessed</p>
            )}
            {renderSourceFooter('domain-10')}
          </div>

          {/* Learning & Sensory Style */}
          <div style={styles.card}>
            <h3 style={styles.cardTitle}>Learning & Sensory Style</h3>
            {sensoryItems.length > 0 ? (
              <ul style={styles.list}>
                {sensoryItems.slice(0, 4).map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            ) : (
              <p style={{ fontSize: '0.85rem', color: '#6B7280', fontStyle: 'italic', margin: '0 0 16px' }}>Not Assessed</p>
            )}
            {renderSourceFooter('domain-5')}
          </div>

          {/* Strengths & Challenges Tags */}
          <div style={{ display: 'flex', gap: 16 }}>
            <div style={{ ...styles.card, flex: 1, borderTop: '4px solid #10B981', display: 'flex', flexDirection: 'column' }}>
              <h3 style={styles.cardTitle}>Strengths</h3>
              <div style={{ ...styles.tagsContainer, marginBottom: 12 }}>
                {strengths.length > 0 ? (
                  strengths.slice(0, 4).map((s, i) => (
                    <span key={i} style={{...styles.tag, background: '#D1FAE5', color: '#065F46'}}>{cleanLabel(getItemLabel(s))}</span>
                  ))
                ) : (
                  <span style={{ fontSize: '0.85rem', color: '#6B7280', fontStyle: 'italic' }}>Not Assessed</span>
                )}
              </div>
              {renderSourceFooter('domain-1')}
            </div>
            
            <div style={{ ...styles.card, flex: 1, borderTop: '4px solid #EF4444', display: 'flex', flexDirection: 'column' }}>
              <h3 style={styles.cardTitle}>Challenges</h3>
              <div style={{ ...styles.tagsContainer, marginBottom: 12 }}>
                {challenges.length > 0 ? (
                  challenges.slice(0, 4).map((c, i) => (
                    <span key={i} style={{...styles.tag, background: '#FEE2E2', color: '#991B1B'}}>{cleanLabel(getItemLabel(c))}</span>
                  ))
                ) : (
                  <span style={{ fontSize: '0.85rem', color: '#6B7280', fontStyle: 'italic' }}>Not Assessed</span>
                )}
              </div>
              {renderSourceFooter('domain-1')}
            </div>
          </div>
        </div>

        {/* COLUMN 2: Profile Deep Dive */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          
          {/* Primitive Motor Reflex Profile */}
          <div style={styles.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={styles.cardTitle}><Activity size={16} /> Primitive Motor Reflex Profile</h3>
              {motorReflexes.length > 0 && <span style={styles.definitiveBadge}>VALIDATED</span>}
            </div>
            
            <div style={{ ...styles.reflexGrid, marginBottom: 12 }}>
              {motorReflexes.length > 0 ? (
                motorReflexes.slice(0, 4).map(r => {
                  const label = r.severity || r.status || r.label || 'Not Assessed';
                  let badgeBg = '#F3F4F6', badgeColor = '#6B7280';
                  const lowerLabel = String(label).toLowerCase();
                  if (lowerLabel.includes('severe') || lowerLabel.includes('retained') || lowerLabel.includes('strong')) {
                    badgeBg = '#FEE2E2'; badgeColor = '#991B1B';
                  } else if (lowerLabel.includes('mod') || lowerLabel.includes('emerging') || lowerLabel.includes('mild') || lowerLabel.includes('weak')) {
                    badgeBg = '#FEF3C7'; badgeColor = '#92400E';
                  } else if (lowerLabel.includes('integrated') || lowerLabel.includes('typical') || lowerLabel.includes('none')) {
                    badgeBg = '#D1FAE5'; badgeColor = '#065F46';
                  }
                  
                  return (
                    <div key={r.name} style={styles.reflexRow}>
                      <span style={styles.reflexName}>{r.name}</span>
                      <span style={{...styles.severityBadge, background: badgeBg, color: badgeColor}}>{label}</span>
                    </div>
                  );
                })
              ) : (
                <div style={{ fontStyle: 'italic', color: '#6B7280', padding: '10px 0' }}>Not Assessed</div>
              )}
            </div>

            {hasValidatedDocs && motorReflexes.some(r => r.severity === 'Severe' || r.severity === 'Retained') && (
              <div style={styles.derivedInsight}>
                <strong>AI Cross-Report Insight (DERIVED):</strong> Retained reflexes correlate with reported motor challenges. Recommend bilateral integration exercises.
              </div>
            )}
            {renderSourceFooter('domain-9')}
          </div>

          {/* Functional Wellness Insights */}
          <div style={styles.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={styles.cardTitle}><Shield size={16} /> Functional Wellness Insights</h3>
              {wellnessItems.length > 0 && <span style={styles.definitiveBadge}>VALIDATED</span>}
            </div>
            
            <div style={{ marginBottom: 16 }}>
              {wellnessItems.length > 0 ? (
                <ul style={styles.list}>
                  {wellnessItems.slice(0, 3).map((fw, i) => (
                    <li key={i} style={{ marginBottom: 6 }}>
                      <strong>{fw.title}:</strong> {fw.description}
                    </li>
                  ))}
                </ul>
              ) : (
                <p style={{ fontSize: '0.85rem', color: '#6B7280', fontStyle: 'italic', margin: 0 }}>Not Assessed</p>
              )}
            </div>

            <div style={styles.disclaimer}>
              <AlertTriangle size={14} color="#B45309" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <strong>Disclaimer:</strong> "DERIVED" insights are generated by NestureAI by cross-referencing uploaded documents. They are not medical diagnoses and must be validated by a licensed specialist.
              </div>
            </div>
            {renderSourceFooter('domain-6')}
          </div>

        </div>
    </div>
  );
}

const styles = {
  container: {
    background: '#fff', borderRadius: 16, border: '1px solid #E5E7EB',
    overflow: 'hidden',
  },
  header: {
    padding: '20px 24px', background: '#F9FAFB', borderBottom: '1px solid #E5E7EB',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
  },
  iconWrap: {
    width: 40, height: 40, borderRadius: 12, background: '#EEF6F8',
    display: 'flex', alignItems: 'center', justifyContent: 'center'
  },
  title: {
    fontFamily: 'Inter, sans-serif', fontSize: '1.2rem', fontWeight: 800, color: '#111827', margin: '0 0 2px 0'
  },
  subtitle: {
    fontSize: '0.8rem', color: '#6B7280', margin: 0
  },
  grid: {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, padding: 24,
    background: '#F3F4F6'
  },
  card: {
    background: '#fff', borderRadius: 12, padding: 20,
    boxShadow: '0 2px 4px rgba(0,0,0,0.02)',
    display: 'flex',
    flexDirection: 'column',
    gap: 12
  },
  cardTitle: {
    fontFamily: 'Inter, sans-serif', fontSize: '1rem', fontWeight: 700, color: '#1F2937',
    margin: 0, display: 'flex', alignItems: 'center', gap: 8
  },
  list: {
    margin: 0, paddingLeft: 20, color: '#4B5563', fontSize: '0.85rem', lineHeight: 1.6
  },
  tagsContainer: {
    display: 'flex', flexWrap: 'wrap', gap: 8
  },
  tag: {
    padding: '4px 10px', borderRadius: 16, fontSize: '0.75rem', fontWeight: 600
  },
  definitiveBadge: {
    background: '#1F2937', color: '#fff', fontSize: '0.65rem', fontWeight: 800,
    padding: '4px 8px', borderRadius: 4, letterSpacing: '0.05em'
  },
  reflexGrid: {
    display: 'flex', flexDirection: 'column', gap: 8
  },
  reflexRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '8px 12px', background: '#F9FAFB', borderRadius: 8, border: '1px solid #E5E7EB'
  },
  reflexName: {
    fontSize: '0.85rem', fontWeight: 600, color: '#374151'
  },
  severityBadge: {
    fontSize: '0.7rem', fontWeight: 700, padding: '2px 8px', borderRadius: 12
  },
  derivedInsight: {
    background: '#EEF6F8', borderLeft: '4px solid #1A8FA0', padding: '12px 16px',
    fontSize: '0.8rem', color: '#0D5E6B', borderRadius: '0 8px 8px 0',
    lineHeight: 1.5
  },
  disclaimer: {
    display: 'flex', gap: 12, background: '#FEF3C7', padding: '12px 16px',
    borderRadius: 8, fontSize: '0.75rem', color: '#92400E', lineHeight: 1.5
  }
};
