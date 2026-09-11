/**
 * TouchModePose.jsx
 * ---------------------------------------------------------------------------
 * The whole touch-mode pose pipeline, as one element a game can drop in.
 *
 *   [consent] → capture → features → indicators → persist
 *
 * WHY THIS EXISTS
 * ---------------
 * Pinch the Coin carried this wiring by hand: three imports, three pieces of
 * state, a `poseEnabled` expression, two effects and two bits of JSX — about
 * forty lines. Copying that into six more games would mean seven places where
 * the consent gate could drift apart, and a consent gate that is right in six
 * files out of seven is not a consent gate. So it lives here once, and a game
 * says only *when* a round is running and *when* it has ended.
 *
 * WHAT A GAME IS RESPONSIBLE FOR
 * ------------------------------
 *   active    the round is in progress AND the game is in touch mode
 *   finished  the round is over
 * Everything else — asking, starting the camera, decimating, releasing the
 * webcam, analysing, uploading, and never doing any of it without a yes — is
 * handled in here.
 *
 * THREE INVARIANTS THIS COMPONENT KEEPS
 * -------------------------------------
 *   1. THE CAMERA NEVER OPENS WITHOUT AN EXPLICIT YES. `enabled` is
 *      `active && consent.granted === true`, and consent starts null. There is
 *      no code path that sets it any other way.
 *   2. A FAILED UPLOAD NEVER COSTS A CHILD THEIR RESULT. Everything here is
 *      off the game's critical path and nothing rejects into it.
 *   3. A REPLAY IS A NEW RECORDING. The frame buffer is cleared when a new
 *      round starts, so round two is not round one plus round two.
 *
 * GAMES THAT NAVIGATE AWAY ON FINISH
 * ----------------------------------
 * LetterQuest routes to a results page instead of switching phase, so the
 * `finished` effect would race the unmount. Those games hold a ref and call
 * `finalise()` themselves before navigating; the upload is a fetch already in
 * flight by then and completes regardless of the unmount.
 */
import React, {
  forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState,
} from 'react';
import { AnimatePresence } from 'framer-motion';
import useUpperBodyTracking from '../../hooks/useUpperBodyTracking';
import PoseConsentPrompt from './PoseConsentPrompt';
import { finalisePoseSession } from '../../services/pose/poseSession';

const TouchModePose = forwardRef(function TouchModePose({
  gameId,
  active = false,
  finished = false,
  sessionId = null,
  childId = null,
  learnerName = null,
  /** Optional: receives the analysis so a results screen can show it later. */
  onAnalysis = null,
  /** Set false to hold the prompt back at a moment it would be intrusive. */
  canAsk = true,
}, ref) {
  const videoRef = useRef(null);
  const [consent, setConsent] = useState(null);

  /* Props read from callbacks that must not be re-created on every render —
     a changing `finalise` identity would re-run the finish effect. */
  const consentRef = useRef(consent);
  const sessionIdRef = useRef(sessionId);
  const childIdRef = useRef(childId);
  const gameIdRef = useRef(gameId);
  const onAnalysisRef = useRef(onAnalysis);
  useEffect(() => { consentRef.current = consent; }, [consent]);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  useEffect(() => { childIdRef.current = childId; }, [childId]);
  useEffect(() => { gameIdRef.current = gameId; }, [gameId]);
  useEffect(() => { onAnalysisRef.current = onAnalysis; }, [onAnalysis]);

  const savedRef = useRef(false);
  const roundClosedRef = useRef(false);

  const enabled = active && consent?.granted === true;

  const {
    isTracking, frameCount, unavailable,
    getRecording, reset, releaseCamera,
  } = useUpperBodyTracking(videoRef, { enabled, gameId });

  /**
   * Analyse and upload the recording. Idempotent, and safe to call before the
   * session id exists — it declines without burning the one-shot guard, so the
   * effect below can try again when the id arrives.
   */
  const finalise = useCallback(async () => {
    if (savedRef.current) return null;
    if (consentRef.current?.granted !== true) return null;
    const sid = sessionIdRef.current;
    const cid = childIdRef.current;
    if (!sid || !cid) return null;

    savedRef.current = true;
    try {
      const out = await finalisePoseSession({
        getRecording,
        sessionId: sid,
        childId: cid,
        gameId: gameIdRef.current,
        consent: consentRef.current,
      });
      /* Handed over even when the upload failed: a lost research row is not a
         lost report, and the screen may still want to show what was measured. */
      onAnalysisRef.current?.(out?.analysis || null);
      return out;
    } catch (err) {
      console.warn(`[pose:${gameIdRef.current}] finalise failed:`, err?.message);
      return null;
    }
  }, [getRecording]);

  /* ── The round ended ─────────────────────────────────────────────────────
     Release the webcam first, on every exit path — the privacy light going out
     the instant a round ends is the visible promise this feature makes. The
     upload reads a buffer that is already complete, so ordering costs nothing.
     `sessionId` is in the deps because it often arrives after the phase does. */
  useEffect(() => {
    if (!finished) return;
    releaseCamera();
    finalise();
  }, [finished, sessionId, childId, finalise, releaseCamera]);

  useEffect(() => { if (finished) roundClosedRef.current = true; }, [finished]);

  /* ── A new round after a finished one ────────────────────────────────────
     Clear the buffer, or "play again" would upload round one's frames stapled
     to round two's. Deliberately keyed off a round having CLOSED, not off
     `active` alone, so a phase that flickers mid-round cannot wipe a recording
     that is still being made. The consent answer is kept: asking a child the
     same question after every single round is not more consent, it is nagging. */
  useEffect(() => {
    if (!active || !roundClosedRef.current) return;
    roundClosedRef.current = false;
    savedRef.current = false;
    reset();
  }, [active, reset]);

  useImperativeHandle(ref, () => ({
    finalise,
    getRecording,
    isTracking,
    frameCount,
    unavailable,
    consent,
  }), [finalise, getRecording, isTracking, frameCount, unavailable, consent]);

  const askNow = canAsk && active && consent == null;

  return (
    <>
      {/* Its own element, never shared. Two MediaPipe graphs pointed at one
          <video> compete for its frames and both degrade. */}
      <video ref={videoRef} className="tmp-pose-video" playsInline muted />

      <AnimatePresence>
        {askNow && (
          <PoseConsentPrompt
            key="pose-consent"
            learnerName={learnerName}
            onDecision={setConsent}
          />
        )}
      </AnimatePresence>
    </>
  );
});

export default TouchModePose;
