const sharp = require('sharp');

const ROLL_DEAD_ZONE_DEG = 1;
const MAX_ROLL_DEG = 15;
const WARN_YAW_RATIO = 0.12;
const MAX_YAW_RATIO = 0.25;

function facePoints(face) {
  const points = face?.landmarks;
  if (!Array.isArray(points) || points.length !== 5 || points.some(p => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)))
    throw new Error('无法可靠定位面部关键点，请使用清晰正面照片');
  const distance = Math.hypot(points[1][0] - points[0][0], points[1][1] - points[0][1]);
  if (distance <= 0) throw new Error('无法可靠定位双眼，请使用清晰正面照片');
  return { points, distance };
}
function rollDegrees(face) {
  const { points: [a, b] } = facePoints(face);
  return Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
}
function needsRotation(roll) {
  if (!Number.isFinite(roll)) throw new Error('无法判断头部倾斜，请使用清晰正面照片');
  if (Math.abs(roll) > MAX_ROLL_DEG) throw new Error(`头部倾斜约 ${Math.abs(roll).toFixed(1)}°，请摆正头部重拍`);
  return Math.abs(roll) > ROLL_DEAD_ZONE_DEG;
}
function yawRatio(face) {
  const { points: [a, b, nose], distance } = facePoints(face);
  return (nose[0] - (a[0] + b[0]) / 2) / distance;
}
function warnsYaw(yaw) {
  if (!Number.isFinite(yaw)) throw new Error('无法判断面部朝向，请使用清晰正面照片');
  if (Math.abs(yaw) >= MAX_YAW_RATIO) throw new Error('脸部没有正对镜头，请正脸重拍');
  return Math.abs(yaw) >= WARN_YAW_RATIO;
}

async function rotateDecodedImage(image, degrees) {
  const raw = { width: image.width, height: image.height, channels: 4 };
  const rotate = input => sharp(input, { raw }).rotate(degrees, { background: '#00000000' })
    .raw().toBuffer({ resolveWithObject: true });
  // 有效性与原图透明度分开：PNG 自带透明区仍在原图画布内。
  // 两张 RGBA 图使用完全相同的旋转操作；新增画布 alpha=0。
  const validRgba = Buffer.alloc(image.width * image.height * 4, 255);
  if (image.validity) {
    if (image.validity.length !== image.width * image.height) throw new Error('有效像素掩码尺寸无效');
    for (let i = 0; i < image.validity.length; i++) validRgba[i * 4 + 3] = image.validity[i];
  }
  const [photo, mask] = await Promise.all([rotate(image.data), rotate(validRgba)]);
  if (photo.info.width !== mask.info.width || photo.info.height !== mask.info.height || mask.info.channels !== 4)
    throw new Error('旋转后有效像素掩码尺寸无效');
  const validity = Buffer.alloc(photo.info.width * photo.info.height);
  for (let i = 0; i < validity.length; i++) validity[i] = mask.data[i * 4 + 3];
  return { data: photo.data, width: photo.info.width, height: photo.info.height, channels: 4, validity };
}
module.exports = { ROLL_DEAD_ZONE_DEG, MAX_ROLL_DEG, WARN_YAW_RATIO, MAX_YAW_RATIO,
  rollDegrees, needsRotation, yawRatio, warnsYaw, rotateDecodedImage };
