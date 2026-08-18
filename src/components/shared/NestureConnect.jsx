import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, ChevronDown, ChevronUp, CheckCircle, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';

/**
 * NestureConnect — Specialist Directory
 * Displays a grid of real practitioners from Supabase.
 * "Connect" button triggers the existing parentRequestConnection flow.
 */
export default function NestureConnect({ childName = 'your child', childId, parentId, connectedIds = [], pendingIds = [] }) {
  const [specialists, setSpecialists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [connectingId, setConnectingId] = useState(null);
  const [sentIds, setSentIds] = useState(new Set());
  const [fetchedPendingIds, setFetchedPendingIds] = useState(new Set());

  useEffect(() => {
    loadSpecialists();
    if (parentId) {
      api.get(`/connections/pending/${parentId}`)
        .then(res => {
          const reqs = res.data || [];
          const specIds = reqs.map(r => r.practitioner_id).filter(Boolean);
          setFetchedPendingIds(new Set(specIds));
        })
        .catch(() => {});
    }
  }, [parentId]);

  const loadSpecialists = async () => {
    setLoading(true);
    try {
      const res = await api.get('/specialists');
      setSpecialists(res.data || []);
    } catch (err) {
      console.warn('[NestureConnect] Could not load specialists:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async (specialist) => {
    if (!childId || !parentId) {
      toast.error('Please select a child first.');
      return;
    }
    setConnectingId(specialist.id);
    try {
      await api.post('/connections/parent-request', {
        parentId,
        practitionerId: specialist.id,
        childId,
      });
      setSentIds(prev => new Set([...prev, specialist.id]));
      toast.success(`Request sent to ${specialist.first_name}!`, { icon: '✉️' });
    } catch (e) {
      const msg = e?.response?.data?.detail || e?.message || '';
      if (msg.includes('409') || msg.toLowerCase().includes('already') || msg.toLowerCase().includes('pending')) {
        toast.error('A connection request is already pending or you are already connected with this specialist.');
        setSentIds(prev => new Set([...prev, specialist.id]));
      } else {
        toast.error('Could not send request. Please try again.');
        console.error('[NestureConnect] connect error:', e);
      }
    } finally {
      setConnectingId(null);
    }
  };

  const featured = specialists.filter(s => s.is_featured);
  const standard = specialists.filter(s => !s.is_featured);

  if (loading) {
    return (
      <div style={S.wrapper}>
        <div style={S.headerRow}>
          <div>
            <h3 style={S.title}>NestureConnect</h3>
            <p style={S.subtitle}>Loading specialists...</p>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <div className="spinner" />
        </div>
      </div>
    );
  }

  if (specialists.length === 0) return null;

  const getSpecialtyColor = (specialty) => {
    const s = (specialty || '').toLowerCase();
    if (s.includes('occupational')) return { bg: '#EEF6F8', text: '#0D5E6B', border: '#B2DFE6' };
    if (s.includes('speech'))       return { bg: '#F3E8FF', text: '#7C3AED', border: '#C4B5FD' };
    if (s.includes('reflex'))       return { bg: '#FEF3E2', text: '#B45309', border: '#FCD34D' };
    if (s.includes('aba'))          return { bg: '#ECFDF5', text: '#065F46', border: '#86EFAC' };
    return { bg: '#F3F4F6', text: '#374151', border: '#D1D5DB' };
  };

  const renderCard = (specialist, index, isFeatured = false) => {
    const isSent = sentIds.has(specialist.id);
    const isConnecting = connectingId === specialist.id;
    const color = getSpecialtyColor(specialist.specialty);
    const initials = `${specialist.first_name?.[0] || ''}${specialist.last_name?.[0] || ''}`.toUpperCase();

    return (
      <motion.div
        key={specialist.id}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: index * 0.06, duration: 0.3 }}
        whileHover={{ y: -3, boxShadow: '0 12px 32px rgba(13,94,107,0.14)' }}
        style={{
          ...S.card,
          border: isFeatured ? '2px solid #C8E8ED' : '1.5px solid #E5E7EB',
          background: isFeatured ? 'linear-gradient(135deg, #FAFEFE, #F0FAFB)' : '#fff',
        }}
      >
        {/* Featured badge */}
        {isFeatured && (
          <div style={S.featuredBadge}>
            <Sparkles size={11} />
            Featured
          </div>
        )}

        {/* Avatar */}
        <div style={S.avatarWrap}>
          {specialist.avatar_url ? (
            <img src={specialist.avatar_url} alt={specialist.name} style={S.avatarImg} />
          ) : (
            <div style={S.avatarFallback}>{initials}</div>
          )}
        </div>

        {/* Info */}
        <div style={S.info}>
          <div style={S.name}>{specialist.name}</div>
          <div style={{
            ...S.specialtyBadge,
            background: color.bg,
            color: color.text,
            border: `1px solid ${color.border}`,
          }}>
            {specialist.specialty}
          </div>
          {specialist.practice_name && (
            <div style={{ fontSize: '0.78rem', color: '#4B5563', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
              <span>🏥</span>
              <span>{specialist.practice_name}</span>
            </div>
          )}
          {specialist.location && (
            <div style={S.locationRow}>
              <MapPin size={12} color="#9CA3AF" />
              <span>{specialist.location}</span>
            </div>
          )}
          {specialist.bio && (
            <p style={S.bio}>{specialist.bio}</p>
          )}
        </div>

        <div style={S.cardFooter}>
          {connectedIds.includes(specialist.id) ? (
            <div style={{...S.sentBadge, color: '#0D5E6B', background: '#E0F2FE'}}>
              <CheckCircle size={14} />
              Connected
            </div>
          ) : (isSent || (pendingIds && pendingIds.includes(specialist.id)) || fetchedPendingIds.has(specialist.id)) ? (
            <div style={S.sentBadge}>
              <CheckCircle size={14} />
              Request Pending
            </div>
          ) : (
            <button
              onClick={() => handleConnect(specialist)}
              disabled={isConnecting}
              style={{
                ...S.connectBtn,
                opacity: isConnecting ? 0.7 : 1,
              }}
            >
              {isConnecting ? 'Sending...' : 'Connect'}
            </button>
          )}
        </div>
      </motion.div>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      style={S.wrapper}
    >
      {/* Section header */}
      <div style={S.headerRow}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={S.iconCircle}>🤝</div>
            <h3 style={S.title}>NestureConnect</h3>
          </div>
          <p style={S.subtitle}>Find specialists for <strong>{childName}</strong></p>
        </div>
        <span style={S.countBadge}>{specialists.length} specialists</span>
      </div>

      {/* Featured cards (always visible) */}
      <div className="nesture-connect-grid" style={S.grid}>
        {featured.map((s, i) => renderCard(s, i, true))}
      </div>

      {/* See more / See less toggle */}
      {standard.length > 0 && (
        <div style={{ textAlign: 'center', marginTop: 4, marginBottom: expanded ? 12 : 0 }}>
          <button
            onClick={() => setExpanded(!expanded)}
            style={S.seeMoreBtn}
          >
            {expanded ? (
              <>See less <ChevronUp size={15} /></>
            ) : (
              <>See more ({standard.length} more) <ChevronDown size={15} /></>
            )}
          </button>
        </div>
      )}

      {/* Standard cards (expandable) */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div className="nesture-connect-grid" style={{ ...S.grid, marginTop: 0 }}>
              {standard.map((s, i) => renderCard(s, i + featured.length, false))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const S = {
  wrapper: {
    background: '#fff',
    borderRadius: 20,
    border: '1px solid #E5E7EB',
    padding: '24px 24px 20px',
    marginTop: 20,
    boxShadow: '0 1px 3px rgba(13,94,107,0.08)',
  },
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
    gap: 12,
    flexWrap: 'wrap',
  },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 12,
    background: 'linear-gradient(135deg, #EEF6F8, #C8E8ED)',
    border: '2px solid #B2DFE6',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '1.1rem',
    flexShrink: 0,
  },
  title: {
    fontFamily: 'Inter, sans-serif',
    fontSize: '1.25rem',
    fontWeight: 800,
    color: '#0D5E6B',
    margin: 0,
  },
  subtitle: {
    fontSize: '0.85rem',
    color: '#6B7280',
    margin: '6px 0 0 48px',
  },
  countBadge: {
    background: '#EEF6F8',
    color: '#0D5E6B',
    padding: '4px 12px',
    borderRadius: 20,
    fontSize: '0.75rem',
    fontWeight: 700,
    whiteSpace: 'nowrap',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: 14,
  },
  card: {
    position: 'relative',
    borderRadius: 16,
    padding: '20px 18px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    transition: 'all 0.2s',
    cursor: 'default',
  },
  featuredBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    background: 'linear-gradient(135deg, #F59E0B, #FBBF24)',
    color: '#fff',
    padding: '3px 10px',
    borderRadius: 20,
    fontSize: '0.65rem',
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    boxShadow: '0 2px 8px rgba(245,158,11,0.3)',
  },
  avatarWrap: {
    width: 52,
    height: 52,
    borderRadius: 14,
    overflow: 'hidden',
    flexShrink: 0,
  },
  avatarImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    borderRadius: 14,
  },
  avatarFallback: {
    width: '100%',
    height: '100%',
    borderRadius: 14,
    background: 'linear-gradient(135deg, #0D5E6B, #1A8FA0)',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'Inter, sans-serif',
    fontWeight: 800,
    fontSize: '1.1rem',
  },
  info: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  name: {
    fontFamily: 'Inter, sans-serif',
    fontWeight: 700,
    fontSize: '0.95rem',
    color: '#111827',
  },
  specialtyBadge: {
    display: 'inline-flex',
    alignSelf: 'flex-start',
    padding: '3px 10px',
    borderRadius: 20,
    fontSize: '0.7rem',
    fontWeight: 700,
  },
  locationRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    fontSize: '0.78rem',
    color: '#6B7280',
  },
  bio: {
    fontSize: '0.78rem',
    color: '#6B7280',
    lineHeight: 1.5,
    margin: 0,
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  },
  cardFooter: {
    marginTop: 'auto',
    paddingTop: 8,
  },
  connectBtn: {
    width: '100%',
    padding: '10px 16px',
    background: 'linear-gradient(135deg, #0D5E6B, #1A8FA0)',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    fontFamily: 'Inter, sans-serif',
    fontWeight: 700,
    fontSize: '0.82rem',
    cursor: 'pointer',
    transition: 'all 0.2s',
    boxShadow: '0 2px 8px rgba(13,94,107,0.15)',
  },
  sentBadge: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    padding: '10px 16px',
    background: '#ECFDF5',
    color: '#065F46',
    borderRadius: 10,
    fontWeight: 700,
    fontSize: '0.82rem',
    border: '1.5px solid #86EFAC',
  },
  seeMoreBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '9px 20px',
    background: '#F3F4F6',
    color: '#374151',
    border: '1.5px solid #E5E7EB',
    borderRadius: 10,
    fontWeight: 700,
    fontSize: '0.82rem',
    cursor: 'pointer',
    transition: 'all 0.2s',
    fontFamily: 'Inter, sans-serif',
  },
};
