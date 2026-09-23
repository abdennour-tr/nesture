/**
 * reportBuilder.js â€” In-browser PDF report generator
 * Replaces backend/app/services/report_generator.py
 * Uses jsPDF to generate downloadable reports without a server.
 */
import { jsPDF } from 'jspdf';
import { REPORT_DISCLAIMER } from './reflexProfiles';
import { accuracyPercent } from '../utils/otScore';

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


/* ---------------------------------------------------------------------------
   Metric dictionary
   The five summary games each measure different things and store them under
   their own key names, in `notes` (older games, a JSON string) or `metrics`
   (newer ones). This table is the single place that knows how to present any
   of them: a human label, a unit, and where "good" and "fair" start.

   `higherIsBetter: false` marks the counters where a low number is the good
   result (drops, wrong keys, deviation in pixels). Keys absent from a given
   game's payload are simply not rendered, so every game gets a report made of
   its own measurements instead of a fixed grid of mostly-empty rows.
   --------------------------------------------------------------------------- */
const PCT = { unit: '%', good: 80, warn: 60 };

const METRIC_DEFS = {
  // Accuracy family -- what the child produced versus what was asked
  traceAccuracy:   { label: 'Trace accuracy',            ...PCT },
  pathAccuracy:    { label: 'Path accuracy',             ...PCT },
  touchAccuracy:   { label: 'Touch accuracy',            ...PCT },
  matchAccuracy:   { label: 'Gesture match accuracy',    ...PCT },
  typingAccuracy:  { label: 'Typing accuracy',           unit: '%', good: 85, warn: 70 },
  releaseAccuracy: { label: 'Release accuracy',          ...PCT },
  findEfficiency:  { label: 'Letter search efficiency',  ...PCT },
  successRate:     { label: 'Success rate',              ...PCT },

  // Movement quality
  smoothness:           { label: 'Movement smoothness', unit: '%', good: 65, warn: 50 },
  trajectorySmoothness: { label: 'Movement smoothness', unit: '%', good: 65, warn: 50 },
  pathEfficiency:       { label: 'Path efficiency',     unit: '%', good: 75, warn: 55 },
  dragTrajectoryEfficiency: { label: 'Drag efficiency', unit: '%', good: 75, warn: 55 },

  // Motor control / grip
  gripScore:      { label: 'Grip retention',    ...PCT },
  grip:           { label: 'Grip retention',    ...PCT },
  stability:      { label: 'Hold stability',    ...PCT },
  pinchStability: { label: 'Pinch stability',   ...PCT },
  consistency:    { label: 'Consistency',       unit: '%', good: 75, warn: 55 },
  pinchAperture:  { label: 'Pinch aperture',    unit: '',  raw: true },

  // Timing
  speedScore:    { label: 'Speed vs reference', unit: '%', good: 75, warn: 55 },
  reactionMs:     { label: 'Reaction time',  unit: 's', ms: true, good: 1.5, warn: 3, higherIsBetter: false },
  reactionTimeMs: { label: 'Reaction time',  unit: 's', ms: true, good: 1.5, warn: 3, higherIsBetter: false },
  pinchOnsetMs:   { label: 'Pinch onset',    unit: 's', ms: true, good: 1.5, warn: 3, higherIsBetter: false },
  movementTimeMs: { label: 'Movement time',  unit: 's', ms: true, raw: true },
  carryTimeMs:    { label: 'Carry time',     unit: 's', ms: true, raw: true },
  pauseDurationMs:{ label: 'Time paused',    unit: 's', ms: true, raw: true },

  // Counters -- context, not scores
  drops:            { label: 'Drops',              count: true, good: 0, warn: 2, higherIsBetter: false },
  overspeeds:       { label: 'Too-fast releases',  count: true, good: 0, warn: 2, higherIsBetter: false },
  holdBreaks:       { label: 'Holds broken',       count: true, good: 1, warn: 4, higherIsBetter: false },
  wrongKeys:        { label: 'Wrong keys pressed', count: true, good: 2, warn: 6, higherIsBetter: false },
  corrections:      { label: 'Course corrections', count: true, raw: true },
  directionChanges: { label: 'Direction changes',  count: true, raw: true },
  pauses:           { label: 'Pauses',             count: true, raw: true },
  meanDeviation:    { label: 'Mean deviation from path', unit: 'px', good: 12, warn: 25, higherIsBetter: false },
  /* Correlation coefficient (0-1, absolute value averaged over both axes),
     not a pass/fail score — deliberately `raw` so it prints with no
     good/warn colour coding. Whether the head follows the hand while
     tracing is a pattern for the reader (therapist/parent) to interpret,
     the same framing GamePage's own head_hand_coupling uses. */
  headHandCoupling: { label: 'Head-hand coupling', unit: '', raw: true, decimals: 2 },
  bubblesPopped:    { label: 'Bubbles popped',     count: true, raw: true },
  bubblesSpawned:   { label: 'Bubbles shown',      count: true, raw: true },
  bubblesMissed:    { label: 'Bubbles missed',     count: true, raw: true },
  coinsCollected:   { label: 'Coins collected',    count: true, raw: true },
  attempts:         { label: 'Attempts',           count: true, raw: true },
  score:            { label: 'Points scored',      count: true, raw: true },
  starsEarned:      { label: 'Stars earned',       count: true, raw: true },
  fittsThroughputBitsPerSec: { label: 'Fitts throughput', unit: 'bit/s', raw: true, decimals: 2 },
  fittsMeanIndexOfDifficulty: { label: 'Fitts index of difficulty', unit: '', raw: true, decimals: 2 },
};

/* Keys that describe the setup rather than the performance. */
const METRIC_SKIP = new Set([
  'game', 'mechanic', 'level', 'mode', 'otScore', 'performanceScore', 'composite',
]);

/* accuracy_score is not stored in one unit across games — see the note on
   accuracyPercent in utils/otScore.js. This used to be a private copy of that
   rule, which is precisely how the admin dashboard ended up with a different
   one and printed 5600%. One definition now, imported by every reader. */
const toPercent = accuracyPercent;

/** Pull the per-game detail out of whichever field the game used. */
function readGameMetrics(session) {
  if (session.metrics && typeof session.metrics === 'object') return session.metrics;
  if (typeof session.notes === 'string' && session.notes.trim().startsWith('{')) {
    try { return JSON.parse(session.notes) || {}; } catch { return {}; }
  }
  if (session.notes && typeof session.notes === 'object') return session.notes;
  return {};
}

/** camelCase -> "Camel case", for a metric no dictionary entry covers yet. */
function humanise(key) {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/** One dictionary entry + one raw value -> the row the table will print. */
function formatMetric(key, rawValue) {
  const def = METRIC_DEFS[key];
  const num = typeof rawValue === 'string' ? parseFloat(rawValue) : rawValue;
  if (!Number.isFinite(num)) return null;

  if (!def) {
    // Unknown but numeric: show it rather than silently dropping data.
    return { label: humanise(key), value: String(Math.round(num * 100) / 100), status: '-' };
  }

  let display;
  let comparable = num;

  if (def.ms) {
    comparable = num / 1000;
    display = `${comparable.toFixed(2)}s`;
  } else if (def.count) {
    display = String(Math.round(num));
  } else if (def.unit === '%') {
    // Percent metrics also arrive as 0-1 in some games.
    comparable = num > 1 ? num : num * 100;
    display = `${Math.round(comparable)}%`;
  } else {
    display = `${num.toFixed(def.decimals ?? 1)}${def.unit ? ' ' + def.unit : ''}`;
  }

  let status = '-';
  if (!def.raw && def.good !== undefined) {
    const better = def.higherIsBetter !== false;
    const good = better ? comparable >= def.good : comparable <= def.good;
    const fair = better ? comparable >= def.warn : comparable <= def.warn;
    status = good ? 'Good' : fair ? 'Fair' : 'Needs Focus';
  }

  return { label: def.label, value: display, status };
}

/* ---------------------------------------------------------------------------
   Layout primitives
   --------------------------------------------------------------------------- */
const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 16;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_Y = PAGE_H - 14;

/** Start a new page when `needed` mm no longer fit above the footer. */
function ensureSpace(doc, y, needed) {
  if (y + needed < FOOTER_Y - 4) return y;
  doc.addPage();
  return MARGIN;
}

/** A labelled KPI tile. */
function drawKpi(doc, x, y, w, h, label, value, accent) {
  setFillHex(doc, CREAM);
  doc.roundedRect(x, y, w, h, 2, 2, 'F');
  setFillHex(doc, accent);
  doc.rect(x, y, 1.4, h, 'F');           // accent spine

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  setTextHex(doc, GRAY);
  doc.text(label.toUpperCase(), x + 5, y + 6);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  setTextHex(doc, DARK);
  doc.text(String(value), x + 5, y + 15);
}

/** Score donut for the header band: a light full ring with the achieved arc
    over it, on a white disc so the figure stays legible against the teal. The
    caption is left to the KPI tile underneath rather than crammed inside. */
function drawScoreRing(doc, cx, cy, r, pct, colour) {
  setFillHex(doc, WHITE);
  doc.circle(cx, cy, r + 0.6, 'F');
  drawArc(doc, cx, cy, r, 0, 360, '#D9E6EA', 2.6);
  if (pct > 0) drawArc(doc, cx, cy, r, -90, -90 + (360 * pct) / 100, colour, 2.6);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  setTextHex(doc, DARK);
  doc.text(`${pct}`, cx, cy + 1.4, { align: 'center' });
}

/** Disclaimer + page numbers, stamped on every page once the body is done. */
function stampFooters(doc) {
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    setDrawHex(doc, '#D9E6EA');
    doc.setLineWidth(0.3);
    doc.line(MARGIN, FOOTER_Y - 4, PAGE_W - MARGIN, FOOTER_Y - 4);

    doc.setFont('helvetica', 'italic');
    doc.setFontSize(6.5);
    setTextHex(doc, GRAY);
    doc.text(
      'Nesture AI - NesturePlay. Educational screening support, not a medical record. Consult a licensed specialist for clinical decisions.',
      MARGIN, FOOTER_Y
    );
    doc.setFont('helvetica', 'normal');
    doc.text(`Page ${i} / ${pages}`, PAGE_W - MARGIN, FOOTER_Y, { align: 'right' });
  }
}

/** Build the jsPDF document object (shared by both export functions). */
function _buildDoc({ learner, session, reflexScores, recommendations, exercises, narrative, lpiScore }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = MARGIN;

  const detail    = readGameMetrics(session);
  const gameName  = session.game_name || 'NesturePlay';
  const otScore   = toPercent(session.accuracy_score);
  /* The session's own LPI is the real one now; the caller's value is only a
     fallback for old rows. A zero means "never computed", so it shows as a
     dash rather than pretending to be a score of 0. */
  const lpiRaw    = safeInt(session.lpi_score, 0) || safeInt(lpiScore, 0);
  const lpi       = lpiRaw > 0 ? String(lpiRaw) : '-';
  const durationS = safeInt(session.duration_seconds, 0);
  const duration  = durationS < 60 ? `${durationS}s` : `${Math.round(durationS / 60)} min`;
  const otColour  = otScore >= 80 ? '#16A34A' : otScore >= 60 ? ORANGE : '#DC2626';

  // -- Header band ----------------------------------------------------------
  setFillHex(doc, TEAL);
  doc.roundedRect(MARGIN, y, CONTENT_W, 26, 3, 3, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  setTextHex(doc, WHITE);
  doc.text('NesturePlay Session Report', MARGIN + 6, y + 10);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(`${learner?.name || 'Learner'}  |  ${gameName}`, MARGIN + 6, y + 17);

  const startDate = (session.start_time || '').slice(0, 10);
  const generated = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  doc.setFontSize(6.5);
  doc.text(
    `${startDate}   Report ${(session.id || 'N/A').slice(0, 8)}   Generated ${generated}`,
    MARGIN + 6, y + 22
  );

  drawScoreRing(doc, PAGE_W - MARGIN - 18, y + 13, 9, otScore, otColour);
  y += 32;

  // -- KPI strip ------------------------------------------------------------
  const kpiW = (CONTENT_W - 9) / 4;
  const kpis = [
    ['OT Score',   `${otScore}%`,                       otColour],
    ['LPI',        lpi,                                 '#8B5CF6'],
    ['Duration',   duration,                            TEAL],
    ['Difficulty', session.difficulty || 'n/a',         ORANGE],
  ];
  kpis.forEach(([label, value, accent], i) => {
    drawKpi(doc, MARGIN + i * (kpiW + 3), y, kpiW, 20, label, value, accent);
  });
  y += 27;

  // -- Performance, built from what THIS game measured -----------------------
  y = ensureSpace(doc, y, 40);
  y = _sectionTitle(doc, `Performance - ${gameName}`, MARGIN, y, CONTENT_W);

  const rows = [['Measure', 'Value', 'Status']];
  Object.keys(detail)
    .filter((k) => !METRIC_SKIP.has(k))
    .forEach((key) => {
      const row = formatMetric(key, detail[key]);
      if (row) rows.push([row.label, row.value, row.status]);
    });

  /* Nothing game-specific stored (an old session, or Letter Quest): fall back
     to the columns every session row carries. */
  if (rows.length === 1) {
    const rt     = safeFloat(session.avg_response_time_ms, 0) / 1000;
    const smooth = toPercent(session.trajectory_smoothness);
    const fatigue= toPercent(session.fatigue_index);
    rows.push(['Accuracy', `${otScore}%`, statusText(otScore, 75, 60)]);
    if (rt > 0)      rows.push(['Avg response time', `${rt.toFixed(2)}s`, statusText(10 - rt, 4, 2)]);
    if (smooth > 0)  rows.push(['Movement smoothness', `${smooth}%`, statusText(smooth, 65, 50)]);
    if (fatigue > 0) rows.push(['Fatigue index', `${fatigue}%`, statusText(100 - fatigue, 60, 40)]);
    if (session.total_attempts) rows.push(['Total attempts', String(session.total_attempts), '-']);
    if (session.perfect_grabs)  rows.push(['Perfect actions', String(session.perfect_grabs), '-']);
  }

  y = _drawTable(doc, rows, MARGIN, y, [88, 40, 50], CONTENT_W);
  y += 5;

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(6.5);
  setTextHex(doc, GRAY);
  doc.text(
    'Good / Fair / Needs Focus are screening bands, not clinical cut-offs. Read them alongside the notes below.',
    MARGIN, y
  );
  y += 7;

  // -- Reflexes, only when the session actually produced them ---------------
  if (Array.isArray(reflexScores) && reflexScores.length) {
    y = ensureSpace(doc, y, 40);
    y = _sectionTitle(doc, 'Primitive Reflex Integration', MARGIN, y, CONTENT_W);

    const reflexRows = [['Reflex', 'Score', 'Confidence', 'Status']];
    reflexScores.forEach((r) => {
      const score  = safeInt(r.score, 50);
      const filled = Math.max(0, Math.min(10, Math.floor(score / 10)));
      const bar    = '[' + '='.repeat(filled) + '-'.repeat(10 - filled) + ']';
      const conf   = r.confidence_level || r.confidence || 'Low';
      const status = conf === 'High' ? 'Action recommended' : conf === 'Medium' ? 'Monitor' : 'On track';
      reflexRows.push([r.reflex_name || r.reflex || '', `${bar} ${score}`, conf, status]);
    });
    y = _drawTable(doc, reflexRows, MARGIN, y, [45, 52, 32, 49], CONTENT_W);
    y += 6;
  }

  // -- Narrative -------------------------------------------------------------
  if (narrative) {
    /* splitTextToSize measures against the font size that is active when it is
       called, so the size has to be set BEFORE wrapping -- otherwise the text
       is wrapped for one size and drawn at another, and runs off the page. */
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    const lines = doc.splitTextToSize(String(narrative), CONTENT_W - 12);

    y = ensureSpace(doc, y, lines.length * 4.6 + 22);
    y = _sectionTitle(doc, 'Session Summary', MARGIN, y, CONTENT_W);

    setFillHex(doc, CREAM);
    setDrawHex(doc, TEAL);
    doc.setLineWidth(0.3);
    const boxH = lines.length * 4.6 + 9;
    doc.roundedRect(MARGIN, y, CONTENT_W, boxH, 2, 2, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    setTextHex(doc, DARK);
    doc.text(lines, MARGIN + 6, y + 6.5);
    y += boxH + 6;
  }

  // -- Recommendations -------------------------------------------------------
  const actionable = (recommendations || []).filter((r) => r.exercise_id);
  if (actionable.length) {
    y = ensureSpace(doc, y, 34);
    y = _sectionTitle(doc, 'Recommended OT Exercises', MARGIN, y, CONTENT_W);
    const exMap = Object.fromEntries((exercises || []).map((e) => [e.id, e]));
    const exRows = [['Exercise', 'Target reflex', 'Duration', 'Instructions']];
    actionable.forEach((rec) => {
      const ex = exMap[rec.exercise_id] || {};
      const desc = (ex.description || '');
      exRows.push([
        ex.name || '-',
        rec.target_reflex || '-',
        `${ex.duration_minutes || '-'} min`,
        desc.length > 78 ? desc.slice(0, 78) + '...' : desc,
      ]);
    });
    y = _drawTable(doc, exRows, MARGIN, y, [34, 34, 20, 90], CONTENT_W, ORANGE);
  }

  stampFooters(doc);
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
  const header = rows[0];

  rows.forEach((row, rowIdx) => {
    let cx = x;
    let isHeader = rowIdx === 0;
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

    /* A long table now continues on the next page instead of running off the
       bottom, and the header is repeated so the columns stay readable. */
    if (!isHeader && y + actualH > FOOTER_Y - 6) {
      doc.addPage();
      y = MARGIN;
      y = _drawTable(doc, [header], x, y, colWidths, totalW, headerBg);
      setFillHex(doc, isEven ? WHITE : CREAM);
    }

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

/* ═══════════════════════════════════════════════════════════════════════════
   GAME SESSION REPORT — the PDF of the on-screen report
   ---------------------------------------------------------------------------
   This draws exactly what <GameResults> shows, from exactly the same model.

   The older `_buildDoc` above reads stored session rows and builds its own
   reflex table. That table disagreed with the screen in three ways: a reflex
   with no score defaulted to 50, its "status" column was computed from
   CONFIDENCE (so a well-observed, settled reflex printed "Action recommended"),
   and it knew nothing about which reflexes the activity TARGETS but did not
   measure. A parent could put the screen and the print-out side by side and
   read two different findings for one session.

   Everything below takes the model from services/reflexProfiles.js —
   buildReflexSections() — and the same breakdown and metric arrays the screen
   was given. Nothing here decides what a finding is; it only decides where on
   the page it goes.
   ═══════════════════════════════════════════════════════════════════════════ */

const TONE_HEX = {
  attention: '#DC2626',
  watch:     '#D97706',
  good:      '#16A34A',
  none:      '#9CA3AF',
};

const TIER_TEXT = { primary: 'Main focus', secondary: 'Also works on' };

/** Wrap at a set font size, because splitTextToSize measures the ACTIVE size. */
function wrapAt(doc, text, width, size, style = 'normal') {
  doc.setFont('helvetica', style);
  doc.setFontSize(size);
  return doc.splitTextToSize(String(text), width);
}

/** A labelled bar: the same weighted sub-score row the screen shows. */
function drawBarRow(doc, x, y, w, label, value, weight) {
  const measured = value != null && Number.isFinite(value);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  setTextHex(doc, DARK);
  doc.text(String(label), x, y);

  if (weight) {
    doc.setFontSize(6.5);
    setTextHex(doc, GRAY);
    doc.text(String(weight), x + doc.getTextWidth(String(label)) + 2.5, y);
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  setTextHex(doc, measured ? DARK : GRAY);
  const shown = measured ? `${Math.round(value)}%` : '-';
  doc.text(shown, x + w, y, { align: 'right' });

  const trackY = y + 1.8;
  setFillHex(doc, '#E5E7EB');
  doc.roundedRect(x, trackY, w, 2, 1, 1, 'F');
  if (measured && value > 0) {
    setFillHex(doc, TEAL);
    doc.roundedRect(x, trackY, Math.max(1, (w * value) / 100), 2, 1, 1, 'F');
  }
  return trackY + 6;
}

/** One reflex block: identity, tier, why the activity trains it, the finding. */
function drawReflexEntry(doc, x, y, w, entry) {
  const whyLines = entry.why ? wrapAt(doc, entry.why, w - 8, 7.5) : [];
  const noteLines = !entry.measured && entry.blockedReason
    ? wrapAt(doc, entry.blockedReason, w - 8, 7, 'italic') : [];
  const blockH = 11 + whyLines.length * 3.4 + (entry.measured ? 9 : noteLines.length * 3.2 + 1);

  y = ensureSpace(doc, y, blockH + 4);

  // The coloured edge carries the finding, as it does on screen.
  setFillHex(doc, TONE_HEX[entry.tone] || TONE_HEX.none);
  doc.rect(x, y, 1.2, blockH, 'F');

  setFillHex(doc, '#F8FAFC');
  doc.rect(x + 1.2, y, w - 1.2, blockH, 'F');

  const tx = x + 5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  setTextHex(doc, DARK);
  doc.text(entry.key, tx, y + 5);

  if (entry.tier) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6);
    setTextHex(doc, TEAL);
    doc.text((TIER_TEXT[entry.tier] || entry.tier).toUpperCase(), x + w - 3, y + 5, { align: 'right' });
  }

  if (entry.name && entry.name !== entry.key) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    setTextHex(doc, GRAY);
    doc.text(entry.name, tx, y + 8.6);
  }

  let ly = y + 12;
  if (whyLines.length) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    setTextHex(doc, DARK);
    doc.text(whyLines, tx, ly);
    ly += whyLines.length * 3.4;
  }

  if (entry.measured) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    setTextHex(doc, TONE_HEX[entry.tone] || DARK);
    doc.text(entry.statusText, tx, ly + 1.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    setTextHex(doc, GRAY);
    doc.text(entry.statusHint, tx + doc.getTextWidth(entry.statusText) + 15, ly + 1.5);

    const barW = w - 10;
    setFillHex(doc, '#E5E7EB');
    doc.roundedRect(tx, ly + 3.5, barW, 1.6, 0.8, 0.8, 'F');
    setFillHex(doc, TONE_HEX[entry.tone] || TONE_HEX.none);
    doc.roundedRect(tx, ly + 3.5, Math.max(1, (barW * entry.score) / 100), 1.6, 0.8, 0.8, 'F');
  } else if (noteLines.length) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7);
    setTextHex(doc, GRAY);
    doc.text(noteLines, tx, ly + 1);
  }

  return y + blockH + 4;
}

/**
 * Build the PDF of a game session report.
 *
 * @param {Object} model  the same shape <GameResults> was rendered with:
 *        { gameId, gameName, title, subtitle, endedEarly, headline,
 *          breakdown[], metrics[], sections[], notMeasuredReason }
 * @param {Object} [extras]  { learnerName, sessionId, date, narrative,
 *        recommendations, exercises } — LetterQuest carries these, the
 *        in-game reports do not.
 */
export function buildGameReportDoc(model, extras = {}) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = MARGIN;

  const headlineVal = model.headline?.value;
  const hasHeadline = headlineVal != null && Number.isFinite(headlineVal);
  const ringColour = !hasHeadline ? GRAY
    : headlineVal >= 80 ? '#16A34A' : headlineVal >= 60 ? ORANGE : '#DC2626';

  // ── Header band ──────────────────────────────────────────────────────────
  setFillHex(doc, TEAL);
  doc.roundedRect(MARGIN, y, CONTENT_W, 26, 3, 3, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  setTextHex(doc, WHITE);
  doc.text(model.title || 'Session report', MARGIN + 6, y + 10);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  const who = extras.learnerName ? `${extras.learnerName}  |  ` : '';
  doc.text(`${who}${model.gameName || ''}`, MARGIN + 6, y + 17);

  doc.setFontSize(6.5);
  const generated = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const idPart = extras.sessionId ? `Report ${String(extras.sessionId).slice(0, 8)}   ` : '';
  doc.text(`${extras.date || ''}   ${idPart}Generated ${generated}`, MARGIN + 6, y + 22);

  if (hasHeadline) {
    drawScoreRing(doc, PAGE_W - MARGIN - 18, y + 13, 9, Math.round(headlineVal), ringColour);
  }
  y += 32;

  // A round stopped early is said out loud, exactly as on screen — otherwise
  // the numbers below look like a full session's.
  if (model.endedEarly) {
    setFillHex(doc, '#FEF3C7');
    setDrawHex(doc, '#F59E0B');
    doc.setLineWidth(0.3);
    doc.roundedRect(MARGIN, y, CONTENT_W, 9, 1.5, 1.5, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    setTextHex(doc, '#92400E');
    doc.text(
      'This round was stopped before the end, so the scores below cover only the part that was played.',
      MARGIN + 4, y + 5.8
    );
    y += 14;
  }

  // ── Performance ──────────────────────────────────────────────────────────
  const bars = (model.breakdown || []).filter((b) => b && b.label);
  if (hasHeadline || bars.length) {
    y = ensureSpace(doc, y, 24 + bars.length * 8);
    y = _sectionTitle(doc, 'Performance', MARGIN, y, CONTENT_W);

    if (hasHeadline) {
      const figure = String(Math.round(headlineVal));
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      setTextHex(doc, ringColour);
      /* Measure at the size the figure is DRAWN at. Measuring after switching
         to the caption's 7pt put the caption on top of the number. */
      const figureW = doc.getTextWidth(figure);
      doc.text(figure, MARGIN, y + 4);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      setTextHex(doc, GRAY);
      doc.text(String(model.headline.caption || 'Score').toUpperCase(),
        MARGIN + figureW + 3, y + 4);
      y += 9;
    }

    let by = y;
    bars.forEach((b) => { by = drawBarRow(doc, MARGIN, by, CONTENT_W, b.label, b.value, b.weight); });
    y = by + 2;
  }

  // ── Session detail ───────────────────────────────────────────────────────
  const tiles = (model.metrics || []).filter((m) => m && m.label);
  if (tiles.length) {
    y = ensureSpace(doc, y, 30);
    y = _sectionTitle(doc, 'Session detail', MARGIN, y, CONTENT_W);
    const perRow = 4;
    const tw = (CONTENT_W - (perRow - 1) * 3) / perRow;
    tiles.forEach((m, i) => {
      const col = i % perRow;
      const rowStart = col === 0;
      if (rowStart && i > 0) y += 18;
      if (rowStart) y = ensureSpace(doc, y, 20);
      drawKpi(doc, MARGIN + col * (tw + 3), y, tw, 15, String(m.label), String(m.value), TEAL);
    });
    y += 22;
  }

  // ── Reflex sections — the same entries the screen rendered ───────────────
  (model.sections || []).forEach((section, si) => {
    const blurbLines = wrapAt(doc, section.blurb, CONTENT_W, 7.5);
    y = ensureSpace(doc, y, 22 + blurbLines.length * 3.4);
    y = _sectionTitle(doc, section.title, MARGIN, y, CONTENT_W);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    setTextHex(doc, GRAY);
    doc.text(blurbLines, MARGIN, y);
    y += blurbLines.length * 3.4 + 2;

    if (si === 0 && model.notMeasuredReason
        && !section.entries.some((e) => e.measured)) {
      const lines = wrapAt(doc, model.notMeasuredReason, CONTENT_W - 6, 7, 'italic');
      y = ensureSpace(doc, y, lines.length * 3.2 + 6);
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(7);
      setTextHex(doc, GRAY);
      doc.text(lines, MARGIN + 2, y);
      y += lines.length * 3.2 + 3;
    }

    section.entries.forEach((entry) => { y = drawReflexEntry(doc, MARGIN, y, CONTENT_W, entry); });
    y += 2;
  });

  // ── Narrative (LetterQuest carries one) ──────────────────────────────────
  if (extras.narrative) {
    const lines = wrapAt(doc, extras.narrative, CONTENT_W - 12, 8.5);
    y = ensureSpace(doc, y, lines.length * 4.6 + 22);
    y = _sectionTitle(doc, 'What we noticed', MARGIN, y, CONTENT_W);
    setFillHex(doc, CREAM);
    setDrawHex(doc, TEAL);
    doc.setLineWidth(0.3);
    const boxH = lines.length * 4.6 + 9;
    doc.roundedRect(MARGIN, y, CONTENT_W, boxH, 2, 2, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    setTextHex(doc, DARK);
    doc.text(lines, MARGIN + 6, y + 6.5);
    y += boxH + 6;
  }

  // ── Recommended exercises (LetterQuest / Path Tracing) ───────────────────
  const actionable = (extras.recommendations || []).filter((r) => r && r.exercise_id);
  if (actionable.length) {
    y = ensureSpace(doc, y, 34);
    y = _sectionTitle(doc, 'Recommended movement activities', MARGIN, y, CONTENT_W);
    const exMap = Object.fromEntries((extras.exercises || []).map((e) => [e.id, e]));
    const exRows = [['Activity', 'Target reflex', 'Duration', 'Instructions']];
    actionable.forEach((rec) => {
      const ex = exMap[rec.exercise_id] || {};
      const desc = ex.description || '';
      exRows.push([
        ex.name || '-',
        rec.target_reflex || '-',
        `${ex.duration_minutes || '-'} min`,
        desc.length > 78 ? `${desc.slice(0, 78)}...` : desc,
      ]);
    });
    y = _drawTable(doc, exRows, MARGIN, y, [34, 34, 20, 90], CONTENT_W, ORANGE);
    y += 4;
  }

  // ── Disclaimer, the same sentence the screen ends on ─────────────────────
  const dis = wrapAt(doc, REPORT_DISCLAIMER, CONTENT_W, 7, 'italic');
  y = ensureSpace(doc, y, dis.length * 3.2 + 6);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7);
  setTextHex(doc, GRAY);
  doc.text(dis, MARGIN, y + 2);

  stampFooters(doc);
  return doc;
}

/** ArrayBuffer of the game session report, for download. */
export function generateGameReportBytes(model, extras) {
  return buildGameReportDoc(model, extras).output('arraybuffer');
}

/** Save it straight to the user's downloads. */
export function downloadGameReport(model, extras = {}) {
  const doc = buildGameReportDoc(model, extras);
  const name = (model.gameName || 'Session').replace(/[^A-Za-z0-9]+/g, '');
  const stamp = new Date().toISOString().slice(0, 10);
  doc.save(`Nesture_${name}_${stamp}.pdf`);
}
