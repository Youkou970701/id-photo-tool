// YuNet 关键点只用于非阻断提醒，不作为姿态合格判据。
const WARN_YAW_RATIO = 0.2;
function yawRatio(face) {
  const points = face?.landmarks;
  if (!Array.isArray(points) || points.length !== 5 || points.some(p => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite))) return null;
  const [a, b, nose] = points;
  const distance = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (!distance) return null;
  const yaw = (nose[0] - (a[0] + b[0]) / 2) / distance;
  return Number.isFinite(yaw) ? yaw : null;
}
function warnsYaw(yaw) {
  return Number.isFinite(yaw) && Math.abs(yaw) >= WARN_YAW_RATIO;
}
module.exports = { WARN_YAW_RATIO, yawRatio, warnsYaw };
