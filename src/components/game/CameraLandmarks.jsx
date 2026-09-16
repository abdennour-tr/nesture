import React from 'react';
import '../../styles/CameraLandmarks.css';

/**
 * CameraLandmarks — a compact, styled camera + hand-landmarks preview
 * (picture-in-picture), shared by the camera games so each shows the live feed
 * the same way LetterQuest does.
 *
 * Pass the SAME refs you give to useHandTracking(videoRef, canvasRef, …): the
 * hook streams the webcam into the <video> and draws the hand skeleton onto the
 * <canvas>. Both are mirrored together so the dots track the image.
 *
 * Props:
 *   videoRef, canvasRef — the refs handed to the tracking hook.
 *   detected            — true when a hand is currently tracked (drives the badge).
 *   error               — truthy to show a "camera unavailable" fallback.
 *   className           — optional extra class for per-game position overrides.
 */
export default function CameraLandmarks({ videoRef, canvasRef, detected = false, error = null, className = '' }) {
  return (
    <div className={'cam-lm-widget' + (className ? ' ' + className : '')} aria-label="Camera preview with hand tracking">
      {error ? (
        <div className="cam-lm-fallback"><span aria-hidden="true">📷</span>Caméra indisponible</div>
      ) : (
        <>
          <video ref={videoRef} className="cam-lm-video" playsInline muted autoPlay />
          <canvas ref={canvasRef} width={640} height={360} className="cam-lm-canvas" aria-hidden="true" />
          <div className={'cam-lm-badge' + (detected ? ' is-live' : '')}>
            <span className="cam-lm-dot" aria-hidden="true" />{detected ? 'LIVE' : 'Recherche…'}
          </div>
        </>
      )}
    </div>
  );
}
