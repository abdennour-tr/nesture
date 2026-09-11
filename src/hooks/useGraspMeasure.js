/**
 * useGraspMeasure.js
 * ---------------------------------------------------------------------------
 * Measures the palmar grasp reflex in the hands-only games.
 *
 * WHY A SEPARATE HOOK AND NOT THE FULL REFLEX ENGINE
 * --------------------------------------------------
 * Eight of the ten detectors need a head pose or a face mesh, which only
 * LetterQuest and Path Tracing produce. The remaining games run MediaPipe Hands
 * alone, and of the two detectors that need nothing else, only the palmar grasp
 * one says anything useful about a pointing task. Running the whole engine in
 * those games would spend the CPU on eight detectors that can only ever return
 * `not_measured`.
 *
 * WHERE THIS IS VALID — AND WHERE IT IS NOT
 * -----------------------------------------
 * The detector scores how much the hand pulls into a closed position during
 * effort. That is only evidence of a retained reflex when closing is NOT the
 * task. Pinch the Coin, Finger Piano and Magic Finger Copy all ask the child to
 * close the hand, so there the reading would rise with skill rather than with
 * retention — those games target the reflex without measuring it. See
 * `shouldMeasure` in services/reflexProfiles.js, which is the single place that
 * decides, and which the report also consults before showing a score.
 *
 * MEMORY
 * ------
 * A ten-minute round at 30fps is eighteen thousand frames of 21 landmarks. The
 * buffer is therefore a window that is analysed as it fills, after which only
 * the RESULT is kept — the same approach services/reflexEngine/index.js takes,
 * and for the same reason: a session must be scored on all of itself, not on
 * whichever ten seconds happened to be in memory at the end.
 */
import { useCallback, useRef } from 'react';
import { detectPalmarGrasp } from '../services/reflexEngine/reflexDetectors/palmarGrasp';

const WINDOW_FRAMES = 150;   // ~5s at 30fps
const MIN_TAIL_FRAMES = 30;  // a final part-window shorter than this is dropped

/** Same thresholds the detectors use, so one vocabulary across the platform. */
function labelFor(score) {
  if (score >= 65) return 'strong';
  if (score >= 40) return 'moderate';
  if (score >= 20) return 'weak';
  return 'none';
}

/**
 * Combine per-window results into one session result.
 * Windows are weighted by their own confidence, so five seconds in which the
 * hand was barely visible does not count as much as five clean ones.
 */
export function aggregateWindows(windows) {
  const usable = windows.filter((w) => w && w.score != null && w.confidence > 0);
  if (usable.length === 0) {
    return {
      score: null, label: 'not_measured', confidence: 0, measured: false,
      detail: { reason: 'The hand was never clearly in view', windows: windows.length },
    };
  }
  const weight = usable.reduce((a, w) => a + w.confidence, 0);
  const score = Math.round(usable.reduce((a, w) => a + w.score * w.confidence, 0) / weight);
  const confidence = weight / usable.length;
  return {
    score,
    label: labelFor(score),
    confidence: Number(confidence.toFixed(3)),
    measured: true,
    detail: { windows_analyzed: usable.length, windows_total: windows.length },
  };
}

export default function useGraspMeasure() {
  const bufferRef = useRef([]);
  const windowsRef = useRef([]);

  const reset = useCallback(() => {
    bufferRef.current = [];
    windowsRef.current = [];
  }, []);

  /**
   * @param {Array}  landmarks   21 MediaPipe hand landmarks, or null
   * @param {number} timestamp   performance.now() of the camera result
   * @param {'Left'|'Right'|null} handedness  which hand, when known
   */
  const push = useCallback((landmarks, timestamp, handedness = null) => {
    if (!landmarks || landmarks.length < 21 || !Number.isFinite(timestamp)) return;
    /* Handedness is a hint, not a requirement: the detector treats the two
       slots independently and reports symmetry as null when only one is filled,
       so putting an unlabelled hand in `rightHand` costs nothing. */
    bufferRef.current.push({
      timestamp,
      leftHand: handedness === 'Left' ? landmarks : null,
      rightHand: handedness === 'Left' ? null : landmarks,
    });

    if (bufferRef.current.length >= WINDOW_FRAMES) {
      windowsRef.current.push(detectPalmarGrasp(bufferRef.current));
      bufferRef.current = [];
    }
  }, []);

  /** Close the current window and return the session result. */
  const result = useCallback(() => {
    if (bufferRef.current.length >= MIN_TAIL_FRAMES) {
      windowsRef.current.push(detectPalmarGrasp(bufferRef.current));
      bufferRef.current = [];
    }
    return aggregateWindows(windowsRef.current);
  }, []);

  return { push, reset, result };
}
