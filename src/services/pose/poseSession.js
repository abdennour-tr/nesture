/**
 * poseSession.js
 * ---------------------------------------------------------------------------
 * The seam between the layers: takes a finished recording and runs it through
 * features → indicators, then persists it.
 *
 *   capture → [decode] → features → indicators → [PERSIST] → export
 *
 * Each step is a separate module and this file only sequences them, so any one
 * of them can be replaced without the others noticing. That is the whole point
 * of the split: when the indicator model is refitted against real data, nothing
 * in the capture or the storage layer changes.
 */

import { supabase } from '../supabaseClient';
import { frameFeatures, sessionFeatures } from './poseFeatures';
import { computeIndicators, poseScoreContribution, activeModelVersion } from './reflexIndicators';

/**
 * Turn the flat recorded rows back into landmark objects.
 *
 * The recording is stored column-wise for size (see hooks/useUpperBodyTracking).
 * Everything downstream — features, export — reads landmarks through this one
 * function, so the storage format can change without touching either.
 *
 * @returns {Array<{t:number, landmarks:Array}>}
 */
export function decodeRecording(recording) {
  if (!recording?.frames?.length || !Array.isArray(recording.landmarks)) return [];
  const indices = recording.landmarks;
  return recording.frames.map((row) => {
    // Sparse array indexed by the MediaPipe landmark number, so downstream code
    // can keep using POSE.LEFT_ELBOW rather than a column offset.
    const landmarks = [];
    let k = 1;
    for (const idx of indices) {
      const x = row[k], y = row[k + 1], z = row[k + 2], v = row[k + 3];
      landmarks[idx] = (x == null || y == null)
        ? null
        : { x, y, z: z ?? 0, visibility: v ?? 0 };
      k += 4;
    }
    return { t: row[0], landmarks };
  });
}

/**
 * Recording → everything derived from it.
 * Pure: no network, no storage. Safe to re-run over an archived recording when
 * a new indicator model lands, which is exactly how a v2 gets validated against
 * sessions already collected.
 */
export function analyseRecording(recording, gameId) {
  const decoded = decodeRecording(recording);
  const samples = decoded.map(({ t, landmarks }) => ({ t, features: frameFeatures(landmarks) }));
  const features = sessionFeatures(samples);
  const indicators = computeIndicators(features);
  const contribution = poseScoreContribution(indicators, gameId);
  return { features, indicators, contribution, samples };
}

/**
 * Persist one session's pose data.
 *
 * One row per session holding the whole recording, following the shape
 * `raw_hand_tracking` already established rather than inventing a second
 * convention. The derived features and indicators are stored alongside the raw
 * frames so an analyst can work with either — and so a future model can be
 * compared against what v1 concluded from the same frames.
 *
 * Failure here must never break a game. A child finishing a round should not
 * see an error because a research upload timed out, so this resolves with
 * `{ ok: false }` rather than throwing.
 */
export async function savePoseSession({
  sessionId, childId, gameId, recording, analysis, consent,
}) {
  if (!recording || !sessionId || !childId) {
    return { ok: false, reason: 'missing-identifiers' };
  }
  try {
    const { error } = await supabase.from('raw_pose_tracking').insert([{
      session_id: sessionId,
      child_id: childId,
      game_id: gameId,
      schema_version: recording.schema,
      model_version: activeModelVersion(),
      sample_hz: recording.sampleHz,
      frame_count: recording.frameCount,
      duration_ms: recording.durationMs,
      /* Recorded so a dataset can be filtered to sessions gathered under a
         particular consent wording, which is what an ethics review will ask. */
      consent: consent || null,
      frames: recording,
      features: analysis?.features || null,
      indicators: analysis?.indicators || null,
    }]);
    if (error) {
      console.warn('[pose] save failed:', error.message);
      return { ok: false, reason: error.message };
    }
    return { ok: true };
  } catch (err) {
    console.warn('[pose] save threw:', err?.message);
    return { ok: false, reason: err?.message || 'unknown' };
  }
}

/**
 * Capture → analyse → save, for a game to call once when a round ends.
 * Returns the analysis so the results screen can show it even if the upload
 * failed; a failed upload is a lost research row, not a lost report.
 */
export async function finalisePoseSession({
  getRecording, sessionId, childId, gameId, consent,
}) {
  const recording = typeof getRecording === 'function' ? getRecording() : null;
  if (!recording) return { recording: null, analysis: null, saved: { ok: false, reason: 'no-frames' } };

  const analysis = analyseRecording(recording, gameId);
  const saved = await savePoseSession({
    sessionId, childId, gameId, recording, analysis, consent,
  });
  return { recording, analysis, saved };
}

export default { decodeRecording, analyseRecording, savePoseSession, finalisePoseSession };
