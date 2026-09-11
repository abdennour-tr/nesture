/**
 * poseExport.js
 * ---------------------------------------------------------------------------
 * LAST LAYER of the pipeline: stored sessions → .xlsx for analysis.
 *
 *   capture → features → indicators → score → [EXPORT]
 *
 * Builds sheets into an ExcelJS workbook the admin dashboard already owns, so
 * the pose data lands in the same download as everything else rather than
 * behind a second button.
 *
 * FOUR SHEETS, BECAUSE THEY ARE FOUR DIFFERENT UNITS OF ANALYSIS
 * --------------------------------------------------------------
 *   Pose Sessions    one row per session   — the index to join everything on
 *   Pose Features    one row per session   — the derived movement measures
 *   Pose Indicators  one row per indicator — long format, ready for stats
 *   Pose Frames      one row per landmark per frame — the raw data
 *
 * "Pose Frames" is the tall one, and the reason for the row cap below.
 *
 * EXCEL'S LIMIT IS REAL AND IT TRUNCATES SILENTLY
 * -----------------------------------------------
 * A worksheet holds 1,048,576 rows. At 15Hz with 21 landmarks that is 315 rows
 * per second — about 55 minutes of play across the whole export. Rather than
 * let Excel quietly drop everything past the limit, the frame sheet stops at a
 * budget and writes a visible marker row saying what was left out and how to
 * get the rest. A dataset that is silently incomplete is worse than a small one.
 */

import { POSE_NAME } from './poseLandmarks';
import { decodeRecording } from './poseSession';

/** Left well under Excel's 1,048,576 so the other sheets always fit too. */
export const MAX_FRAME_ROWS = 900000;

const HEADER_FILL = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

function styleHeader(sheet, argb) {
  const row = sheet.getRow(1);
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = HEADER_FILL(argb);
  row.alignment = { horizontal: 'center' };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

const num = (v, dp = 4) =>
  (v == null || !Number.isFinite(Number(v)) ? null : Number(Number(v).toFixed(dp)));

/**
 * @param {ExcelJS.Workbook} workbook
 * @param {Array} rows  raw_pose_tracking rows, each with `frames` decoded or raw
 * @param {Object} meta { learnerName }
 */
export function addPoseSheets(workbook, rows, meta = {}) {
  const sessions = Array.isArray(rows) ? rows : [];

  // ── 1. Session index ─────────────────────────────────────────────────────
  const idx = workbook.addWorksheet('Pose Sessions');
  idx.columns = [
    { header: 'Session ID', key: 'session', width: 38 },
    { header: 'Game', key: 'game', width: 18 },
    { header: 'Recorded (UTC)', key: 'at', width: 22 },
    { header: 'Duration (s)', key: 'dur', width: 13 },
    { header: 'Frames', key: 'frames', width: 10 },
    { header: 'Sample Hz', key: 'hz', width: 11 },
    { header: 'Schema', key: 'schema', width: 20 },
    { header: 'Indicator model', key: 'model', width: 32 },
    { header: 'Consent version', key: 'consent', width: 20 },
    { header: 'Consent given at', key: 'consentAt', width: 22 },
  ];
  styleHeader(idx, 'FF0D5E6B');

  sessions.forEach((s) => {
    idx.addRow({
      session: s.session_id,
      game: s.game_id || '',
      at: s.created_at ? new Date(s.created_at).toISOString().replace('T', ' ').slice(0, 19) : '',
      dur: num((s.duration_ms || 0) / 1000, 1),
      frames: s.frame_count ?? '',
      hz: s.sample_hz ?? '',
      schema: s.schema_version || '',
      model: s.model_version || '',
      consent: s.consent?.version || '',
      consentAt: s.consent?.decidedAt || '',
    });
  });

  if (sessions.length === 0) {
    const r = idx.addRow({ session: 'No pose recordings for this learner.' });
    r.getCell(1).font = { italic: true, color: { argb: 'FF94A3B8' } };
  }

  // ── 2. Derived features, one row per session ─────────────────────────────
  const featureKeys = [
    'frameCount', 'durationSec', 'sampleRateHz', 'meanQuality',
    'headYawRange', 'headYawSd', 'headPitchRange', 'headPitchSd',
    'meanExtensionLeft', 'meanExtensionRight',
    'extensionAsymmetryMean', 'extensionAsymmetrySd',
    'shoulderTiltMean', 'shoulderTiltSd', 'trunkLeanSd', 'posturalSwaySd',
    'midlineCrossings', 'wristSpreadSd',
    'corrYawVsExtensionAsymmetry', 'corrYawSampleN',
    'corrPitchVsMeanExtension', 'corrPitchSampleN',
    'corrPitchVsTrunkLean', 'bilateralAbductionEvents',
  ];

  const feat = workbook.addWorksheet('Pose Features');
  feat.columns = [
    { header: 'Session ID', key: 'session', width: 38 },
    { header: 'Game', key: 'game', width: 18 },
    ...featureKeys.map((k) => ({ header: k, key: k, width: Math.max(14, k.length + 2) })),
  ];
  styleHeader(feat, 'FF1A8FA0');

  sessions.forEach((s) => {
    const f = s.features || {};
    const row = { session: s.session_id, game: s.game_id || '' };
    featureKeys.forEach((k) => { row[k] = num(f[k], 5); });
    feat.addRow(row);
  });

  // ── 3. Indicators, long format ───────────────────────────────────────────
  /* One row per session per indicator rather than a wide sheet: long format is
     what a stats package wants, and it leaves room for the caveat text that has
     to travel with every one of these numbers. */
  const ind = workbook.addWorksheet('Pose Indicators');
  ind.columns = [
    { header: 'Session ID', key: 'session', width: 38 },
    { header: 'Game', key: 'game', width: 18 },
    { header: 'Indicator', key: 'key', width: 16 },
    { header: 'Reflex', key: 'label', width: 32 },
    { header: 'Evidence tier', key: 'evidence', width: 14 },
    { header: 'Measured', key: 'measured', width: 11 },
    { header: 'Value (0-100)', key: 'value', width: 14 },
    { header: 'Confidence (0-1)', key: 'conf', width: 16 },
    { header: 'Not measured because', key: 'why', width: 46 },
    { header: 'Model version', key: 'model', width: 32 },
    { header: 'Caveat', key: 'caveat', width: 70 },
  ];
  styleHeader(ind, 'FF8B5CF6');

  sessions.forEach((s) => {
    const result = s.indicators || {};
    const list = Array.isArray(result.indicators) ? result.indicators : [];
    if (!result.usable && list.length === 0) {
      const r = ind.addRow({
        session: s.session_id,
        game: s.game_id || '',
        key: '(none)',
        why: result.reason || 'Session produced no usable indicators.',
        model: result.modelVersion || s.model_version || '',
      });
      r.getCell(9).font = { italic: true, color: { argb: 'FF94A3B8' } };
      return;
    }
    list.forEach((i) => {
      ind.addRow({
        session: s.session_id,
        game: s.game_id || '',
        key: i.key,
        label: i.label || '',
        evidence: i.evidence || '',
        measured: i.measured ? 'yes' : 'no',
        /* Blank, never 0, when nothing was measured — a zero here would read as
           "no pattern present", which is a finding this session did not make. */
        value: i.measured ? i.value : null,
        conf: i.measured ? num(i.confidence, 3) : null,
        why: i.measured ? '' : (i.notMeasuredReason || ''),
        model: i.modelVersion || result.modelVersion || '',
        caveat: i.caveat || '',
      });
    });
  });

  // ── 4. Raw frames, one row per landmark per frame ────────────────────────
  const fr = workbook.addWorksheet('Pose Frames');
  fr.columns = [
    { header: 'Session ID', key: 'session', width: 38 },
    { header: 'Game', key: 'game', width: 18 },
    { header: 'Frame', key: 'frame', width: 9 },
    { header: 'Time (ms)', key: 't', width: 11 },
    { header: 'Landmark', key: 'name', width: 18 },
    { header: 'Index', key: 'i', width: 8 },
    { header: 'X', key: 'x', width: 10 },
    { header: 'Y', key: 'y', width: 10 },
    { header: 'Z', key: 'z', width: 10 },
    { header: 'Visibility', key: 'v', width: 11 },
  ];
  styleHeader(fr, 'FFE8841A');

  let written = 0;
  let truncated = false;

  for (const s of sessions) {
    const recording = s.frames;
    if (!recording?.frames?.length) continue;
    const decoded = decodeRecording(recording);

    for (let fi = 0; fi < decoded.length; fi += 1) {
      const { t, landmarks } = decoded[fi];
      for (let li = 0; li < landmarks.length; li += 1) {
        const p = landmarks[li];
        if (!p) continue;
        if (written >= MAX_FRAME_ROWS) { truncated = true; break; }
        fr.addRow({
          session: s.session_id,
          game: s.game_id || '',
          frame: fi + 1,
          t,
          name: POSE_NAME[li] || `landmark_${li}`,
          i: li,
          x: num(p.x), y: num(p.y), z: num(p.z, 3), v: num(p.visibility, 2),
        });
        written += 1;
      }
      if (truncated) break;
    }
    if (truncated) break;
  }

  if (truncated) {
    /* Say so in the sheet itself. Excel silently drops rows past its limit, and
       an analyst who does not know the data stops early will read the gap as
       the child having stopped moving. */
    const r = fr.addRow({
      session: `TRUNCATED at ${MAX_FRAME_ROWS.toLocaleString()} rows. `
        + 'Export a single session at a time, or read raw_pose_tracking.frames '
        + 'directly, to get the remainder.',
    });
    r.getCell(1).font = { bold: true, color: { argb: 'FFDC2626' } };
  }

  if (written === 0 && !truncated) {
    const r = fr.addRow({ session: 'No raw pose frames recorded for this learner.' });
    r.getCell(1).font = { italic: true, color: { argb: 'FF94A3B8' } };
  }

  return { sessionCount: sessions.length, frameRows: written, truncated };
}

/**
 * Fetch this learner's pose recordings.
 * `frames` is the heavy column, so it is only selected when raw frames are
 * actually wanted — an export of features alone should not pull megabytes.
 */
export async function fetchPoseSessions(supabase, { childId, sessionId = null, includeFrames = true }) {
  const columns = [
    'session_id', 'child_id', 'game_id', 'schema_version', 'model_version',
    'sample_hz', 'frame_count', 'duration_ms', 'consent', 'features',
    'indicators', 'created_at',
  ];
  if (includeFrames) columns.push('frames');

  let query = supabase
    .from('raw_pose_tracking')
    .select(columns.join(', '))
    .eq('child_id', childId)
    .order('created_at', { ascending: true });

  if (sessionId) query = query.eq('session_id', sessionId);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export default { addPoseSheets, fetchPoseSessions, MAX_FRAME_ROWS };
