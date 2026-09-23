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
 *   4. THE CAMERA IS NEVER ON WITHOUT SOMETHING ON SCREEN SAYING SO. This
 *      used to render an invisible 2-pixel <video>, on the theory that a
 *      touch round is "not the camera one". It now shows the same
 *      picture-in-picture frame (video + LIVE badge) as the camera games,
 *      via CameraLandmarks — so posture capture running in the background
 *      is exactly as visible as hand tracking running in the foreground.
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
import { createPortal } from 'react-dom';
import useUpperBodyTracking from '../../hooks/useUpperBodyTracking';
import { finalisePoseSession } from '../../services/pose/poseSession';
/* Same picture-in-picture frame the camera ("air mode") games show — video
   feed + a LIVE/Recherche… badge — so a touch-mode round that is recording
   posture in the background is just as visible as one that reads the
   camera to play. The old behaviour pinned this <video> to 2 transparent
   pixels (see PoseConsent.css) precisely because it was invisible on
   purpose; that is the gap being closed here. */
import CameraLandmarks from './CameraLandmarks';

/**
 * The child-facing consent card was removed by product decision. Capture is
 * unchanged — same camera, same landmarks, same upload — but it now runs under
 * the consent the PARENT gives at signup rather than a per-session question.
 *
 * This object is written verbatim into raw_pose_tracking.consent. Rows recorded
 * before this change carry 'pose-consent-v1' and represent the child's own
 * answer; these carry a different basis. Reusing the old version string would
 * have recorded an assent that was never given.
 *
 * TODO: once a row is actually written to public.consent at signup, carry the
 * parent's real consent id and timestamp here instead of only the capture time.
 */
const PARENTAL_CAPTURE_BASIS = Object.freeze({
  granted: true,
  version: 'parental-consent-v1',
  basis: 'parental_signup_consent',
  childPrompted: false,
});

const TouchModePose = forwardRef(function TouchModePose({
  gameId,
  active = false,
  finished = false,
  sessionId = null,
  childId = null,
  /** Optional: receives the analysis so a results screen can show it later. */
  onAnalysis = null,
  /**
   * Optional: fires with the current `isTracking` value every time it
   * changes, so a game can show a live "Posture tracking active" /
   * "Preparing camera…" badge (e.g. on PosturePrepCard) without polling the
   * imperative handle from inside an unrelated render.
   */
  onTrackingChange = null,
  /**
   * The game's own play-field ref (the same `fieldRef` every game already
   * attaches to its `.xxx-field` div — the element `.cam-lm-widget` positions
   * itself against in camera mode). Passed in so the touch-mode frame lands
   * in the exact top-left corner of the field, not just somewhere on screen:
   * this component is rendered as a sibling of <main>, outside that field, so
   * without a portal into it the frame would be positioned against the page
   * instead and land in the wrong spot (e.g. under the header). Optional —
   * a game that does not pass it gets the fixed-corner fallback below rather
   * than a crash.
   */
  fieldRef = null,
  /**
   * Some games (LetterQuest/GamePage) don't use the small CameraLandmarks
   * picture-in-picture widget at all — camera mode fills a full dedicated
   * panel (`.camera-box`) with a plain <video>+<canvas>, edge to edge. For
   * those, `inline` renders the same bare elements (reusing CameraLandmarks'
   * own CSS classes, so the mirroring and object-fit match exactly) instead
   * of the badge-and-border widget, so a touch-mode round looks like camera
   * mode actually looks in that panel rather than a small floating box
   * dropped on top of it.
   */
  inline = false,
}, ref) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  /* The field DOM node becomes available only after the game's own render +
     commit, one tick after this component's first render (refs are null on
     the very first pass) — hence the effect instead of reading
     `fieldRef.current` directly during render. */
  const [fieldNode, setFieldNode] = useState(null);
  useEffect(() => {
    setFieldNode(fieldRef?.current || null);
  }, [fieldRef]);

  /* Fixed for the life of the component: there is no runtime decision left.
     `recordedAt` is when capture started, NOT when the parent consented —
     different facts, so the field name keeps them apart. */
  const [consent] = useState(() => ({
    ...PARENTAL_CAPTURE_BASIS,
    recordedAt: new Date().toISOString(),
  }));

  /* Props read from callbacks that must not be re-created on every render —
     a changing `finalise` identity would re-run the finish effect. */
  const consentRef = useRef(consent);
  const sessionIdRef = useRef(sessionId);
  const childIdRef = useRef(childId);
  const gameIdRef = useRef(gameId);
  const onAnalysisRef = useRef(onAnalysis);
  const onTrackingChangeRef = useRef(onTrackingChange);
  useEffect(() => { consentRef.current = consent; }, [consent]);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  useEffect(() => { childIdRef.current = childId; }, [childId]);
  useEffect(() => { gameIdRef.current = gameId; }, [gameId]);
  useEffect(() => { onAnalysisRef.current = onAnalysis; }, [onAnalysis]);
  useEffect(() => { onTrackingChangeRef.current = onTrackingChange; }, [onTrackingChange]);

  const savedRef = useRef(false);
  const roundClosedRef = useRef(false);

  const enabled = active && consent?.granted === true;

  const {
    isTracking, frameCount, unavailable,
    getRecording, reset, releaseCamera,
  } = useUpperBodyTracking(videoRef, canvasRef, { enabled, gameId });

  /* CameraLandmarks' "camera unavailable" fallback wants a truthy value, not
     just the boolean `unavailable` — reuse it as-is, it's already the right
     shape for the prop. */
  const cameraError = unavailable || null;

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

  /* Lets a game react to the badge state changing (see `onTrackingChange`
     above) instead of only being able to poll the imperative handle from
     its own render. */
  useEffect(() => { onTrackingChangeRef.current?.(isTracking); }, [isTracking]);

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

  if (!enabled) return null;

  /* Its own <video>, never shared — two MediaPipe graphs pointed at one
     element compete for its frames and both degrade. Rendered only while
     `enabled`, matching the invariant above: no visible camera frame before
     there is an actual camera to show. Same widget, same badge, same
     "camera unavailable" fallback as every air-mode game — a touch round
     that is recording posture in the background gets the same on-screen
     tell that the camera is live, in the same spot camera mode uses. */
  const frame = inline ? (
    /* `.cam-lm-video`/`.cam-lm-canvas` do the actual work here (mirror +
       object-fit: cover, absolutely filling the parent) — no widget border,
       no badge, so it drops into a game's own full-size camera panel and
       looks like that panel always looks in camera mode. cameraError isn't
       shown here: the caller already has its own "camera unavailable" state
       for its camera-mode branch and decides when to fall back to it. */
    cameraError ? null : (
      <>
        <video ref={videoRef} className="cam-lm-video" playsInline muted autoPlay />
        <canvas ref={canvasRef} width={640} height={360} className="cam-lm-canvas" aria-hidden="true" />
      </>
    )
  ) : (
    <CameraLandmarks
      videoRef={videoRef}
      canvasRef={canvasRef}
      detected={isTracking}
      error={cameraError}
      className={fieldNode ? '' : 'touch-mode-pose-frame'}
    />
  );

  /* Portal it into the game's own field — same positioned ancestor
     CameraLandmarks uses in camera mode, so the CSS it already ships with
     (`.cam-lm-widget { position: absolute; top: 14px; left: 14px; }`) lands
     it in the identical spot without any touch-mode-specific override.
     `fieldNode` is only set once the field DOM node exists (see the effect
     above), so there is one extra render with nothing visible yet — the
     camera itself only starts a beat after `enabled` flips true anyway. */
  return fieldNode ? createPortal(frame, fieldNode) : frame;
});

export default TouchModePose;
