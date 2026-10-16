// 离线核心，无 Electron 依赖。所有大小判断使用未四舍五入的字节数。
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const { detectFaces, segmentPortrait } = require('./vision');
const KB = 1024;
const MAX_PIXELS = 100_000_000;
const MAX_TOP_OVERFLOW_RATIO = 0.12;
const MAX_BOTTOM_OVERFLOW_RATIO = 0.05;
const MAX_SIDE_OVERFLOW_RATIO = 0.15;
const MAX_UPSCALE_FACTOR = 1.5;
const WARN_UPSCALE_FACTOR = 1.2;
const DECODE_ERROR = '无法读取图片，文件可能损坏或格式不受支持';
const WRITE_PERMISSION_ERROR = '无法写入原图所在文件夹，请把照片复制到桌面等可写位置再试';

function validateOptions(o = {}) {
  const { width, height, minKB, maxKB, background } = o;
  if (![width, height].every(n => Number.isInteger(n) && n >= 32 && n <= 4096) || width * height > 16_000_000)
    throw new Error('宽高必须为 32～4096 的整数，且总像素不超过 1600 万');
  if (![minKB, maxKB].every(Number.isFinite) || minKB < 0 || maxKB <= 0 || minKB > maxKB || maxKB > 20_000)
    throw new Error('请填写有效的 KB 下限和上限（下限可为 0，上限不超过 20000）');
  const minBytes = Math.ceil(minKB * KB), maxBytes = Math.floor(maxKB * KB);
  if (minBytes > maxBytes) throw new Error('KB 区间内没有整数个字节');
  if (typeof background !== 'string' || !/^#[0-9a-f]{6}$/i.test(background)) throw new Error('底色必须是 #RRGGBB');
  return { width, height, minBytes, maxBytes, background };
}

async function decodeImage(input) {
  const stat = await fs.stat(input);
  if (!stat.isFile() || stat.size > 150 * 1024 * 1024) throw new Error('请选择小于 150 MB 的单张图片');
  const buffer = await fs.readFile(input);
  let meta;
  try { meta = await sharp(buffer, { limitInputPixels: MAX_PIXELS }).metadata(); }
  catch { throw new Error(DECODE_ERROR); }
  if (!meta.width || !meta.height || meta.width * meta.height > MAX_PIXELS) throw new Error('原图超过 1 亿像素限制');
  if ((meta.pages || 1) > 1 && meta.format !== 'heif') throw new Error('请选择单张静态照片');
  let image;
  if (meta.format === 'heif' && meta.compression !== 'av1') {
    // sharp 的预编译包通常没有 HEVC 解码器；随包 WASM 负责 HEIC。
    try {
      const decoded = await require('heic-decode')({ buffer });
      if (decoded.width * decoded.height > MAX_PIXELS) throw new Error('图像太大');
      image = sharp(Buffer.from(decoded.data), { raw: { width: decoded.width, height: decoded.height, channels: 4 } });
    } catch { throw new Error('HEIC 解码失败，请确认文件完整且未损坏'); }
  } else image = sharp(buffer, { limitInputPixels: MAX_PIXELS }).rotate();
  try {
    const { data, info } = await image.toColourspace('srgb').ensureAlpha()
      .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
      .raw().toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height, channels: 4 };
  } catch { throw new Error(DECODE_ERROR); }
}

function cropForFace(face, width, height) {
  // YuNet 检出框包含五官而非头发；向上扩 35% 作为头顶，再留 9% 画幅空白。
  const cropHeight = face.height / 0.46;
  const cropWidth = cropHeight * width / height;
  return { left: face.x + face.width / 2 - cropWidth / 2,
    top: face.y - face.height * 0.35 - cropHeight * 0.09, width: cropWidth, height: cropHeight };
}

function validateCrop(image, crop, targetHeight) {
  if (Math.max(0, -crop.top) / crop.height > MAX_TOP_OVERFLOW_RATIO)
    throw new Error('照片头顶不完整，请使用头顶上方有留白的照片');
  if (Math.max(0, crop.top + crop.height - image.height) / crop.height > MAX_BOTTOM_OVERFLOW_RATIO)
    throw new Error('照片下方需包含肩部');
  // 左、右分别按裁剪框宽度判断，少量越界仍可用于补足留白。
  if (Math.max(0, -crop.left, crop.left + crop.width - image.width) / crop.width > MAX_SIDE_OVERFLOW_RATIO)
    throw new Error('人脸太靠近照片边缘');
  const upscale = targetHeight / crop.height;
  if (upscale > MAX_UPSCALE_FACTOR)
    throw new Error(`原图分辨率不足（人脸区域约 ${Math.round(crop.height)} 像素高，要求 ${targetHeight} 像素），请换更清晰的原图`);
  return upscale;
}

async function renderPortrait(image, face, options) {
  const { width, height, background } = options;
  const crop = cropForFace(face, width, height);
  validateCrop(image, crop, height);
  // 在有界工作分辨率抠图后取景，保留透明 PNG 自带的 alpha。
  const mask = await segmentPortrait(image);
  const rgba = Buffer.from(image.data);
  for (let i = 0; i < image.width * image.height; i++) rgba[i * 4 + 3] = Math.round(rgba[i * 4 + 3] * mask[i] / 255);
  const left = Math.max(0, Math.floor(crop.left)), top = Math.max(0, Math.floor(crop.top));
  const right = Math.min(image.width, Math.ceil(crop.left + crop.width));
  const bottom = Math.min(image.height, Math.ceil(crop.top + crop.height));
  if (right <= left || bottom <= top) throw new Error('人脸裁剪区域超出图片');
  const scale = height / crop.height;
  const destLeft = Math.max(0, Math.round((left - crop.left) * scale));
  const destTop = Math.max(0, Math.round((top - crop.top) * scale));
  const destWidth = Math.min(width - destLeft, Math.max(1, Math.round((right - left) * scale)));
  const destHeight = Math.min(height - destTop, Math.max(1, Math.round((bottom - top) * scale)));
  const cut = await sharp(rgba, { raw: { width: image.width, height: image.height, channels: 4 } })
    .extract({ left, top, width: right - left, height: bottom - top })
    .resize(destWidth, destHeight).png().toBuffer();
  return sharp({ create: { width, height, channels: 3, background } })
    .composite([{ input: cut, left: destLeft, top: destTop }]).removeAlpha().png().toBuffer();
}

async function encodeWithinRange(pixels, options) {
  const o = validateOptions(options);
  let smallest = Infinity, largest = 0;
  // 保持要求的输出像素。缩放指内容先降采样再恢复尺寸，绝不偷改报名尺寸。
  for (const scale of [1, 0.85, 0.65, 0.45, 0.3]) {
    let source = pixels;
    if (scale !== 1) source = await sharp(pixels).resize(Math.max(1, Math.round(o.width * scale)), Math.max(1, Math.round(o.height * scale)))
      .png().toBuffer();
    const tried = new Map();
    async function at(q) {
      if (tried.has(q)) return tried.get(q);
      const data = await sharp(source).resize(o.width, o.height).removeAlpha()
        .withMetadata({ density: 96 }).jpeg({ quality: q, mozjpeg: true, chromaSubsampling: '4:4:4' }).toBuffer();
      smallest = Math.min(smallest, data.length); largest = Math.max(largest, data.length);
      tried.set(q, data); return data;
    }
    let lo = 1, hi = 100;
    let candidate;
    while (lo <= hi) {
      const q = Math.floor((lo + hi) / 2), data = await at(q);
      if (data.length <= o.maxBytes) {
        if (data.length >= o.minBytes) candidate = { data, quality: q, scale };
        lo = q + 1;
      } else hi = q - 1;
    }
    if (candidate) return candidate;
    // JPEG 大小并非严格单调；二分没命中时检查剩余质量，不能误判窄区间。
    for (let q = 100; q >= 1; q--) {
      const data = await at(q);
      if (data.length >= o.minBytes && data.length <= o.maxBytes) return { data, quality: q, scale };
    }
    if (scale === 1 && largest < o.minBytes) break;
  }
  throw new Error(`无法达到 ${options.minKB}～${options.maxKB} KB 区间；已尝试的文件为 ${(smallest / KB).toFixed(3)}～${(largest / KB).toFixed(3)} KB。请调整区间或更换原图`);
}

async function saveExclusive(input, data) {
  const { dir, name } = path.parse(input);
  for (let n = 1; n < 10000; n++) {
    const output = path.join(dir, `${name}-报名照${n === 1 ? '' : '-' + n}.jpg`);
    let handle;
    try {
      handle = await fs.open(output, 'wx', 0o600);
      try { await handle.writeFile(data); await handle.close(); }
      catch (e) { await handle.close().catch(() => {}); await fs.unlink(output).catch(() => {}); throw e; }
      return output;
    } catch (e) {
      if (['EACCES', 'EPERM', 'EROFS'].includes(e.code)) throw new Error(WRITE_PERMISSION_ERROR);
      if (e.code !== 'EEXIST') throw e;
    }
  }
  throw new Error('同名输出文件过多，请整理目录后重试');
}

async function processPhoto(input, options, onProgress = () => {}) {
  try {
    const o = validateOptions(options);
    onProgress('读取照片…');
    const image = await decodeImage(input);
    onProgress('本地识别人脸…');
    const faces = await detectFaces(image);
    if (!faces.length) throw new Error('未检测到人脸，请使用清晰、正面、光线充足的单人人像');
    if (faces.length !== 1) throw new Error(`检测到 ${faces.length} 张人脸，请使用只有一人的照片`);
    const upscale = validateCrop(image, cropForFace(faces[0], o.width, o.height), o.height);
    onProgress('本地抠图、裁剪和换底色…');
    const pixels = await renderPortrait(image, faces[0], o);
    onProgress('匹配文件大小区间…');
    const { data, quality, scale } = await encodeWithinRange(pixels, options);
    const meta = await sharp(data).metadata();
    if (data.length < o.minBytes || data.length > o.maxBytes || meta.width !== o.width || meta.height !== o.height)
      throw new Error('最终校验失败，未输出文件');
    const output = await saveExclusive(input, data);
    return { ok: true, output, bytes: data.length, width: meta.width, height: meta.height,
      quality, scale, preview: 'data:image/jpeg;base64,' + data.toString('base64'),
      note: [
        upscale >= WARN_UPSCALE_FACTOR ? `原图偏小，已放大 ${upscale.toFixed(2)} 倍，请放大检查清晰度。` : '',
        scale < 1 ? '已降低细节分辨率以满足大小，请放大检查清晰度。报名是否通过仍以官方审核为准。' : '请检查发丝边缘、头顶留白与清晰度，报名是否通过以官方审核为准。',
      ].filter(Boolean).join('') };
  } catch (e) { return { ok: false, note: e.message }; }
}

async function previewPhoto(input) {
  const image = await decodeImage(input);
  const data = await sharp(image.data, { raw: { width: image.width, height: image.height, channels: 4 } })
    .resize({ width: 720, height: 720, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  return 'data:image/png;base64,' + data.toString('base64');
}
module.exports = { KB, MAX_TOP_OVERFLOW_RATIO, MAX_BOTTOM_OVERFLOW_RATIO, MAX_SIDE_OVERFLOW_RATIO,
  MAX_UPSCALE_FACTOR, WARN_UPSCALE_FACTOR, validateOptions, decodeImage, cropForFace, validateCrop,
  renderPortrait, encodeWithinRange, saveExclusive, processPhoto, previewPhoto };
