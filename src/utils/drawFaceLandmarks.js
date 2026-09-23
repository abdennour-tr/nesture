/**
 * drawFaceLandmarks.js
 * ---------------------------------------------------------------------------
 * Draws the key MediaPipe Face Mesh points (contour, eyes, brows, nose,
 * mouth, iris) onto a canvas — the same key-point set and colours
 * useMediaPipeTracking.js already draws for LetterQuest, pulled out here so
 * a second game (Trace & Type, which uses the standalone useFaceMesh hook
 * rather than the unified LetterQuest one) can show the same dots on its own
 * camera preview without duplicating the point list by hand.
 *
 * Deliberately NOT wired back into useMediaPipeTracking.js itself: that hook
 * is exercised by LetterQuest in production today, and re-pointing a working
 * hook at a shared util for a change nobody asked for there is a risk with no
 * benefit. Both copies drawing the same points is an acceptable duplication.
 */

// Face contour, eyes, eyebrows, nose, mouth, iris (iris needs refineLandmarks).
export const FACE_KEY_POINTS = [
  // Contour du visage
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
  397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
  172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
  // Yeux
  33, 7, 163, 144, 145, 153, 154, 155, 133,
  362, 382, 381, 380, 374, 373, 390, 249, 263,
  // Sourcils
  46, 53, 52, 65, 55, 285, 295, 282, 283, 276,
  // Nez
  1, 2, 98, 327,
  // Bouche
  61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291,
  375, 321, 405, 314, 17, 84, 181, 91, 146,
  // Iris (disponibles avec refineLandmarks)
  468, 469, 470, 471, 472,  // iris gauche
  473, 474, 475, 476, 477,  // iris droit
];

/**
 * @param {Array|null} faceLm  468/478 landmarks {x,y,z}, or null/undefined —
 *   clears the canvas rather than drawing stale dots when no face is seen.
 * @param {HTMLCanvasElement|null} canvas
 */
export function drawFaceLandmarks(faceLm, canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (!faceLm || faceLm.length < 468) return;

  for (const idx of FACE_KEY_POINTS) {
    const p = faceLm[idx];
    if (!p) continue;
    const isIris = idx >= 468;
    const x = p.x * w, y = p.y * h;
    ctx.beginPath();
    ctx.arc(x, y, isIris ? 3 : 1.5, 0, 2 * Math.PI);
    ctx.fillStyle = isIris
      ? 'rgba(255, 200, 0, 0.9)'       // iris : jaune
      : 'rgba(34, 211, 238, 0.65)';    // visage : cyan
    ctx.fill();
  }
}
