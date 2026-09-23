/**
 * useHandCapture.js
 * ─────────────────────────────────────────────────────────────────────────────
 * One shared recorder for hand-tracking data, for every game.
 *
 * Before this hook, two games recorded and five did not, because the recording
 * logic lived inside the games themselves and was written twice, differently:
 * LetterQuest flushed the whole session in batches and retried on failure,
 * while Path Tracing stopped dead after 1000 points. Data from the two was
 * never comparable, and adding a third game meant writing the logic a third
 * time. This hook is the thing that was missing.
 *
 * It is driven by `landmarks`, which every game already has in scope from its
 * tracking hook, so wiring a game up costs one call and touches nothing in that
 * game's own tracking loop.
 *
 * WHAT IT RECORDS: landmark 8 — the index fingertip — in MediaPipe's normalised
 * 0..1 coordinates, which is the point every game's pointer is derived from.
 * That is NOT what the legacy rows hold (they hold smoothed cursor positions),
 * which is why every row written here is stamped schema_version 'hand-v2'.
 *
 * FAILURE POLICY: a failed insert puts its batch back at the front of the
 * buffer so the next flush retries it. A dropped research row is not worth
 * interrupting a child's game for, so nothing here ever throws into the render
 * path — but silently discarding a child's session is not acceptable either.
 */
import { useCallback, useEffect, useRef } from 'react';
import { supabase } from '../services/supabaseClient';

/** Index fingertip. The point every game's pointer follows. */
const INDEX_FINGERTIP = 8;

export const HAND_SCHEMA_VERSION = 'hand-v2';

/** ~15Hz. Matches the pose recorder, and is well above what the metrics need. */
const DEFAULT_MIN_INTERVAL_MS = 66;

/** Rows per insert. 600 at 15Hz is roughly a 40-second batch. */
const DEFAULT_BATCH = 600;

/**
 * Mirrors the basis recorded for pose sessions, so the two tables can be read
 * together. See components/game/TouchModePose.jsx for why this is parental
 * rather than the child's own answer.
 */
const CAPTURE_CONSENT = Object.freeze({
  basis: 'parental_signup_consent',
  version: 'parental-consent-v1',
});

export default function useHandCapture({
  /** Record only while this is true — typically "a round is actually running". */
  enabled = false,
  sessionId = null,
  childId = null,
  gameId = null,
  /** The landmark array from the game's tracking hook. */
  landmarks = null,
  minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
  batchSize = DEFAULT_BATCH,
} = {}) {
  const bufferRef = useRef([]);
  const lastAtRef = useRef(0);
  const flushingRef = useRef(false);

  /* Read inside callbacks that must not be rebuilt on every frame. */
  const metaRef = useRef({ sessionId, childId, gameId });
  useEffect(() => {
    metaRef.current = { sessionId, childId, gameId };
  }, [sessionId, childId, gameId]);

  const flush = useCallback(async (final = false) => {
    const { sessionId: sid, childId: cid, gameId: gid } = metaRef.current;
    const batch = bufferRef.current;
    if (!sid || !cid || batch.length === 0) return;
    if (flushingRef.current && !final) return;

    flushingRef.current = true;
    bufferRef.current = [];
    try {
      const { error } = await supabase.from('raw_hand_tracking').insert({
        session_id: sid,
        child_id: cid,
        game_id: gid,
        schema_version: HAND_SCHEMA_VERSION,
        consent: CAPTURE_CONSENT,
        positions: batch,
      });
      if (error) {
        /* Put it back at the FRONT: order is the whole point of a trajectory. */
        bufferRef.current = batch.concat(bufferRef.current);
        console.warn(`[hand:${gid}] save failed, will retry:`, error.message);
      }
    } catch (e) {
      bufferRef.current = batch.concat(bufferRef.current);
      console.warn(`[hand:${gid}] save threw, will retry:`, e?.message);
    } finally {
      flushingRef.current = false;
    }
  }, []);

  /* ── Sampling ──────────────────────────────────────────────────────────────
     Driven by `landmarks` changing identity, which is how every tracking hook
     in this codebase publishes a new frame. Throttled rather than taking every
     frame: the games run their pointers far faster than the metrics need. */
  useEffect(() => {
    if (!enabled) return;
    const { sessionId: sid, childId: cid } = metaRef.current;
    if (!sid || !cid) return;

    const tip = landmarks?.[INDEX_FINGERTIP];
    if (!tip || typeof tip.x !== 'number' || typeof tip.y !== 'number') return;

    const now = Date.now();
    if (now - lastAtRef.current < minIntervalMs) return;
    lastAtRef.current = now;

    bufferRef.current.push({
      x: tip.x,
      y: tip.y,
      z: typeof tip.z === 'number' ? tip.z : null,
      timestamp: now,
    });

    if (bufferRef.current.length >= batchSize) flush();
  }, [landmarks, enabled, minIntervalMs, batchSize, flush]);

  /* ── The round ended ───────────────────────────────────────────────────────
     Send whatever is left. Without this, the last partial batch of every single
     session — the end of the round, often the most interesting part — is lost. */
  useEffect(() => {
    if (enabled) return undefined;
    flush(true);
    return undefined;
  }, [enabled, flush]);

  /* Leaving the page mid-round must not cost the whole buffer. */
  useEffect(() => {
    const onHide = () => { flush(true); };
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      flush(true);
    };
  }, [flush]);

  return { flush };
}
