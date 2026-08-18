import React from 'react';
import { Download } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';

/**
 * SessionReportCard
 * Shows a compact summary of one session with a PDF download button.
 */
export default function SessionReportCard({ session, showDownload = true }) {
  if (!session) return null;

  const acc      = Math.round(parseFloat(session.accuracy_score || 0) * 100);
  const rt       = parseFloat((parseFloat(session.avg_response_time_ms || 0) / 1000).toFixed(1));
  const dur      = Math.round(parseInt(session.duration_seconds || 0) / 60);
  const lpi      = session.lpi_score || '—';
  const date     = session.start_time?.slice(0, 10);
  const isGood   = acc >= 70;
  const scenario = session.scenario;

  const downloadPDF = async (e) => {
    e.stopPropagation();
    try {
      const res = await api.get(`/reports/${session.id}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a   = document.createElement('a');
      a.href     = url;
      a.download = `NestureAI_${date}_${session.id.slice(0,6)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Report downloaded!');
    } catch {
      toast.error('Could not download report');
    }
  };

  return (
    <div style={styles.card}>
      <div style={styles.left}>
        <div style={styles.date}>{date}</div>
        <div style={styles.meta}>{dur} min · {session.difficulty}</div>
      </div>

      <div style={styles.stats}>
        <div style={styles.stat}>
          <span style={{ ...styles.statVal, color: isGood ? '#10B981' : '#F59E0B' }}>{acc}%</span>
          <span style={styles.statLbl}>Accuracy</span>
        </div>
        <div style={styles.stat}>
          <span style={{ ...styles.statVal, color: '#0D5E6B' }}>{rt}s</span>
          <span style={styles.statLbl}>Avg RT</span>
        </div>
        <div style={styles.stat}>
          <span style={{ ...styles.statVal, color: '#E8841A' }}>{lpi}</span>
          <span style={styles.statLbl}>LPI</span>
        </div>
      </div>

      <div style={styles.right}>
        {scenario && (
          <span className={`badge badge-${scenario === 'happy_path' ? 'success' : 'warning'}`}>
            {scenario === 'happy_path' ? '↑ On Track' : '⚠ Monitor'}
          </span>
        )}
        {showDownload && (
          <button onClick={downloadPDF} style={styles.dlBtn} title="Download PDF">
            <Download size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

const styles = {
  card: {
    display: 'flex', alignItems: 'center', gap: 16,
    padding: '12px 16px',
    background: '#fff',
    borderRadius: 10,
    border: '1px solid #E5E7EB',
    transition: 'box-shadow 0.15s',
  },
  left: { minWidth: 90 },
  date: { fontWeight: 600, fontSize: '0.85rem', color: '#1F2937' },
  meta: { fontSize: '0.72rem', color: '#9CA3AF', marginTop: 2 },
  stats: { display: 'flex', gap: 20, flex: 1 },
  stat: { display: 'flex', flexDirection: 'column', alignItems: 'center' },
  statVal: { fontFamily: 'Inter, sans-serif', fontWeight: 700, fontSize: '0.95rem' },
  statLbl: { fontSize: '0.62rem', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.04em' },
  right: { display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' },
  dlBtn: {
    width: 28, height: 28,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: '#EEF6F8', border: '1px solid #C8E8ED',
    borderRadius: 7, cursor: 'pointer', color: '#0D5E6B',
    transition: 'all 0.15s',
  },
};
