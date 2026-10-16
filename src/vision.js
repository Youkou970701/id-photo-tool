const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const ort = require('onnxruntime-node');
const sessions = new Map();
const { workerData } = require('node:worker_threads');
function modelDir() {
  if (workerData?.modelDirectory) return workerData.modelDirectory;
  return process.resourcesPath && fs.existsSync(path.join(process.resourcesPath, 'models'))
    ? path.join(process.resourcesPath, 'models') : path.join(__dirname, '..', 'vendor', 'models');
}
async function session(file) {
  if (!sessions.has(file)) sessions.set(file, (async () => {
    const dir = modelDir();
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    const entry = (manifest.models || manifest).find(m => m.file === file || m.filename === file);
    if (!entry) throw new Error('模型清单缺少 ' + file);
    const bytes = fs.readFileSync(path.join(dir, file));
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error('内置模型损坏，请重新安装应用');
    return ort.InferenceSession.create(bytes, { executionProviders: ['cpu'], intraOpNumThreads: 2, interOpNumThreads: 1 });
  })());
  return sessions.get(file);
}
function iou(a, b) {
  const w = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const intersection = w * h;
  return intersection / (a.width * a.height + b.width * b.height - intersection);
}
async function detectFaces(image) {
  const size = 640, ratio = Math.min(size / image.width, size / image.height);
  const w = Math.max(1, Math.round(image.width * ratio)), h = Math.max(1, Math.round(image.height * ratio));
  const rgb = await sharp(image.data, { raw: { width: image.width, height: image.height, channels: 4 } })
    .flatten({ background: '#ffffff' }).resize(w, h).extend({ bottom: size - h, right: size - w, background: '#000000' })
    .removeAlpha().raw().toBuffer();
  const tensor = new Float32Array(3 * size * size);
  for (let i = 0; i < size * size; i++) {
    tensor[i] = rgb[i * 3 + 2]; tensor[size * size + i] = rgb[i * 3 + 1]; tensor[2 * size * size + i] = rgb[i * 3];
  }
  const net = await session('yunet.onnx');
  const result = await net.run({ [net.inputNames[0]]: new ort.Tensor('float32', tensor, [1, 3, size, size]) });
  const faces = [];
  for (const stride of [8, 16, 32]) {
    const cls = result['cls_' + stride].data, obj = result['obj_' + stride].data, box = result['bbox_' + stride].data;
    const cols = size / stride;
    for (let i = 0; i < cls.length; i++) {
      const score = Math.sqrt(Math.max(0, Math.min(1, cls[i])) * Math.max(0, Math.min(1, obj[i])));
      if (score < 0.7) continue;
      const cx = (i % cols + box[i * 4]) * stride;
      const cy = (Math.floor(i / cols) + box[i * 4 + 1]) * stride;
      const width = Math.exp(box[i * 4 + 2]) * stride;
      const height = Math.exp(box[i * 4 + 3]) * stride;
      if (cx > w || cy > h) continue;
      faces.push({ x: (cx - width / 2) / ratio, y: (cy - height / 2) / ratio, width: width / ratio, height: height / ratio, score });
    }
  }
  faces.sort((a, b) => b.score - a.score);
  const selected = [];
  for (const face of faces) if (selected.every(other => iou(face, other) < 0.3)) selected.push(face);
  return selected;
}
async function segmentPortrait(image) {
  const net = await session('modnet.onnx');
  // 官方 ONNX 使用 RGB NCHW、[-1,1]，动态边长为 32 倍数。
  const input = net.inputMetadata[0];
  const dims = input.shape || input.dimensions;
  let height = typeof dims?.[2] === 'number' && dims[2] > 0 ? dims[2] : 512;
  let width = typeof dims?.[3] === 'number' && dims[3] > 0 ? dims[3] : 512;
  if (typeof dims?.[2] !== 'number' || typeof dims?.[3] !== 'number') {
    const ratio = 512 / Math.max(image.width, image.height);
    height = Math.max(32, Math.round(image.height * ratio / 32) * 32);
    width = Math.max(32, Math.round(image.width * ratio / 32) * 32);
  }
  const rgb = await sharp(image.data, { raw: { width: image.width, height: image.height, channels: 4 } })
    .flatten({ background: '#ffffff' }).resize(width, height).removeAlpha().raw().toBuffer();
  const data = new Float32Array(3 * width * height);
  for (let i = 0; i < width * height; i++) for (let c = 0; c < 3; c++) data[c * width * height + i] = rgb[i * 3 + c] / 127.5 - 1;
  const outputs = await net.run({ [net.inputNames[0]]: new ort.Tensor('float32', data, [1, 3, height, width]) });
  const matte = outputs[net.outputNames[0]];
  const mh = matte.dims[2], mw = matte.dims[3];
  const mask = Buffer.alloc(matte.data.length);
  for (let i = 0; i < mask.length; i++) mask[i] = Math.round(Math.max(0, Math.min(1, matte.data[i])) * 255);
  return sharp(mask, { raw: { width: mw, height: mh, channels: 1 } }).resize(image.width, image.height).greyscale().raw().toBuffer();
}
module.exports = { detectFaces, segmentPortrait, modelDir, iou };
