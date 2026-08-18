import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle, Sparkles, Play, Video } from 'lucide-react';
import VideoModal from './VideoModal';
import api from '../../services/api';
import { supabase } from '../../services/supabaseClient';

export default function AssignedExercises({ childId }) {
  const [prescriptions, setPrescriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeVideoUrl, setActiveVideoUrl] = useState(null);
  const [activeVideoTitle, setActiveVideoTitle] = useState('');

  useEffect(() => {
    if (!childId) return;

    const fetchPrescriptions = async () => {
      try {
        const res = await api.get(`/exercises/prescriptions/${childId}`);
        setPrescriptions(res.data?.filter(p => p.status === 'active') || []);
      } catch (err) {
        console.error('[AssignedExercises] Failed to load prescriptions:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchPrescriptions();

    const channel = supabase
      .channel(`prescriptions_parent_${childId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'prescriptions',
          filter: `learner_id=eq.${childId}`,
        },
        () => {
          fetchPrescriptions();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [childId]);

  if (loading) {
    return (
      <div className="card" style={{ padding: 28, marginBottom: 24, textAlign: 'center', color: '#9CA3AF' }}>
        <span className="spinner" style={{ width: 24, height: 24, borderWidth: 2, display: 'inline-block', marginBottom: 12 }} />
        <p>Loading exercises...</p>
      </div>
    );
  }

  if (!prescriptions || prescriptions.length === 0) return (
    <div className="card" style={{ padding: 28, marginBottom: 24, textAlign: 'center', color: '#9CA3AF' }}>
      <p>No exercises assigned at this time.</p>
    </div>
  );

  return (
    <>
      <div className="card" style={{ padding: 28, marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
          <div style={{ background: '#FFF7ED', padding: 8, borderRadius: 10 }}>
            <Video size={24} color="#E8841A" />
          </div>
          <div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#0D3D47', margin: 0 }}>Assigned Exercises</h2>
            <p style={{ fontSize: '0.85rem', color: '#6B7280', margin: '4px 0 0' }}>Therapeutic exercises assigned by your specialist</p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {prescriptions.map((pres) => (
            <motion.div 
              key={pres.id} 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              style={styles.prescriptionCard}
            >
              <div style={styles.assignedBadge}>
                <CheckCircle size={12} /> Assigned by {pres.specialist ? `${pres.specialist.first_name || ''} ${pres.specialist.last_name || ''}`.trim() : 'Specialist'}
              </div>
              <div style={styles.prescriptionBody}>
                <div style={styles.prescriptionTitle}>
                  {pres.exercise?.name || 'Exercise'}
                </div>
                <div style={styles.prescriptionTarget}>
                  Target Reflex: <strong>{pres.exercise?.target_reflex || 'General'}</strong>
                </div>
                {pres.notes && (
                  <div style={styles.prescriptionNotes}>
                    💡 {pres.notes}
                  </div>
                )}
                <div style={styles.prescriptionDate}>
                  Assigned on {new Date(pres.prescribed_at).toLocaleDateString()}
                </div>
                <div style={styles.prescriptionFooter}>
                  <span style={styles.durationChip}>
                    {pres.exercise?.duration_minutes || 5} min
                  </span>
                  {pres.exercise?.video_url && (
                    <button
                      onClick={() => {
                        setActiveVideoUrl(pres.exercise.video_url);
                        setActiveVideoTitle(pres.exercise.name);
                      }}
                      style={{ ...styles.actionBtn, background: '#C2410C', cursor: 'pointer' }}
                    >
                      <Play size={12} color="#fff" /> Watch Video
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      <VideoModal 
        isOpen={!!activeVideoUrl} 
        videoUrl={activeVideoUrl} 
        title={activeVideoTitle}
        onClose={() => setActiveVideoUrl(null)} 
      />
    </>
  );
}

const styles = {
  prescriptionCard: {
    background: '#fff', borderRadius: 16, border: '2px solid #FED7AA', overflow: 'hidden',
    boxShadow: '0 4px 15px rgba(234,88,12,0.06)'
  },
  assignedBadge: {
    background: 'linear-gradient(135deg, #EA580C, #C2410C)', color: '#fff',
    padding: '8px 14px', fontSize: '0.75rem', fontWeight: 700,
    display: 'flex', alignItems: 'center', gap: 6, letterSpacing: '0.05em'
  },
  prescriptionBody: { padding: 20 },
  prescriptionTitle: { fontSize: '1.1rem', fontWeight: 800, color: '#1F2937', marginBottom: 6 },
  prescriptionTarget: { fontSize: '0.8rem', color: '#6B7280', marginBottom: 12 },
  prescriptionNotes: { background: '#FFFBEB', color: '#B45309', padding: '10px 14px', borderRadius: 8, fontSize: '0.85rem', fontWeight: 500, marginBottom: 14, borderLeft: '4px solid #F59E0B' },
  prescriptionDate: { fontSize: '0.75rem', color: '#9CA3AF', marginBottom: 14, fontWeight: 500 },
  prescriptionFooter: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  durationChip: { background: '#F3F4F6', color: '#4B5563', padding: '4px 10px', borderRadius: 20, fontSize: '0.75rem', fontWeight: 700 },
  actionBtn: { border: 'none', display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10, color: '#fff', fontSize: '0.8rem', fontWeight: 700, transition: 'transform 0.2s, box-shadow 0.2s', boxShadow: '0 4px 10px rgba(194,65,12,0.3)' }
};
