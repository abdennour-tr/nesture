/**
 * reportBuilder.js â€” In-browser PDF report generator
 * Replaces backend/app/services/report_generator.py
 * Uses jsPDF to generate downloadable reports without a server.
 */
import { jsPDF } from 'jspdf';

// Brand colours (matching Python report_generator.py)
const TEAL   = '#0D5E6B';
const ORANGE = '#E8841A';
const CREAM  = '#EEF6F8';
const GRAY   = '#6B7280';
const DARK   = '#1F2937';
const WHITE  = '#FFFFFF';

function safeFloat(val, def = 0) {
  const n = parseFloat(val);
  return isNaN(n) ? def : n;
}
function safeInt(val, def = 0) {
  const n = parseInt(parseFloat(val));
  return isNaN(n) ? def : n;
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

function setFillHex(doc, hex) { doc.setFillColor(...hexToRgb(hex)); }
function setTextHex(doc, hex) { doc.setTextColor(...hexToRgb(hex)); }
function setDrawHex(doc, hex) { doc.setDrawColor(...hexToRgb(hex)); }

function statusText(value, goodThreshold, warnThreshold) {
  if (value >= goodThreshold) return 'Good';
  if (value >= warnThreshold) return 'Fair';
  return 'Needs Focus';
}


/** Build the jsPDF document object (shared by both export functions). */
function _buildDoc({ learner, session, reflexScores, recommendations, exercises, narrative, lpiScore }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210;
  const margin = 20;
  const contentW = W - margin * 2;
  let y = 15;

  // â”€â”€ Header â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Background rect
  setFillHex(doc, CREAM);
  doc.roundedRect(margin, y, contentW, 28, 3, 3, 'F');

  // Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  setTextHex(doc, TEAL);
  doc.text('NesturePlay Session Report', margin + 4, y + 8);

  // Subtitle
  const startDate = (session.start_time || '').slice(0, 10);
  const durationMin = Math.round(safeInt(session.duration_seconds, 0) / 60);
  const generatedAt = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  setTextHex(doc, GRAY);
  doc.text(`${learner?.name || 'Learner'} · ${startDate} · ${durationMin} min`, margin + 4, y + 15);
  doc.text(`Report ID: ${(session.id || 'N/A').slice(0, 20)} · Generated ${generatedAt}`, margin + 4, y + 20);

  // LPI badge (right side)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(26);
  setTextHex(doc, ORANGE);
  doc.text(String(lpiScore || 0), W - margin - 4, y + 18, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  setTextHex(doc, GRAY);
  doc.text('LPI', W - margin - 4, y + 8, { align: 'right' });
  doc.text('Learner Progress Index', W - margin - 4, y + 24, { align: 'right' });

  y += 35;

  // â”€â”€ Section: Session Performance â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  y = _sectionTitle(doc, 'Session Performance', margin, y, contentW);

  const acc      = (safeFloat(session.accuracy_score, 0) * 100).toFixed(1);
  const rt       = (safeFloat(session.avg_response_time_ms, 0) / 1000).toFixed(1);
  const smooth   = (safeFloat(session.trajectory_smoothness, 0) * 100).toFixed(1);
  const fatigue  = (safeFloat(session.fatigue_index, 0) * 100).toFixed(1);
  const total    = session.total_attempts || '—';
  const perfect  = session.perfect_grabs || '—';

  const metricsData = [
    ['Metric', 'Value', 'Status'],
    ['Accuracy Score',        `${acc}%`,   statusText(parseFloat(acc), 75, 60)],
    ['Avg Response Time',     `${rt}s`,    statusText(10 - parseFloat(rt), 4, 2)],
    ['Total Attempts',        String(total), '—'],
    ['Perfect Grabs',         String(perfect), '—'],
    ['Trajectory Smoothness', `${smooth}%`, statusText(parseFloat(smooth), 65, 50)],
    ['Fatigue Index',         `${fatigue}%`, statusText(100 - parseFloat(fatigue), 60, 40)],
  ];
  y = _drawTable(doc, metricsData, margin, y, [70, 40, 60], contentW);
  y += 6;

  // â”€â”€ Section: Primitive Reflex Assessment â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  y = _sectionTitle(doc, 'Primitive Reflex Integration Assessment', margin, y, contentW);

  const reflexHeader = ['Reflex', 'Score', 'Confidence', 'Status'];
  const reflexRows = reflexScores.map(r => {
    const score = safeInt(r.score || r.score, 50);
    const filled = Math.floor(score / 10);
    const bar = '[' + '='.repeat(filled) + '-'.repeat(10 - filled) + ']';
    const conf = r.confidence_level || r.confidence || 'Low';
    const status = conf === 'High' ? '! Action Recommended' : (conf === 'Medium' ? 'Monitor' : 'On Track');
    return [r.reflex_name || r.reflex || '', `${bar} ${score}`, conf, status];
  });
  y = _drawTable(doc, [reflexHeader, ...reflexRows], margin, y, [40, 50, 35, 45], contentW);
  y += 6;

  // â”€â”€ Section: Session Summary (narrative) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  y = _sectionTitle(doc, 'Session Summary', margin, y, contentW);

  setFillHex(doc, CREAM);
  setDrawHex(doc, TEAL);
  doc.setLineWidth(0.3);
  const lines = doc.splitTextToSize(narrative || '', contentW - 12);
  const narrativeH = lines.length * 5 + 10;
  doc.roundedRect(margin, y, contentW, narrativeH, 2, 2, 'FD');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  setTextHex(doc, DARK);
  doc.text(lines, margin + 6, y + 7);
  y += narrativeH + 6;

  // â”€â”€ Section: OT Exercise Recommendations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const actionable = recommendations.filter(r => r.exercise_id);
  if (actionable.length > 0) {
    y = _sectionTitle(doc, 'Recommended OT Exercises', margin, y, contentW);
    const exMap = Object.fromEntries(exercises.map(e => [e.id, e]));
    const exHeader = ['Exercise', 'Target Reflex', 'Duration', 'Instructions'];
    const exRows = actionable.map(rec => {
      const ex = exMap[rec.exercise_id] || {};
      const desc = (ex.description || '').slice(0, 80) + ((ex.description || '').length > 80 ? '...' : '');
      return [ex.name || '—', rec.target_reflex || '—', `${ex.duration_minutes || '—'} min`, desc];
    });
    y = _drawTable(doc, [exHeader, ...exRows], margin, y, [35, 35, 20, 80], contentW, ORANGE);
    y += 6;
  }

  // â”€â”€ Footer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Dashed line
  setDrawHex(doc, GRAY);
  doc.setLineWidth(0.3);
  doc.line(margin, y + 4, W - margin, y + 4);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7);
  setTextHex(doc, GRAY);
  doc.text(
    'Nesture AI · NesturePlay · EdTech Platform — Not a medical record. Consult a licensed specialist for professional decisions.',
    W / 2,
    y + 10,
    { align: 'center' }
  );

  return doc;
}

/**
 * Auto-download the PDF report in the browser (used if page does not handle the blob itself).
 */
export function generateSessionReport(params) {
  const doc = _buildDoc(params);
  const sessionShort = (params.session?.id || 'report').slice(0, 8);
  doc.save(`NestureAI_Report_${sessionShort}.pdf`);
}

/**
 * Return the PDF as an ArrayBuffer so callers can create a Blob / Object URL.
 * Used by the api.js shim to satisfy pages that do:
 *   const res = await api.get('/reports/:id/pdf', { responseType: 'blob' });
 *   const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
 */
export function generateSessionReportBytes(params) {
  const doc = _buildDoc(params);
  return doc.output('arraybuffer');
}

// â”€â”€ Table helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function _drawTable(doc, rows, x, y, colWidths, totalW, headerBg = TEAL) {
  const rowH = 7;
  const cellPadX = 3;
  const cellPadY = 5;

  rows.forEach((row, rowIdx) => {
    let cx = x;
    const isHeader = rowIdx === 0;
    const isEven = rowIdx % 2 === 0;

    // Row background
    if (isHeader) {
      setFillHex(doc, headerBg);
    } else {
      setFillHex(doc, isEven ? WHITE : CREAM);
    }

    // Calculate actual row height (for text wrapping)
    let maxLines = 1;
    row.forEach((cell, colIdx) => {
      const w = colWidths[colIdx];
      const wrapped = doc.splitTextToSize(String(cell || ''), w - cellPadX * 2);
      if (wrapped.length > maxLines) maxLines = wrapped.length;
    });
    const actualH = Math.max(rowH, maxLines * 4.5 + 3);

    doc.rect(x, y, totalW, actualH, 'F');

    // Grid lines
    setDrawHex(doc, '#D1D5DB');
    doc.setLineWidth(0.2);
    doc.rect(x, y, totalW, actualH, 'S');

    // Cell text
    doc.setFont('helvetica', isHeader ? 'bold' : 'normal');
    doc.setFontSize(isHeader ? 8.5 : 8);
    setTextHex(doc, isHeader ? WHITE : DARK);

    row.forEach((cell, colIdx) => {
      const w = colWidths[colIdx];
      const wrapped = doc.splitTextToSize(String(cell || ''), w - cellPadX * 2);
      doc.text(wrapped, cx + cellPadX, y + cellPadY);
      cx += w;
    });

    y += actualH;
  });

  return y;
}

function _sectionTitle(doc, text, x, y, w) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  setTextHex(doc, TEAL);
  doc.text(text, x, y + 4);
  setDrawHex(doc, TEAL);
  doc.setLineWidth(0.5);
  doc.line(x, y + 6, x + w, y + 6);
  return y + 12;
}

// â”€â”€ Atlas Profile Report â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Loads an image from a URL and returns it as a base64 data URI.
 * Returns null if loading fails (e.g., CORS, network error, no URL).
 */
async function loadImageAsBase64(url) {
  if (!url) return null;
  try {
    return await new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const size = Math.min(img.width, img.height);
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d');
          // Draw circular clip
          ctx.beginPath();
          ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
          ctx.closePath();
          ctx.clip();
          // Center-crop the image
          const sx = (img.width - size) / 2;
          const sy = (img.height - size) / 2;
          ctx.drawImage(img, sx, sy, size, size, 0, 0, size, size);
          resolve(canvas.toDataURL('image/png'));
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  } catch {
    return null;
  }
}

/**
 * Draw a thick arc segment on a jsPDF doc.
 * Angles are in degrees, 0 = top (12 o'clock), clockwise.
 */
function drawArc(doc, cx, cy, radius, startDeg, endDeg, color, lineWidth) {
  const steps = 40;
  const startRad = (startDeg - 90) * (Math.PI / 180);
  const endRad = (endDeg - 90) * (Math.PI / 180);
  const step = (endRad - startRad) / steps;

  setDrawHex(doc, color);
  doc.setLineWidth(lineWidth);

  for (let i = 0; i < steps; i++) {
    const a1 = startRad + i * step;
    const a2 = startRad + (i + 1) * step;
    const x1 = cx + radius * Math.cos(a1);
    const y1 = cy + radius * Math.sin(a1);
    const x2 = cx + radius * Math.cos(a2);
    const y2 = cy + radius * Math.sin(a2);
    doc.line(x1, y1, x2, y2);
  }
}

/**
 * Draws custom vector icons to replace emojis and unicode characters,
 * avoiding encoding issues in the generated PDF.
 */
function drawIconHelper(doc, name, cx, cy, color) {
  setDrawHex(doc, color);
  setFillHex(doc, color);
  doc.setLineWidth(0.35);

  if (name === 'home') {
    doc.line(cx - 2.2, cy + 0.5, cx, cy - 1.8);
    doc.line(cx, cy - 1.8, cx + 2.2, cy + 0.5);
    doc.line(cx - 2.2, cy + 0.5, cx + 2.2, cy + 0.5);
    doc.rect(cx - 1.5, cy + 0.5, 3, 2);
  } else if (name === 'team') {
    doc.circle(cx - 1, cy - 0.8, 0.8, 'S');
    doc.circle(cx + 1, cy - 0.8, 0.8, 'S');
    doc.line(cx - 2.2, cy + 1.8, cx + 2.2, cy + 1.8);
    doc.line(cx - 2.2, cy + 1.8, cx - 2.2, cy + 0.6);
    doc.line(cx + 2.2, cy + 1.8, cx + 2.2, cy + 0.6);
  } else if (name === 'doctor') {
    doc.rect(cx - 2.2, cy - 0.7, 4.4, 1.4, 'F');
    doc.rect(cx - 0.7, cy - 2.2, 1.4, 4.4, 'F');
  } else if (name === 'clipboard') {
    doc.rect(cx - 1.8, cy - 2, 3.6, 4);
    doc.rect(cx - 0.8, cy - 2.6, 1.6, 0.8, 'F');
    doc.line(cx - 1, cy - 0.5, cx + 1, cy - 0.5);
    doc.line(cx - 1, cy + 0.8, cx + 1, cy + 0.8);
  } else if (name === 'shield') {
    doc.line(cx - 2, cy - 2, cx + 2, cy - 2);
    doc.line(cx - 2, cy - 2, cx - 2, cy + 0.2);
    doc.line(cx + 2, cy - 2, cx + 2, cy + 0.2);
    doc.line(cx - 2, cy + 0.2, cx, cy + 2.4);
    doc.line(cx + 2, cy + 0.2, cx, cy + 2.4);
  } else if (name === 'heart') {
    doc.line(cx, cy - 1, cx - 1.5, cy - 2.2);
    doc.line(cx - 1.5, cy - 2.2, cx - 2.2, cy - 1);
    doc.line(cx - 2.2, cy - 1, cx, cy + 2.2);
    doc.line(cx, cy - 1, cx + 1.5, cy - 2.2);
    doc.line(cx + 1.5, cy - 2.2, cx + 2.2, cy - 1);
    doc.line(cx + 2.2, cy - 1, cx, cy + 2.2);
  } else if (name === 'school') {
    doc.rect(cx - 2.2, cy - 0.6, 4.4, 2.8);
    doc.line(cx - 2.6, cy - 0.6, cx, cy - 2.2);
    doc.line(cx, cy - 2.2, cx + 2.6, cy - 0.6);
    doc.line(cx - 2.6, cy - 0.6, cx + 2.6, cy - 0.6);
    doc.rect(cx - 0.6, cy + 1, 1.2, 1.2);
  } else if (name === 'cap') {
    doc.line(cx, cy - 2.2, cx + 2.6, cy - 1.1);
    doc.line(cx + 2.6, cy - 1.1, cx, cy);
    doc.line(cx, cy, cx - 2.6, cy - 1.1);
    doc.line(cx - 2.6, cy - 1.1, cx, cy - 2.2);
    doc.line(cx - 1.2, cy - 0.5, cx - 1.2, cy + 1);
    doc.line(cx + 1.2, cy - 0.5, cx + 1.2, cy + 1);
    doc.line(cx - 1.2, cy + 1, cx + 1.2, cy + 1);
    doc.line(cx, cy - 1.1, cx - 2, cy - 0.6);
  } else if (name === 'calendar') {
    doc.rect(cx - 1.8, cy - 1.8, 3.6, 3.6);
    doc.line(cx - 1.8, cy - 0.5, cx + 1.8, cy - 0.5);
    doc.line(cx - 1, cy - 1.8, cx - 1, cy - 2.4);
    doc.line(cx + 1, cy - 1.8, cx + 1, cy - 2.4);
  } else if (name === 'audio') {
    doc.circle(cx - 0.8, cy + 1, 0.7, 'F');
doc.line(cx - 0.1, cy - 1.8, cx - 0.1, cy + 1);
    doc.line(cx - 0.1, cy - 1.8, cx + 1.2, cy - 1.2);
  } else if (name === 'eye') {
    doc.line(cx - 2.2, cy, cx, cy - 1.4);
    doc.line(cx, cy - 1.4, cx + 2.2, cy);
    doc.line(cx - 2.2, cy, cx, cy + 1.4);
    doc.line(cx, cy + 1.4, cx + 2.2, cy);
    doc.circle(cx, cy, 0.7, 'S');
  } else if (name === 'keyboard') {
    doc.rect(cx - 2.2, cy - 1.4, 4.4, 2.8);
    doc.line(cx - 1.5, cy - 0.4, cx + 1.5, cy - 0.4);
    doc.line(cx - 1.5, cy + 0.4, cx + 1.5, cy + 0.4);
  } else if (name === 'cloud') {
    doc.circle(cx - 0.8, cy + 0.4, 0.9, 'F');
    doc.circle(cx + 0.8, cy + 0.4, 0.9, 'F');
    doc.circle(cx, cy - 0.5, 1.1, 'F');
    doc.rect(cx - 1, cy + 0.3, 2, 0.9, 'F');
  } else if (name === 'puzzle') {
    doc.rect(cx - 1.5, cy - 1.5, 3, 3);
    doc.circle(cx, cy - 1.5, 0.6, 'F');
    doc.circle(cx + 1.5, cy, 0.6, 'F');
  } else if (name === 'target') {
    doc.circle(cx, cy, 2.2, 'S');
    doc.circle(cx, cy, 1.2, 'S');
    doc.circle(cx, cy, 0.4, 'F');
  }
}

export async function generateAtlasProfileReport({ profile, childName, scores, childAge, childDiagnosis, childAvatarUrl, documentsCount }) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  
  // Custom colors
  const COLOR_NAVY       = '#112E51';
  const COLOR_PINK       = '#D54C75';
  const COLOR_GREEN      = '#2D7D46';
  const COLOR_ORANGE     = '#E27E20';
  const COLOR_TEAL       = '#0B7C85';
  const COLOR_PURPLE     = '#7D5BA6';
  const COLOR_YELLOW     = '#C79F27';
  const COLOR_BLUE       = '#3498DB';
  const COLOR_SLATE      = '#475569';
  const COLOR_BORDER     = '#E2E8F0';
  const COLOR_WHITE      = '#FFFFFF';
  const COLOR_DARK       = '#1F2937';
  const COLOR_GREY       = '#94A3B8';
  const COLOR_TRACK      = '#E2E8F0';

  // Age group
  const age = safeInt(childAge, 0);
  let ageGroup = 'Adult';
  if (age <= 3) ageGroup = 'Early Childhood';
  else if (age <= 7) ageGroup = 'Child';
  else if (age <= 12) ageGroup = 'Pre-Teen';
  else if (age <= 17) ageGroup = 'Teen';

  const diagnosis = childDiagnosis || 'Neurodivergent Profile';

  // Extract lists and compute scores
  const strengthsListRaw = Array.isArray(profile?.strengths) ? profile.strengths : [];
  const challengesListRaw = Array.isArray(profile?.challenges) ? profile.challenges : [];
  
  const getItemLabel = (item) => {
    if (typeof item === 'string') return item;
    if (item?.label) return item.label;
    if (item?.title) return item.description ? `${item.title}: ${item.description}` : item.title;
    if (item?.name) return item.name;
    return '';
  };
  
  const lowercaseChallenges = challengesListRaw.map(c => getItemLabel(c).toLowerCase().trim());
  const strengths = strengthsListRaw.filter(s => {
    const label = getItemLabel(s).toLowerCase().trim();
    if (label.includes('non-verbal') || label.includes('non verbal')) return false;
    return !lowercaseChallenges.includes(label);
  });
  const challenges = challengesListRaw;

  // Domain score computation helper
  const getDomainScore = (domainKeys) => {
    const sCount = strengths.filter(s => domainKeys.some(k => s.domain?.startsWith(k))).length;
    const cCount = challenges.filter(c => domainKeys.some(k => c.domain?.startsWith(k))).length;
    if (sCount === 0 && cCount === 0) return null;
    const ratio = sCount / (sCount + cCount);
    return Math.max(20, Math.round(ratio * 100));
  };

  let social = scores?.social ?? null;
  let dailyLiving = scores?.dailyLiving ?? null;
  let academic = scores?.academic ?? null;
  let sensory = scores?.sensory ?? null;
  let composite = scores?.composite ?? null;

  if (social === null) social = getDomainScore(['Social', 'Communication', 'Behavior']) ?? 50;
  if (dailyLiving === null) dailyLiving = getDomainScore(['DailyLiving', 'Environment']) ?? 50;
  if (academic === null) academic = getDomainScore(['Academic', 'Learning']) ?? 50;
  if (sensory === null) sensory = getDomainScore(['Sensory', 'Motor', 'Brain']) ?? 50;
  if (composite === null) {
    const valid = [social, dailyLiving, academic, sensory].filter(s => s !== null);
    composite = valid.length > 0 ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : 50;
  }

  // Helpers
  const drawCard = (x, y, w, h, title, titleColor = COLOR_NAVY) => {
    setFillHex(doc, COLOR_WHITE);
    setDrawHex(doc, COLOR_BORDER);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, y, w, h, 2, 2, 'FD');

    setFillHex(doc, titleColor);
    doc.roundedRect(x, y, w, 7, 2, 2, 'F');
    doc.rect(x, y + 5, w, 2, 'F'); // flatten corners

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    setTextHex(doc, COLOR_WHITE);
    doc.text(title.toUpperCase(), x + 4, y + 4.8);
  };

  const drawCardWithDataCheck = (x, y, w, h, title, hasData, titleColor = COLOR_NAVY) => {
    drawCard(x, y, w, h, title, titleColor);
    if (!hasData) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8);
      setTextHex(doc, COLOR_GREY);
      doc.text('Pending AI analysis...', x + w / 2, y + h / 2 + 2, { align: 'center' });
      return false;
    }
    return true;
  };

  // 1. Header (Y: 10 to 30)
  setFillHex(doc, COLOR_NAVY);
  doc.roundedRect(10, 10, 190, 20, 2, 2, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  setTextHex(doc, COLOR_WHITE);
  doc.text('NESTUREAI ATLAS 360° VIEW', 15, 17);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  setTextHex(doc, '#93C5FD');
  doc.text('DEVELOPMENTAL PROFILE REPORT', 15, 23);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  setTextHex(doc, COLOR_WHITE);
  doc.text((childName || 'LEARNER').toUpperCase(), 195, 17, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  setTextHex(doc, '#E2E8F0');
  doc.text(`${age} Years · ${ageGroup} · ${diagnosis}`, 195, 23, { align: 'right' });

  // 2. Overall Snapshot (Y: 33, X: 10, W: 55, H: 68)
  drawCard(10, 33, 55, 68, 'Overall Snapshot', COLOR_TEAL);
  
  const donutCx = 10 + 27.5;
  const donutCy = 33 + 22;
  const donutR = 11;
  const donutInnerR = 7.5;
  const donutMidR = (donutR + donutInnerR) / 2;
  const donutLw = donutR - donutInnerR;

  drawArc(doc, donutCx, donutCy, donutMidR, 0, 360, COLOR_TRACK, donutLw);
  if (composite > 0) {
    drawArc(doc, donutCx, donutCy, donutMidR, 0, composite * 3.6, COLOR_TEAL, donutLw);
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  setTextHex(doc, COLOR_DARK);
  doc.text(`${composite}`, donutCx, donutCy + 1.5, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.5);
  setTextHex(doc, COLOR_SLATE);
  doc.text('COMPOSITE', donutCx, donutCy + 5, { align: 'center' });

  const drawScoreBar = (by, label, score, color) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    setTextHex(doc, COLOR_DARK);
    doc.text(label, 14, by);
    doc.text(String(score), 61, by, { align: 'right' });

    setFillHex(doc, COLOR_TRACK);
    doc.rect(14, by + 1.5, 47, 2, 'F');
    if (score > 0) {
      setFillHex(doc, color);
      doc.rect(14, by + 1.5, (score / 100) * 47, 2, 'F');
    }
  };

  drawScoreBar(33 + 38, 'Social & Comm', social, COLOR_PINK);
  drawScoreBar(33 + 45, 'Daily Living', dailyLiving, COLOR_GREEN);
  drawScoreBar(33 + 52, 'Academic & Learning', academic, COLOR_BLUE);
  drawScoreBar(33 + 59, 'Sensory & Motor', sensory, COLOR_ORANGE);

  // 3. Strengths Highlights (Y: 105, X: 10, W: 55, H: 68)
  const hasStrengths = strengths.length > 0;
  if (drawCardWithDataCheck(10, 105, 55, 68, 'Strengths Highlights', hasStrengths, COLOR_GREEN)) {
    const topStrengths = strengths.slice(0, 4);
    let sy = 105 + 13;
    topStrengths.forEach(s => {
      const label = getItemLabel(s);
      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      setTextHex(doc, COLOR_DARK);

      setDrawHex(doc, COLOR_GREEN);
      doc.setLineWidth(0.4);
      doc.line(14, sy - 1, 15, sy);
      doc.line(15, sy, 17, sy - 2);

      const lines = doc.splitTextToSize(label, 42);
      doc.text(lines, 19, sy - 0.5);
      sy += lines.length * 3.2 + 2;
    });

    if (strengths.length > 4) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(6.5);
      setTextHex(doc, COLOR_GREY);
      doc.text(`+ ${strengths.length - 4} more in dashboard`, 14, 105 + 64);
    }
  }

  // 4. Atlas 360° Wheel (Y: 33, X: 68, W: 74, H: 140)
  drawCard(68, 33, 74, 140, 'Atlas 360° Wheel', COLOR_NAVY);
  
  const wheelCx = 105;
  const wheelCy = 95;
  const midR = 19;
  const wheelLw = 8;
  const outerRadius = midR + wheelLw/2; // 23mm
  const innerRadius = midR - wheelLw/2; // 15mm

  drawArc(doc, wheelCx, wheelCy, midR, 0, 360, '#F1F5F9', wheelLw);
  drawArc(doc, wheelCx, wheelCy, midR, 2, 58, COLOR_TEAL, wheelLw);
  drawArc(doc, wheelCx, wheelCy, midR, 62, 118, COLOR_PINK, wheelLw);
  drawArc(doc, wheelCx, wheelCy, midR, 122, 178, COLOR_BLUE, wheelLw);
  drawArc(doc, wheelCx, wheelCy, midR, 182, 238, COLOR_ORANGE, wheelLw);
  drawArc(doc, wheelCx, wheelCy, midR, 242, 298, COLOR_YELLOW, wheelLw);
  drawArc(doc, wheelCx, wheelCy, midR, 302, 358, COLOR_GREEN, wheelLw);

  const labels = [
    { angle: 30,  text: 'Who I Am',     align: 'left',  r: 27 },
    { angle: 90,  text: 'Communicate',  align: 'left',  r: 24, fontSize: 5.5 },
    { angle: 150, text: 'How I Learn',   align: 'left',  r: 27 },
    { angle: 210, text: 'What I Need',  align: 'right', r: 27 },
    { angle: 270, text: 'What I Enjoy',  align: 'right', r: 24 },
    { angle: 330, text: 'Strengths',    align: 'right', r: 27 }
  ];

  labels.forEach(lbl => {
    const rad = (lbl.angle - 90) * (Math.PI / 180);
    const rDist = lbl.r || 27;
    const lx = wheelCx + rDist * Math.cos(rad);
    const ly = wheelCy + rDist * Math.sin(rad) + 1;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(lbl.fontSize || 6.5);
    setTextHex(doc, COLOR_DARK);
    doc.text(lbl.text, lx, ly, { align: lbl.align });
  });

  setFillHex(doc, COLOR_WHITE);
  doc.circle(wheelCx, wheelCy, innerRadius, 'F');

  let base64Avatar = null;
  if (childAvatarUrl) {
    base64Avatar = await loadImageAsBase64(childAvatarUrl);
  }

  if (base64Avatar) {
    doc.addImage(base64Avatar, 'PNG', wheelCx - (innerRadius - 0.5), wheelCy - (innerRadius - 0.5), (innerRadius - 0.5) * 2, (innerRadius - 0.5) * 2);
  } else {
    setFillHex(doc, '#EEF6F8');
    setDrawHex(doc, COLOR_TEAL);
    doc.setLineWidth(0.3);
    doc.circle(wheelCx, wheelCy, innerRadius - 0.5, 'FD');

    const initials = childName ? childName.charAt(0).toUpperCase() : 'N';
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    setTextHex(doc, COLOR_TEAL);
    doc.text(initials, wheelCx, wheelCy + 4.5, { align: 'center' });
  }

  let summaryText = '';
  if (profile?.functional_wellness && profile.functional_wellness.length > 0) {
    const sleep = profile.functional_wellness.find(w => w.name && w.name.toLowerCase().includes('sleep') && w.status && w.status !== 'Not sure');
    const food = profile.functional_wellness.find(w => w.name && (w.name.toLowerCase().includes('eat') || w.name.toLowerCase().includes('food')) && w.status && w.status !== 'Not sure');
    summaryText = `${childName || 'The child'} is a ${age}-year-old with ${diagnosis}. `;
    if (sleep) summaryText += `Sleep status: ${sleep.status?.toLowerCase()}. `;
    if (food) summaryText += `Dietary habits status: ${food.status?.toLowerCase()}. `;
  } else {
    summaryText = `Developmental profile synthesized from caregiver questionnaires. Displays strong capacities in communication and adaptive skills, with emerging needs in regulation and sensory integration.`;
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  setTextHex(doc, COLOR_SLATE);
  const summaryLines = doc.splitTextToSize(summaryText, 66);
  doc.text(summaryLines, 72, 134);

  // 5. Support System (Y: 33, X: 145, W: 55, H: 52)
  drawCard(145, 33, 55, 52, 'Support System', COLOR_NAVY);
  
  const drawSupportGrid = (gx, gy, icon, title, val) => {
    drawIconHelper(doc, icon, gx + 4, gy + 4, COLOR_NAVY);
    
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    setTextHex(doc, COLOR_DARK);
    doc.text(title, gx + 10, gy + 3.2);
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    setTextHex(doc, COLOR_SLATE);
    const lines = doc.splitTextToSize(val, 42);
    doc.text(lines, gx + 10, gy + 6);
  };

  drawSupportGrid(145, 33 + 8, 'home', 'Environment', 'Structured Home Setting');
  
  let specialistVal = 'Pediatric Support';
  if (profile?.care_navigator?.specialists?.length > 0) {
    specialistVal = profile.care_navigator.specialists[0].type || specialistVal;
  } else if (profile?.motor_reflexes?.length > 0) {
    specialistVal = 'OT Reflex Program';
  }
  drawSupportGrid(145, 33 + 17, 'team', 'Specialist Care', specialistVal);
  
  let schoolVal = 'Adapted Learning Program';
  if (Array.isArray(profile?.home_plan?.daily_routine)) {
    const schoolAct = profile.home_plan.daily_routine.find(r => r.activity?.toLowerCase().includes('school') || r.activity?.toLowerCase().includes('class'));
    if (schoolAct) schoolVal = schoolAct.activity;
  }
  drawSupportGrid(145, 33 + 26, 'school', 'Education', schoolVal);
  
  const docsText = documentsCount > 0 ? `${documentsCount} Records Synthesized` : 'Active Care Profile';
  drawSupportGrid(145, 33 + 35, 'shield', 'Medical Coverage', docsText);

  // 6. Challenges & Support Needs (Y: 89, X: 145, W: 55, H: 84)
  const hasChallenges = challenges.length > 0;
  if (drawCardWithDataCheck(145, 89, 55, 84, 'Challenges & Support Needs', hasChallenges, COLOR_ORANGE)) {
    const topChallenges = challenges.slice(0, 5);
    let cy = 89 + 13;
    topChallenges.forEach(c => {
      const label = getItemLabel(c);
      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      setTextHex(doc, COLOR_DARK);

      setFillHex(doc, COLOR_ORANGE);
      doc.circle(149, cy - 1, 0.8, 'F');

      const lines = doc.splitTextToSize(label, 42);
      doc.text(lines, 153, cy - 0.5);
      cy += lines.length * 3.2 + 2;
    });

    if (challenges.length > 5) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(6.5);
      setTextHex(doc, COLOR_GREY);
      doc.text(`+ ${challenges.length - 5} more in dashboard`, 149, 89 + 80);
    }
  }

  // 7. Clinical & Developmental Profile (Y: 176, X: 10, W: 93, H: 56)
  drawCard(10, 176, 93, 56, 'Clinical & Developmental Profile', COLOR_TEAL);
  
  let cyClin = 176 + 11;
  const drawClinicalRow = (icon, category, value) => {
    drawIconHelper(doc, icon, 14, cyClin, COLOR_TEAL);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    setTextHex(doc, COLOR_DARK);
    doc.text(category, 19, cyClin - 0.2);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    setTextHex(doc, COLOR_SLATE);
    const maxValW = 55;
    const valLines = doc.splitTextToSize(value, maxValW);
    doc.text(valLines, 45, cyClin - 0.2);
    cyClin += Math.max(5, valLines.length * 3 + 1.2);
  };

  drawClinicalRow('clipboard', 'Diagnoses', diagnosis);
  
  let motorStr = 'Postural and movement control typical';
  if (profile?.motor_reflexes && profile.motor_reflexes.length > 0) {
    const reflexItems = profile.motor_reflexes.filter(r => r.status && r.status !== 'Not sure');
    if (reflexItems.length > 0) {
      motorStr = reflexItems.slice(0, 2).map(r => `${r.name}: ${r.status}`).join(', ');
    }
  }
  drawClinicalRow('puzzle', 'Motor Skills', motorStr);
  
  let commStr = 'Communicates independently';
  if (profile?.communication_profile) {
    const cp = profile.communication_profile;
    commStr = `${cp.preferred_mode || 'Verbal'} (Expression: ${cp.expression || 'Typical'})`;
  }
  drawClinicalRow('audio', 'Communication', commStr);
  
  let sensoryStr = 'Sensory processing typical';
  if (profile?.sensory_profile) {
    const sp = profile.sensory_profile;
    sensoryStr = `Coping: ${sp.sensory_coping || 'Typical'}, Sensitivity: ${sp.light_sound_sensitivity || 'Typical'}`;
  }
  drawClinicalRow('eye', 'Sensory Integration', sensoryStr);

  let adaptiveStr = 'Manages daily routines independently';
  if (strengths.some(s => s.domain === 'DailyLiving')) {
    adaptiveStr = getItemLabel(strengths.find(s => s.domain === 'DailyLiving'));
  }
  drawClinicalRow('home', 'Adaptive Living', adaptiveStr);

  // 8. Future Goals & Potential (Y: 176, X: 107, W: 93, H: 56)
  drawCard(107, 176, 93, 56, 'Future Goals & Potential', COLOR_PURPLE);
  
  let goalsList = [];
  if (profile?.home_plan?.support_plan && profile.home_plan.support_plan.length > 0 && !profile.home_plan.support_plan.includes('once API access completes')) {
    goalsList = doc.splitTextToSize(profile.home_plan.support_plan, 82);
  } else {
    if (challenges.some(c => c.domain === 'Behavior' || c.domain === 'Social')) {
      goalsList.push('Enhance emotional regulation and transition tolerance in school/home.');
    }
    if (challenges.some(c => c.domain === 'Communication' || c.domain === 'Social')) {
      goalsList.push(`Increase initiation of social communication using preferred mode (${profile?.communication_profile?.preferred_mode || 'preferred AAC'}).`);
    }
    if (challenges.some(c => c.domain === 'Sensory' || c.domain === 'Motor')) {
      goalsList.push('Develop fine motor skills and sensory coping strategies in noisy environments.');
    }
    if (goalsList.length === 0) {
      goalsList.push('Support independence in daily routines and household activities.');
      goalsList.push('Foster social engagement with peers through interest-based activities.');
    }
  }

  let gyGoals = 176 + 11;
  goalsList.slice(0, 3).forEach(g => {
    drawIconHelper(doc, 'target', 111, gyGoals + 1, COLOR_PURPLE);
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    setTextHex(doc, COLOR_DARK);
    
    const lines = doc.splitTextToSize(g, 76);
    doc.text(lines, 118, gyGoals + 1);
    gyGoals += lines.length * 3 + 2;
  });

  // 9. A Day in My Life (Y: 235, X: 10, W: 190, H: 20)
  drawCard(10, 235, 190, 20, 'A Day in My Life', COLOR_TEAL);
  
  const routineList = Array.isArray(profile?.home_plan?.daily_routine) ? profile.home_plan.daily_routine : [];
  
  if (routineList.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    setTextHex(doc, COLOR_GREY);
    doc.text('No routine items available.', 105, 235 + 13, { align: 'center' });
  } else {
    setDrawHex(doc, COLOR_GREY);
    doc.setLineWidth(0.3);
    doc.line(20, 235 + 12, 190, 235 + 12);
    
    const count = routineList.length;
    const startX = 25;
    const endX = 185;
    const stepX = count > 1 ? (endX - startX) / (count - 1) : 0;
    
    routineList.forEach((item, idx) => {
      const rx = count > 1 ? startX + idx * stepX : 105;
      const ry = 235 + 12;
      
      setFillHex(doc, COLOR_TEAL);
      doc.circle(rx, ry, 1.5, 'F');
      
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      setTextHex(doc, COLOR_TEAL);
      doc.text(item.time || 'Routine', rx, ry - 3, { align: 'center' });
      
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6);
      setTextHex(doc, COLOR_DARK);
      const text = item.activity || '';
      const lines = doc.splitTextToSize(text, stepX > 0 ? stepX - 4 : 40);
      doc.text(lines, rx, ry + 3, { align: 'center' });
    });
  }

  // 10. What Helps Me Succeed (Y: 258, X: 10, W: 190, H: 20)
  drawCard(10, 258, 190, 20, 'What Helps Me Succeed', COLOR_NAVY);
  
  const calmFactors = Array.isArray(profile?.home_plan?.calm_factors) ? profile.home_plan.calm_factors : [];
  
  const defaultFactors = ['Structured Routines', 'Clear Visual Supports', 'Quiet Workspaces', 'Encouragement'];
  const factorsToRender = calmFactors.length > 0 ? calmFactors.slice(0, 4) : defaultFactors;
  
  const stepXHelps = 180 / 4;
  factorsToRender.forEach((factor, idx) => {
    const fx = 15 + idx * stepXHelps;
    const fy = 258 + 12;
    
    let icon = 'heart';
    const lower = factor.toLowerCase();
    if (lower.includes('routine') || lower.includes('schedule')) icon = 'calendar';
    else if (lower.includes('visual') || lower.includes('aid') || lower.includes('schedule') || lower.includes('support')) icon = 'eye';
    else if (lower.includes('quiet') || lower.includes('space') || lower.includes('room') || lower.includes('environment')) icon = 'home';
    else if (lower.includes('aac') || lower.includes('typing') || lower.includes('speech')) icon = 'keyboard';
    else if (lower.includes('auditory') || lower.includes('sound')) icon = 'audio';
    
    drawIconHelper(doc, icon, fx + 2, fy - 1, COLOR_NAVY);
    
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    setTextHex(doc, COLOR_DARK);
    const lines = doc.splitTextToSize(factor, stepXHelps - 8);
    doc.text(lines, fx + 8, fy - 1);
  });

  // 11. Footer (Y: 281 to 287)
  setDrawHex(doc, COLOR_BORDER);
  doc.setLineWidth(0.3);
  doc.line(10, 280, 200, 280);

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(6.5);
  setTextHex(doc, COLOR_SLATE);
  doc.text('"Neurodiversity is strength. Understanding unlocks potential."', 105, 284, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.5);
  setTextHex(doc, COLOR_GREY);
  doc.text('This report is synthesized from documents & caregiver questionnaires. Not a medical record. Consult a licensed specialist for clinical decisions.', 105, 287, { align: 'center' });

  doc.save(`Atlas_360_Report_${childName ? childName.replace(/\s+/g, '_') : 'Child'}.pdf`);
}
