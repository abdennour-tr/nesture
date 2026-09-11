/**
 * poseLandmarks.js
 * ---------------------------------------------------------------------------
 * The MediaPipe Pose landmark map, and the upper-body subset this platform
 * records.
 *
 * MediaPipe Pose returns 33 landmarks. Everything from the hips down is
 * irrelevant to a seated child at a laptop and is usually out of frame anyway,
 * so recording it would be noise in the dataset and storage spent on nothing.
 * The hips are the exception: they are the reference the trunk is measured
 * against, so they are kept even though they are often partly occluded by a
 * desk — `visibility` is stored with every point so an analyst can filter on it
 * rather than guessing later.
 *
 * Landmark names are from the SUBJECT's point of view (their left hand is
 * `left_wrist`), not the camera's. MediaPipe handles the mirroring; nothing
 * downstream should flip it again.
 *
 * Coordinates as stored:
 *   x, y   normalised 0..1 against the image width/height
 *   z      depth in roughly the same scale as x, origin at the hip midpoint,
 *          negative toward the camera. Noisy from a single webcam — recorded
 *          for completeness, but no indicator in this platform depends on it.
 *   visibility  0..1 model confidence that the point is present and unoccluded
 */

/** Index of every landmark this platform records. */
export const POSE = {
  NOSE: 0,
  LEFT_EYE_INNER: 1,
  LEFT_EYE: 2,
  LEFT_EYE_OUTER: 3,
  RIGHT_EYE_INNER: 4,
  RIGHT_EYE: 5,
  RIGHT_EYE_OUTER: 6,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  MOUTH_LEFT: 9,
  MOUTH_RIGHT: 10,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_PINKY: 17,
  RIGHT_PINKY: 18,
  LEFT_INDEX: 19,
  RIGHT_INDEX: 20,
  LEFT_THUMB: 21,
  RIGHT_THUMB: 22,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
};

/** Human-readable name per index, used as the Excel "Landmark" column. */
export const POSE_NAME = Object.fromEntries(
  Object.entries(POSE).map(([name, index]) => [index, name.toLowerCase()]),
);

/**
 * The indices recorded for every frame, in order.
 *
 * Ordered head → shoulders → arms → hands → hips so a spreadsheet reads down
 * the body. Anything not in this list is discarded at capture time and never
 * reaches storage.
 */
export const RECORDED_LANDMARKS = [
  POSE.NOSE,
  POSE.LEFT_EYE, POSE.RIGHT_EYE,
  POSE.LEFT_EAR, POSE.RIGHT_EAR,
  POSE.MOUTH_LEFT, POSE.MOUTH_RIGHT,
  POSE.LEFT_SHOULDER, POSE.RIGHT_SHOULDER,
  POSE.LEFT_ELBOW, POSE.RIGHT_ELBOW,
  POSE.LEFT_WRIST, POSE.RIGHT_WRIST,
  POSE.LEFT_INDEX, POSE.RIGHT_INDEX,
  POSE.LEFT_THUMB, POSE.RIGHT_THUMB,
  POSE.LEFT_PINKY, POSE.RIGHT_PINKY,
  POSE.LEFT_HIP, POSE.RIGHT_HIP,
];

/** Below this, a landmark is treated as not observed rather than as a position. */
export const MIN_VISIBILITY = 0.5;

/** True when every listed landmark is present and confidently visible. */
export function allVisible(landmarks, indices, minVisibility = MIN_VISIBILITY) {
  if (!landmarks) return false;
  return indices.every((i) => {
    const p = landmarks[i];
    return p && Number.isFinite(p.x) && Number.isFinite(p.y)
      && (p.visibility == null || p.visibility >= minVisibility);
  });
}

/** Landmarks a frame must carry before any feature can be computed from it. */
export const CORE_LANDMARKS = [
  POSE.LEFT_SHOULDER, POSE.RIGHT_SHOULDER, POSE.NOSE,
];

export default POSE;
