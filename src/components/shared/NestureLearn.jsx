import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Headphones, BookOpen, ChevronDown, ChevronUp, ExternalLink, Sparkles, CheckCircle } from 'lucide-react';
import api from '../../services/api';
import { supabase } from '../../services/supabaseClient';

/* ── Tag extraction from Atlas profile ──────────────────────────────────────── */
function extractTagsFromAtlas(atlas) {
  if (!atlas) return [];
  const tags = new Set();

  if (atlas.sensory_profile && Object.keys(atlas.sensory_profile).length > 0) tags.add('sensory');
  if (atlas.motor_reflexes?.length > 0) tags.add('reflex');
  if (atlas.communication_profile && Object.keys(atlas.communication_profile).length > 0) tags.add('communication');
  if (atlas.functional_wellness?.length > 0) tags.add('functional_wellness');
  if (atlas.home_plan?.daily_routine) tags.add('daily_living');
  if (atlas.strengths?.length > 0 || atlas.challenges?.length > 0) tags.add('developmental');

  return [...tags];
}

/* ── Type icon & button label helpers ───────────────────────────────────────── */
const TYPE_CONFIG = {
  video:   { icon: Play,        label: 'Watch',  color: '#EF4444', bg: '#FEE2E2' },
  podcast: { icon: Headphones,  label: 'Listen', color: '#8B5CF6', bg: '#EDE9FE' },
  article: { icon: BookOpen,    label: 'Read',   color: '#0D5E6B', bg: '#EEF6F8' },
};

/* ════════════════════════════════════════════════════════════════════════════ */
export default function NestureLearn({ childId, childName }) {
  const [content, setContent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [childTags, setChildTags] = useState([]);


  useEffect(() => {
    if (!childId) return;
    setLoading(true);
    setExpanded(false);

    (async () => {
      try {
        // 1. Get Atlas profile to extract relevant tags
        let tags = [];
        try {
          const atlasRes = await api.get(`/atlas-profiles/${childId}`);
          tags = extractTagsFromAtlas(atlasRes.data);
          setChildTags(tags);
        } catch {
          setChildTags([]);
        }

        // 2. Fetch content matching tags (or all if no tags)
        const tagsQuery = tags.length > 0 ? `?tags=${tags.join(',')}` : '';
        const res = await api.get(`/learn-content${tagsQuery}`);
        setContent(res.data || []);
      } catch (err) {
        console.error('[NestureLearn] Failed to load content:', err);
        setContent([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [childId]);

  const visibleItems = expanded ? content : content.slice(0, 6);
  const hasMore = content.length > 6;
  const otherItemsCount = content.length - 6;
 
  if (loading && content.length === 0) {
    return (
      <div style={{ padding: 28 }}>
        <div style={styles.headerRow}>
          <div>
            <div style={styles.sectionTitle}>
              <Sparkles size={20} color="#E8841A" /> NestureLearn
            </div>
            <div style={styles.sectionSub}>Loading recommendations...</div>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <div className="spinner" />
        </div>
      </div>
    );
  }

  if (content.length === 0) return null;

  return (
    <div className="card" style={{ padding: 28, marginBottom: 24 }}>
      {/* ── Header ── */}
      <div style={styles.headerRow}>
        <div>
          <div style={styles.sectionTitle}>
            <Sparkles size={20} color="#E8841A" /> NestureLearn
            {loading && <span className="spinner" style={{ width: 14, height: 14, borderWidth: 1.5, marginLeft: 8, display: 'inline-block' }} />}
          </div>
          <div style={styles.sectionSub}>
            Recommended for <strong>{childName}</strong>
          </div>
        </div>
        {(content.length > 0) && (
          <div style={styles.countBadge}>
            {content.length} resource{content.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* ── Recommendations Cards Grid ── */}
      {content.length > 0 && (
        <>
          <div style={{ ...styles.grid, opacity: loading ? 0.75 : 1, transition: 'opacity 0.2s' }} className="nesture-learn-grid">
            <AnimatePresence mode="popLayout">
              {visibleItems.map((item, i) => (
                <ContentCard key={item.id} item={item} index={i} childTags={childTags} />
              ))}
            </AnimatePresence>
          </div>

          {/* ── See more / less ── */}
          {hasMore && (
            <motion.button
              onClick={() => setExpanded(prev => !prev)}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              style={styles.seeMoreBtn}
            >
              {expanded ? (
                <><ChevronUp size={16} /> Show less</>
              ) : (
                <><ChevronDown size={16} /> See {otherItemsCount} more resource{otherItemsCount !== 1 ? 's' : ''}</>
              )}
            </motion.button>
          )}
        </>
      )}
    </div>
  );
}

/* ── Content Card Component ─────────────────────────────────────────────────── */
const ContentCard = React.forwardRef(({ item, index, childTags = [] }, ref) => {
  const config = TYPE_CONFIG[item.type] || TYPE_CONFIG.article;
  const Icon = config.icon;
  const isRecommended = childTags.length > 0 && Array.isArray(item.tags) && item.tags.some(t => childTags.includes(t));

  return (
    <motion.div
      ref={ref}
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ delay: index * 0.06, duration: 0.3 }}
      style={styles.card}
    >
      {/* Thumbnail */}
      <div style={styles.thumbnailWrap}>
        {item.thumbnail_url ? (
          <img src={item.thumbnail_url} alt={item.title} style={styles.thumbnail} loading="lazy" />
        ) : (
          <div style={{ ...styles.thumbnail, background: config.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon size={32} color={config.color} />
          </div>
        )}
        {/* Badges container */}
        <div style={{ position: 'absolute', top: 10, right: 10, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end', zIndex: 10 }}>
          {item.featured && (
            <div style={{
              background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(4px)',
              padding: '4px 10px', borderRadius: 8,
              fontSize: '0.68rem', fontWeight: 800, color: '#B45309',
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            }}>⭐ Featured</div>
          )}
          {isRecommended && (
            <div style={{
              background: 'rgba(238,246,248,0.95)', backdropFilter: 'blur(4px)',
              padding: '4px 10px', borderRadius: 8,
              fontSize: '0.68rem', fontWeight: 800, color: '#0D5E6B',
              border: '1px solid #C8E8ED',
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            }}>💡 Recommended</div>
          )}
        </div>
        {/* Type badge */}
        <div style={{ ...styles.typeBadge, background: config.bg, color: config.color }}>
          <Icon size={12} /> {item.type.charAt(0).toUpperCase() + item.type.slice(1)}
        </div>
      </div>

      {/* Info */}
      <div style={styles.cardBody}>
        <div style={styles.cardTitle}>{item.title}</div>
        {item.description && (
          <div style={styles.cardDesc}>{item.description}</div>
        )}
        <div style={styles.cardFooter}>
          <span style={styles.durationChip}>{item.duration}</span>
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ ...styles.actionBtn, background: config.color }}
            onClick={e => e.stopPropagation()}
          >
            <Icon size={14} color="#fff" /> {config.label} <ExternalLink size={12} color="#fff" />
          </a>
        </div>
      </div>
    </motion.div>
  );
});

/* ── Styles ─────────────────────────────────────────────────────────────────── */
const styles = {
  headerRow: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    marginBottom: 20, gap: 12, flexWrap: 'wrap',
  },
  sectionTitle: {
    fontFamily: 'Inter, sans-serif', fontWeight: 800, fontSize: '1.15rem', color: '#0D5E6B',
    display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4,
  },
  sectionSub: {
    fontSize: '0.82rem', color: '#6B7280', fontWeight: 500,
  },
  countBadge: {
    background: '#FFF7ED', border: '1px solid #FDBA74', color: '#C2410C',
    padding: '4px 12px', borderRadius: 20, fontSize: '0.72rem', fontWeight: 700,
    whiteSpace: 'nowrap',
  },

  grid: {
    display: 'grid', gap: 16,
  },

  card: {
    borderRadius: 16, overflow: 'hidden', border: '1px solid #E5E7EB',
    background: '#fff', transition: 'box-shadow 0.2s, transform 0.2s',
    cursor: 'default',
  },

  thumbnailWrap: {
    position: 'relative', paddingBottom: '45%', background: '#F3F4F6', overflow: 'hidden',
  },
  thumbnail: {
    position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover',
  },
  featuredBadge: {
    position: 'absolute', top: 10, right: 10,
    background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(4px)',
    padding: '4px 10px', borderRadius: 8,
    fontSize: '0.68rem', fontWeight: 700, color: '#B45309',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
  },
  typeBadge: {
    position: 'absolute', bottom: 10, left: 10,
    padding: '3px 10px', borderRadius: 8,
    fontSize: '0.68rem', fontWeight: 700,
    display: 'flex', alignItems: 'center', gap: 4,
    backdropFilter: 'blur(4px)',
  },

  cardBody: {
    padding: '10px 12px 12px',
  },
  cardTitle: {
    fontFamily: 'Inter, sans-serif', fontWeight: 700, fontSize: '0.88rem', color: '#111827',
    lineHeight: 1.3, marginBottom: 6,
    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
  },
  cardDesc: {
    fontSize: '0.7rem', color: '#6B7280', lineHeight: 1.4, marginBottom: 8,
    display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden',
  },
  cardFooter: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
  },
  durationChip: {
    fontSize: '0.7rem', fontWeight: 600, color: '#9CA3AF',
    background: '#F9FAFB', padding: '3px 8px', borderRadius: 6,
  },
  actionBtn: {
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '4px 10px', borderRadius: 10, border: 'none',
    color: '#fff', fontSize: '0.7rem', fontWeight: 700,
    textDecoration: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
    transition: 'opacity 0.2s',
  },

  seeMoreBtn: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    width: '100%', padding: '10px', marginTop: 16,
    background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 12,
    color: '#4B5563', fontSize: '0.82rem', fontWeight: 600,
    cursor: 'pointer', transition: 'all 0.2s',
  },

  prescriptionCard: {
    borderRadius: 16, overflow: 'hidden', border: '1px solid #FDBA74',
    background: '#FFFDFB', transition: 'box-shadow 0.2s, transform 0.2s',
    display: 'flex', flexDirection: 'column', position: 'relative',
    boxShadow: '0 2px 8px rgba(249, 115, 22, 0.05)',
  },
  assignedBadge: {
    background: '#FFF7ED', borderBottom: '1px solid #FFEDD5', color: '#EA580C',
    padding: '8px 16px', fontSize: '0.72rem', fontWeight: 700,
    display: 'flex', alignItems: 'center', gap: 6,
  },
  prescriptionBody: {
    padding: 16, display: 'flex', flexDirection: 'column', flex: 1,
  },
  prescriptionTitle: {
    fontFamily: 'Inter, sans-serif', fontWeight: 800, fontSize: '0.95rem', color: '#431407',
    marginBottom: 6,
  },
  prescriptionTarget: {
    fontSize: '0.76rem', color: '#7C2D12', marginBottom: 10,
  },
  prescriptionNotes: {
    fontSize: '0.78rem', color: '#7C2D12', background: '#FFF7ED',
    padding: '8px 12px', borderRadius: 8, borderLeft: '3px solid #F97316',
    marginBottom: 12, lineHeight: 1.4,
  },
  prescriptionDate: {
    fontSize: '0.7rem', color: '#9CA3AF', marginBottom: 12, marginTop: 'auto',
  },
  prescriptionFooter: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
  },
};
