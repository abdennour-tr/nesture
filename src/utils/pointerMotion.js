/** Move the displayed fingertip once per animation frame, in screen units.
 * Time constants keep the same feel on 30/60/120Hz displays. Games use this
 * position for interaction too, so visual and hit-test hotspots agree.
 */
export function advanceHandMotion(target, shown, now = performance.now()) {
  if (!Number.isFinite(now)) return shown;
  const previous = shown.updatedAt;
  const dt = previous === undefined ? 1 / 60 : Math.max(0, Math.min(0.05, (now - previous) / 1000));
  shown.updatedAt = now;
  if (target.on === 1 && (shown.on < 0.04 || target.snap)) {
    shown.x = target.x;
    shown.y = target.y;
    shown.scale = target.scale;
    target.snap = false;
  }
  const positionAlpha = 1 - Math.exp(-dt / 0.018);
  const scaleAlpha = 1 - Math.exp(-dt / 0.12);
  const opacityAlpha = 1 - Math.exp(-dt / 0.055);
  shown.x += (target.x - shown.x) * positionAlpha;
  shown.y += (target.y - shown.y) * positionAlpha;
  shown.scale += (target.scale - shown.scale) * scaleAlpha;
  shown.on += (target.on - shown.on) * opacityAlpha;
  return shown;
}
