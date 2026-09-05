/**
 * reflexEngine/mathUtils.js
 * Fonctions mathématiques fondamentales pour le moteur de détection des réflexes primitifs.
 * Détection de patrons développementaux (non diagnostique)
 */

// ── Distance ──────────────────────────────────────────────────────────────────

/** Distance euclidienne 3D entre deux landmarks {x, y, z} */
export function distance3D(p1, p2) {
  if (!p1 || !p2) return 0;
  const dx = (p1.x || 0) - (p2.x || 0);
  const dy = (p1.y || 0) - (p2.y || 0);
  const dz = (p1.z || 0) - (p2.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Distance 2D (x, y uniquement) — utile pour la détection main-bouche */
export function distance2D(p1, p2) {
  if (!p1 || !p2) return 0;
  const dx = (p1.x || 0) - (p2.x || 0);
  const dy = (p1.y || 0) - (p2.y || 0);
  return Math.sqrt(dx * dx + dy * dy);
}

// ── Vecteurs ──────────────────────────────────────────────────────────────────

/** Vecteur de direction normalisé entre deux points */
export function directionVector(from, to) {
  if (!from || !to) return { x: 0, y: 0, z: 0 };
  const dx = (to.x || 0) - (from.x || 0);
  const dy = (to.y || 0) - (from.y || 0);
  const dz = (to.z || 0) - (from.z || 0);
  const mag = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  return { x: dx / mag, y: dy / mag, z: dz / mag };
}

/** Magnitude d'un vecteur */
export function magnitude(v) {
  if (!v) return 0;
  return Math.sqrt((v.x || 0) ** 2 + (v.y || 0) ** 2 + (v.z || 0) ** 2);
}

// ── Cosine Similarity ─────────────────────────────────────────────────────────

/** Similarité cosinus entre deux vecteurs [-1, 1]. 1 = même direction, -1 = opposé */
export function cosineSimilarity(v1, v2) {
  if (!v1 || !v2) return 0;
  const dot = (v1.x * v2.x) + (v1.y * v2.y) + ((v1.z || 0) * (v2.z || 0));
  const mag1 = magnitude(v1) || 1;
  const mag2 = magnitude(v2) || 1;
  return dot / (mag1 * mag2);
}

// ── Vitesse ───────────────────────────────────────────────────────────────────

/** Vitesse de déplacement d'un point entre deux frames (unités/seconde) */
export function speed(p1, p2, dtMs) {
  if (!p1 || !p2 || !dtMs || dtMs <= 0) return 0;
  return distance3D(p1, p2) / (dtMs / 1000);
}

/** Vitesse 2D (pour mouvements oculaires et iris) */
export function speed2D(p1, p2, dtMs) {
  if (!p1 || !p2 || !dtMs || dtMs <= 0) return 0;
  return distance2D(p1, p2) / (dtMs / 1000);
}

// ── Corrélation ───────────────────────────────────────────────────────────────

/**
 * Corrélation de Pearson entre deux séries temporelles.
 * Retourne une valeur entre -1 et 1.
 * -1 = corrélation inverse parfaite, 1 = corrélation directe parfaite.
 */
export function pearsonCorrelation(arr1, arr2) {
  const n = Math.min(arr1.length, arr2.length);
  if (n < 2) return 0;

  const a = arr1.slice(0, n);
  const b = arr2.slice(0, n);

  const meanA = a.reduce((s, v) => s + v, 0) / n;
  const meanB = b.reduce((s, v) => s + v, 0) / n;

  let num = 0, denomA = 0, denomB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denomA += da * da;
    denomB += db * db;
  }

  const denom = Math.sqrt(denomA * denomB);
  return denom === 0 ? 0 : num / denom;
}

// ── Extension des doigts ──────────────────────────────────────────────────────

/**
 * Calcule le score d'extension d'un doigt (index = 8, majeur = 12, annulaire = 16, auriculaire = 20).
 * Compare la position de la pointe du doigt avec la base (MCP).
 * Retourne 0 (fermé) à 1 (complètement étendu).
 *
 * Landmarks MediaPipe Hands :
 *   0: Wrist, 1-4: Pouce, 5-8: Index, 9-12: Majeur, 13-16: Annulaire, 17-20: Auriculaire
 *   MCP = 5, 9, 13, 17 | PIP = 6, 10, 14, 18 | DIP = 7, 11, 15, 19 | TIP = 8, 12, 16, 20
 */
export function fingerExtensionScore(landmarks, fingerTipIdx, fingerMcpIdx) {
  if (!landmarks || landmarks.length < 21) return 0;
  const tip = landmarks[fingerTipIdx];
  const mcp = landmarks[fingerMcpIdx];
  const wrist = landmarks[0];
  if (!tip || !mcp || !wrist) return 0;

  const tipDist = distance3D(tip, wrist);
  const mcpDist = distance3D(mcp, wrist);
  if (mcpDist === 0) return 0;

  // Ratio : si la pointe est plus loin que le MCP → doigt étendu
  return Math.min(1, Math.max(0, (tipDist - mcpDist) / mcpDist));
}

/** Score d'extension moyen de l'index (tip=8, mcp=5) */
export function indexExtension(landmarks) {
  return fingerExtensionScore(landmarks, 8, 5);
}

/** Score d'extension global de la main (moyenne des 4 doigts) */
export function handOpenScore(landmarks) {
  if (!landmarks || landmarks.length < 21) return 0;
  const scores = [
    fingerExtensionScore(landmarks, 8, 5),   // Index
    fingerExtensionScore(landmarks, 12, 9),  // Majeur
    fingerExtensionScore(landmarks, 16, 13), // Annulaire
    fingerExtensionScore(landmarks, 20, 17), // Auriculaire
  ];
  return scores.reduce((a, b) => a + b, 0) / 4;
}

/** Distance moyenne doigts → poignet (proxy pour fermeture de la main) */
export function fingersToWristDistance(landmarks) {
  if (!landmarks || landmarks.length < 21) return 0;
  const wrist = landmarks[0];
  const tips = [landmarks[8], landmarks[12], landmarks[16], landmarks[20]];
  const valid = tips.filter(Boolean);
  if (valid.length === 0) return 0;
  return valid.reduce((s, t) => s + distance3D(t, wrist), 0) / valid.length;
}

// ── Iris / Yeux ───────────────────────────────────────────────────────────────

/**
 * Extrait le centre de l'iris à partir des landmarks du face mesh.
 * Iris gauche : indices 468-472, Iris droit : 473-477
 */
export function getIrisCenter(faceLandmarks, side = 'left') {
  if (!faceLandmarks || faceLandmarks.length < 478) return null;
  const indices = side === 'left'
    ? [468, 469, 470, 471, 472]
    : [473, 474, 475, 476, 477];
  const pts = indices.map(i => faceLandmarks[i]).filter(Boolean);
  if (pts.length === 0) return null;
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
  };
}

/** Centre de la bouche (landmarks autour des lèvres) */
export function getMouthCenter(faceLandmarks) {
  if (!faceLandmarks || faceLandmarks.length < 468) return null;
  // Indices lips : 13 (centre haut), 14 (centre bas), 78, 308
  const lipIndices = [13, 14, 78, 308, 61, 291];
  const pts = lipIndices.map(i => faceLandmarks[i]).filter(Boolean);
  if (pts.length === 0) return null;
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
  };
}

/** Ouverture verticale de la bouche */
export function mouthOpenScore(faceLandmarks) {
  if (!faceLandmarks || faceLandmarks.length < 468) return 0;
  const top = faceLandmarks[13];
  const bot = faceLandmarks[14];
  if (!top || !bot) return 0;
  return Math.abs(bot.y - top.y);
}

// ── Statistiques ──────────────────────────────────────────────────────────────

/** Moyenne d'un tableau de nombres */
export function mean(arr) {
  if (!arr || arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/** Variance d'un tableau */
export function variance(arr) {
  if (!arr || arr.length < 2) return 0;
  const m = mean(arr);
  return arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length;
}

/** Écart-type */
export function stddev(arr) {
  return Math.sqrt(variance(arr));
}

/**
 * Une série sans variation ne peut pas porter de corrélation.
 *
 * `pearsonCorrelation` renvoie 0 quand un dénominateur est nul, et 0 se lisait
 * ensuite comme un score de rétention de 0, c'est-à-dire « réflexe intégré ».
 * Une tête parfaitement immobile — ou, comme c'était le cas, une valeur de
 * pitch figée à 0 par un bug de fermeture — produisait donc un bilan rassurant.
 * « Le signal n'a pas varié » et « les deux signaux ne sont pas liés » sont
 * deux affirmations différentes, et une seule des deux est une mesure.
 */
export function hasVariation(arr, minStd = 1e-4) {
  if (!arr || arr.length < 3) return false;
  return stddev(arr) > minStd;
}

/** Clamp une valeur entre min et max */
export function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

/** Normalise une valeur entre 0 et 1 */
export function normalize(val, min, max) {
  if (max === min) return 0;
  return clamp((val - min) / (max - min), 0, 1);
}
