import React from 'react';
import { motion } from 'framer-motion';
import { Users, BookOpen, ExternalLink, MessageCircle, PlayCircle, Star } from 'lucide-react';

export default function NestureAIHub({ childName = 'your child' }) {
  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>NestureAI Hub</h2>
        <p style={styles.subtitle}>Curated specialists and learning resources tailored for {childName}</p>
      </div>

      <div style={styles.grid}>
        {/* Column 1: Your Specialists */}
        <div style={styles.column}>
          <div style={styles.columnHeader}>
            <Users size={20} color="#0D5E6B" />
            <h3 style={styles.columnTitle}>Your Specialists</h3>
          </div>
          
          <div style={styles.cardList}>
            {/* Specialist Card 1 */}
            <motion.div whileHover={{ y: -2 }} style={styles.card}>
              <div style={styles.specialistHeader}>
                <div style={styles.avatarWrap}>
                  <img src="https://i.pravatar.cc/150?img=32" alt="Dr. Sarah" style={styles.avatar} />
                </div>
                <div>
                  <h4 style={styles.cardName}>Dr. Sarah Jenkins</h4>
                  <p style={styles.cardRole}>Pediatric Occupational Therapist</p>
                </div>
              </div>
              <div style={styles.tags}>
                <span style={styles.tag}>Fine Motor</span>
                <span style={styles.tag}>Sensory Integration</span>
              </div>
              <div style={styles.actions}>
                <button style={styles.primaryBtn}><MessageCircle size={14} /> Message</button>
                <button style={styles.secondaryBtn}>View Profile</button>
              </div>
            </motion.div>

            {/* Specialist Card 2 */}
            <motion.div whileHover={{ y: -2 }} style={styles.card}>
              <div style={styles.specialistHeader}>
                <div style={styles.avatarWrap}>
                  <img src="https://i.pravatar.cc/150?img=11" alt="Mark D." style={styles.avatar} />
                </div>
                <div>
                  <h4 style={styles.cardName}>Mark Davis, SLP</h4>
                  <p style={styles.cardRole}>Speech-Language Pathologist</p>
                </div>
              </div>
              <div style={styles.tags}>
                <span style={styles.tag}>AAC Devices</span>
                <span style={styles.tag}>Expressive Language</span>
              </div>
              <div style={styles.actions}>
                <button style={styles.primaryBtn}><MessageCircle size={14} /> Message</button>
                <button style={styles.secondaryBtn}>View Profile</button>
              </div>
            </motion.div>
          </div>
        </div>

        {/* Column 2: Learning Content */}
        <div style={styles.column}>
          <div style={styles.columnHeader}>
            <BookOpen size={20} color="#E8841A" />
            <h3 style={styles.columnTitle}>Learning Content</h3>
          </div>
          
          <div style={styles.cardList}>
            {/* Content Card 1 */}
            <motion.div whileHover={{ y: -2 }} style={styles.contentCard}>
              <div style={styles.contentImageWrap}>
                <div style={{...styles.contentImage, background: 'linear-gradient(135deg, #10B981, #059669)'}}>
                  <PlayCircle size={32} color="#fff" />
                </div>
                <div style={styles.durationBadge}>4 min video</div>
              </div>
              <div style={styles.contentBody}>
                <div style={styles.contentMeta}>
                  <span style={styles.contentCategory}>Sensory Processing</span>
                  <span style={styles.aiRecommended}><Star size={10} fill="#E8841A" color="#E8841A"/> AI Recommended</span>
                </div>
                <h4 style={styles.contentTitle}>Managing Auditory Overload at Home</h4>
                <p style={styles.contentDesc}>Practical strategies to create a calm environment and recognize early signs of sensory fatigue.</p>
                <button style={styles.textBtn}>Watch Now <ExternalLink size={14} /></button>
              </div>
            </motion.div>

            {/* Content Card 2 */}
            <motion.div whileHover={{ y: -2 }} style={styles.contentCard}>
              <div style={styles.contentImageWrap}>
                <div style={{...styles.contentImage, background: 'linear-gradient(135deg, #3B82F6, #2563EB)'}}>
                  <BookOpen size={28} color="#fff" />
                </div>
                <div style={styles.durationBadge}>6 min read</div>
              </div>
              <div style={styles.contentBody}>
                <div style={styles.contentMeta}>
                  <span style={styles.contentCategory}>Fine Motor</span>
                </div>
                <h4 style={styles.contentTitle}>Pincer Grasp Development Activities</h4>
                <p style={styles.contentDesc}>Fun, everyday games using household items to strengthen hand-eye coordination and grip.</p>
                <button style={styles.textBtn}>Read Article <ExternalLink size={14} /></button>
              </div>
            </motion.div>
          </div>
        </div>
        
      </div>
    </div>
  );
}

const styles = {
  container: {
    background: '#fff', borderRadius: 16, border: '1px solid #E5E7EB', overflow: 'hidden',
    boxShadow: '0 4px 6px rgba(0,0,0,0.02)', padding: 24
  },
  header: {
    marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid #F3F4F6'
  },
  title: {
    fontFamily: 'Inter, sans-serif', fontSize: '1.4rem', fontWeight: 800, color: '#111827', margin: '0 0 4px 0'
  },
  subtitle: {
    fontSize: '0.85rem', color: '#6B7280', margin: 0
  },
  grid: {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32,
    alignItems: 'start' // Ensure columns don't stretch to match height unnecessarily
  },
  column: {
    display: 'flex', flexDirection: 'column', gap: 16
  },
  columnHeader: {
    display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4
  },
  columnTitle: {
    fontFamily: 'Inter, sans-serif', fontSize: '1.1rem', fontWeight: 700, color: '#1F2937', margin: 0
  },
  cardList: {
    display: 'flex', flexDirection: 'column', gap: 16
  },
  card: {
    background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 12, padding: 20,
    display: 'flex', flexDirection: 'column', gap: 14, transition: 'box-shadow 0.2s'
  },
  specialistHeader: {
    display: 'flex', alignItems: 'center', gap: 14
  },
  avatarWrap: {
    width: 56, height: 56, borderRadius: '50%', overflow: 'hidden', border: '2px solid #fff',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
  },
  avatar: {
    width: '100%', height: '100%', objectFit: 'cover'
  },
  cardName: {
    fontFamily: 'Inter, sans-serif', fontSize: '1rem', fontWeight: 700, color: '#111827', margin: '0 0 2px 0'
  },
  cardRole: {
    fontSize: '0.75rem', color: '#6B7280', margin: 0, fontWeight: 500
  },
  tags: {
    display: 'flex', flexWrap: 'wrap', gap: 6
  },
  tag: {
    background: '#EEF6F8', color: '#0D5E6B', padding: '4px 10px', borderRadius: 12,
    fontSize: '0.7rem', fontWeight: 600
  },
  actions: {
    display: 'flex', gap: 10, marginTop: 4
  },
  primaryBtn: {
    flex: 1, background: '#0D5E6B', color: '#fff', border: 'none', padding: '8px 12px',
    borderRadius: 8, fontSize: '0.8rem', fontWeight: 600, display: 'flex', alignItems: 'center',
    justifyContent: 'center', gap: 6, cursor: 'pointer', transition: 'background 0.2s'
  },
  secondaryBtn: {
    flex: 1, background: '#fff', color: '#374151', border: '1px solid #D1D5DB', padding: '8px 12px',
    borderRadius: 8, fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', transition: 'background 0.2s'
  },
  
  contentCard: {
    background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, overflow: 'hidden',
    display: 'flex', flexDirection: 'column', transition: 'box-shadow 0.2s',
    boxShadow: '0 2px 8px rgba(0,0,0,0.04)'
  },
  contentImageWrap: {
    position: 'relative', height: 120, width: '100%'
  },
  contentImage: {
    width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center'
  },
  durationBadge: {
    position: 'absolute', bottom: 8, right: 8, background: 'rgba(0,0,0,0.7)', color: '#fff',
    fontSize: '0.65rem', fontWeight: 600, padding: '2px 8px', borderRadius: 12
  },
  contentBody: {
    padding: 16, display: 'flex', flexDirection: 'column', gap: 8
  },
  contentMeta: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
  },
  contentCategory: {
    fontSize: '0.7rem', color: '#6B7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em'
  },
  aiRecommended: {
    background: '#FEF3C7', color: '#B45309', padding: '2px 8px', borderRadius: 10,
    fontSize: '0.65rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4
  },
  contentTitle: {
    fontFamily: 'Inter, sans-serif', fontSize: '0.95rem', fontWeight: 700, color: '#1F2937', margin: 0,
    lineHeight: 1.3
  },
  contentDesc: {
    fontSize: '0.8rem', color: '#4B5563', margin: 0, lineHeight: 1.5,
    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden'
  },
  textBtn: {
    background: 'none', border: 'none', color: '#0D5E6B', fontSize: '0.8rem', fontWeight: 700,
    padding: 0, marginTop: 4, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer',
    alignSelf: 'flex-start'
  }
};
