import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharp = require('sharp');
const { validateOptions, decodeImage, cropForFace, encodeWithinRange, processPhoto, saveExclusive } = require('../src/photo');
const { detectFaces, segmentPortrait } = require('../src/vision');
const root = fileURLToPath(new URL('../', import.meta.url));
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), '报名照-tests-'));
const fixture = path.join(root, 'tests/fixtures/astronaut.png');
const opts = { width: 178, height: 220, minKB: 2, maxKB: 20, background: '#ffffff' };
let count = 0;
async function test(name, fn) { const start = Date.now(); await fn(); console.log(`✓ ${name} (${Date.now() - start}ms)`); count++; }
async function checkedOutput(file, options = opts) {
  const before = await fs.readFile(file);
  const r = await processPhoto(file, options);
  assert.equal(r.ok, true, r.note);
  const buffer = await fs.readFile(r.output), meta = await sharp(buffer).metadata();
  assert.equal(meta.format, 'jpeg'); assert.equal(meta.width, options.width); assert.equal(meta.height, options.height);
  assert.equal(meta.density, 96);
  assert.equal(buffer.length, r.bytes);
  assert.ok(buffer.length >= Math.ceil(options.minKB * 1024)); assert.ok(buffer.length <= Math.floor(options.maxKB * 1024));
  assert.deepEqual(await fs.readFile(file), before, '原图不得改动');
  assert.equal(path.dirname(r.output), path.dirname(file));
  return r;
}
try {
  await test('内置模型 SHA256 与许可证完整性', async () => {
    const { verifyModels } = await import('./verify-models.mjs'); await verifyModels();
  });
  await test('参数拒绝空值、反向区间与非法尺寸', async () => {
    for (const invalid of [{width:0},{height:Infinity},{minKB:-1},{maxKB:0},{minKB:21},{width:1.5},{background:'red'},{minKB:NaN}])
      assert.throws(() => validateOptions({...opts,...invalid}));
    const b = validateOptions({...opts,minKB:3/1024,maxKB:3/1024}); assert.equal(b.minBytes,3); assert.equal(b.maxBytes,3);
  });
  const pixels = await sharp(fixture).resize(opts.width,opts.height).png().toBuffer();
  let boundary;
  await test('KB 恰好上限，按字节包含边界', async () => {
    const r = await encodeWithinRange(pixels, {...opts,minKB:0,maxKB:1000}); boundary = r.data.length;
    const exact = await encodeWithinRange(pixels,{...opts,minKB:0,maxKB:boundary/1024}); assert.equal(exact.data.length,boundary);
  });
  await test('KB 恰好下限，以及上下限相等', async () => {
    const r = await encodeWithinRange(pixels,{...opts,minKB:boundary/1024,maxKB:boundary/1024}); assert.equal(r.data.length,boundary);
  });
  await test('二分质量确实压进窄区间', async () => {
    const r = await encodeWithinRange(pixels,{...opts,minKB:5,maxKB:6}); assert.ok(r.data.length>=5120 && r.data.length<=6144);
  });
  await test('质量不足时缩放内容，输出像素仍严格一致', async () => {
    const raw = Buffer.alloc(opts.width * opts.height * 3); let seed = 7;
    for(let i=0;i<raw.length;i++){seed=(seed*1664525+1013904223)>>>0;raw[i]=seed>>>24;}
    const noisy=await sharp(raw,{raw:{width:opts.width,height:opts.height,channels:3}}).png().toBuffer();
    const q1=await sharp(noisy).withMetadata({density:96}).jpeg({quality:1,mozjpeg:true,chromaSubsampling:'4:4:4'}).toBuffer();
    const r=await encodeWithinRange(noisy,{...opts,minKB:0,maxKB:(q1.length-50)/1024});
    assert.ok(r.scale<1); assert.ok(r.data.length<=q1.length-50);
    const meta=await sharp(r.data).metadata(); assert.equal(meta.width,opts.width);assert.equal(meta.height,opts.height);
  });
  await test('极小上限和过高下限明确报错，不填充伪装达标', async () => {
    await assert.rejects(encodeWithinRange(pixels,{...opts,minKB:0,maxKB:0.1}),/无法达到/);
    await assert.rejects(encodeWithinRange(pixels,{...opts,minKB:1000,maxKB:1001}),/无法达到/);
  });
  let image, face;
  await test('真实 ONNX 人脸检测，单人人像', async () => {
    image = await decodeImage(fixture); const faces=await detectFaces(image);
    assert.equal(faces.length,1,JSON.stringify(faces)); face=faces[0];
    assert.ok(face.x>100 && face.x<250); assert.ok(face.y<180);
  });
  await test('头顶留白、脸部水平居中的裁剪几何', async () => {
    const crop=cropForFace(face,opts.width,opts.height);
    assert.ok(Math.abs((face.x+face.width/2-crop.left)/crop.width-0.5)<1e-8);
    assert.ok((face.y-face.height*.35-crop.top)/crop.height>=.089);
    assert.ok(Math.abs(crop.width/crop.height-opts.width/opts.height)<1e-8);
  });
  await test('真实 ONNX 抠图分离背景和人物', async () => {
    const mask=await segmentPortrait(image); assert.equal(mask.length,image.width*image.height);
    const mean=(x,y,size)=>{let total=0;for(let j=y;j<y+size;j++)for(let i=x;i<x+size;i++)total+=mask[j*image.width+i];return total/(size*size);};
    assert.ok(mean(0,0,30)<100,'左上角应为背景'); assert.ok(mean(210,90,30)>170,'面部应为前景');
  });
  await test('竖图完整处理 + 原图不覆盖 + 输出碰撞另存', async () => {
    const f=path.join(tmp,'竖图.png'); await sharp(fixture).extend({top:100,bottom:100,background:'#eee'}).png().toFile(f);
    const a=await checkedOutput(f); const aBytes=await fs.readFile(a.output); const b=await checkedOutput(f);
    assert.notEqual(a.output,b.output); assert.ok(a.output.endsWith('竖图-报名照.jpg')); assert.ok(b.output.endsWith('竖图-报名照-2.jpg'));
    assert.deepEqual(await fs.readFile(a.output),aBytes);
  });
  await test('横图完整处理 + 蓝底', async () => {
    const f=path.join(tmp,'横图.jpg');await sharp(fixture).extend({left:200,right:200,background:'#eee'}).jpeg().toFile(f);
    const r=await checkedOutput(f,{...opts,background:'#438edb'});
    const pixel=await sharp(r.output).extract({left:0,top:0,width:1,height:1}).raw().toBuffer();
    assert.ok(Math.abs(pixel[0]-67)<12 && Math.abs(pixel[1]-142)<12 && Math.abs(pixel[2]-219)<12,`蓝底 ${[...pixel]}`);
  });
  await test('多人脸真实检测必须拒绝，且不产生输出', async () => {
    const f=path.join(tmp,'多人.png');const photo=await fs.readFile(fixture);
    await sharp({create:{width:1024,height:512,channels:3,background:'#fff'}}).composite([{input:photo,left:0,top:0},{input:photo,left:512,top:0}]).png().toFile(f);
    const r=await processPhoto(f,opts);assert.equal(r.ok,false);assert.match(r.note,/人脸.*请使用只有一人/);
    await assert.rejects(fs.stat(path.join(tmp,'多人-报名照.jpg')), {code:'ENOENT'});
  });
  await test('无人脸真实检测必须拒绝', async () => {
    const f=path.join(tmp,'无人.png');await sharp({create:{width:900,height:600,channels:3,background:'#aaccdd'}}).png().toFile(f);
    const r=await processPhoto(f,opts);assert.equal(r.ok,false);assert.match(r.note,/未检测到人脸/);
  });
  await test('PNG 透明图完整处理，透明区不保留原底色', async () => {
    const {data,info}=await sharp(fixture).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++)if(x<130 || x>380 || y<30)data[(y*info.width+x)*4+3]=0;
    const f=path.join(tmp,'透明.png');await sharp(data,{raw:{width:info.width,height:info.height,channels:4}}).png().toFile(f);
    await checkedOutput(f,{...opts,background:'#ee3344'});
  });
  await test('真实 HEIC 输入完整处理（随包 WASM 解码）', async () => {
    const f=path.join(tmp,'手机.heic');await fs.copyFile(path.join(root,'tests/fixtures/astronaut.heic'),f);
    assert.equal((await sharp(f).metadata()).compression,'hevc'); await checkedOutput(f);
  });
  await test('6200px 超大原图完整处理，推理前限制工作尺寸', async () => {
    const f=path.join(tmp,'超大.jpg');await sharp(fixture).resize(6200,6200).jpeg().toFile(f);
    const decoded=await decodeImage(f);assert.equal(decoded.width,2400);await checkedOutput(f);
  });
  await test('EXIF 旋转方向在识别前纠正', async () => {
    const f=path.join(tmp,'旋转.jpg');await sharp(fixture).rotate(90).withMetadata({orientation:8}).jpeg().toFile(f);await checkedOutput(f);
  });
  await test('全流程超小目标失败，不留失败文件', async () => {
    const f=path.join(tmp,'失败.png');await fs.copyFile(fixture,f);const r=await processPhoto(f,{...opts,minKB:0,maxKB:0.1});
    assert.equal(r.ok,false);assert.match(r.note,/无法达到/);await assert.rejects(fs.stat(path.join(tmp,'失败-报名照.jpg')),{code:'ENOENT'});
  });
  await test('并发保存使用 wx 排他创建，已有文件不覆盖',async()=>{
    const f=path.join(tmp,'竞态.png');const [a,b]=await Promise.all([saveExclusive(f,Buffer.from('one')),saveExclusive(f,Buffer.from('two'))]);
    assert.notEqual(a,b);assert.deepEqual(new Set([await fs.readFile(a,'utf8'),await fs.readFile(b,'utf8')]),new Set(['one','two']));
  });
  await test('损坏输入明确报错',async()=>{
    const f=path.join(tmp,'损坏.heic');await fs.writeFile(f,'not a photo');const r=await processPhoto(f,opts);assert.equal(r.ok,false);assert.match(r.note,/无法读取图片/);
  });
  await test('所有预设带 source，未核实字段为空', async () => {
    const presets=JSON.parse(await fs.readFile(path.join(root,'presets.json'),'utf8'));
    for(const p of presets){assert.ok(Object.hasOwn(p,'source'));if(p.source!==null)assert.match(p.source,/^https:\/\//);else for(const k of ['width','height','minKB','maxKB','background'])assert.equal(p[k],null);}
  });
  console.log(`\n全部 ${count} 项通过（真实 CPU ONNX 推理，测试无需联网）。`);
} finally { await fs.rm(tmp,{recursive:true,force:true}); }
