import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mock } from 'node:test';
const require = createRequire(import.meta.url);
const sharp = require('sharp');
const { validateOptions, decodeImage, cropForFace, validateCrop, encodeWithinRange, processPhoto, saveExclusive } = require('../src/photo');
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
async function checkedFailure(file, message, options = opts) {
  const before = await fs.readFile(file), files = (await fs.readdir(tmp)).sort();
  const result = await processPhoto(file, options);
  assert.equal(result.ok, false); assert.equal(result.output, undefined);
  assert.match(result.note, message);
  assert.deepEqual((await fs.readdir(tmp)).sort(), files, '失败不得产生文件');
  assert.deepEqual(await fs.readFile(file), before, '失败不得改动原图');
  return result;
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
  await test('正常人像完整头顶仍然通过，且无放大提醒', async () => {
    const file=path.join(tmp,'正常头顶.png');await fs.copyFile(fixture,file);
    const r=await checkedOutput(file);assert.doesNotMatch(r.note,/原图偏小/);
  });
  await test('脸部特写少量上溢仍然通过（不得误拒绝）', async () => {
    const file=path.join(tmp,'脸部特写.png');
    await sharp(fixture).extract({left:135,top:27,width:180,height:260}).png().toFile(file);
    const im=await decodeImage(file), faces=await detectFaces(im), crop=cropForFace(faces[0],opts.width,opts.height);
    const overflow=-crop.top/crop.height;
    assert.ok(overflow>0.09 && overflow<0.12,`特写上溢比例 ${overflow}`);
    await checkedOutput(file);
  });
  await test('额头被截断拒绝，失败不生成文件', async () => {
    const file=path.join(tmp,'额头被切.png');
    await sharp(fixture).extract({left:110,top:90,width:290,height:420}).png().toFile(file);
    await checkedFailure(file,/^照片头顶不完整，请使用头顶上方有留白的照片$/);
  });
  await test('下溢超过 5% 拒绝，不能补出悬空肩膀', async () => {
    const file=path.join(tmp,'缺肩部.png');
    await sharp(fixture).extract({left:100,top:0,width:300,height:210}).png().toFile(file);
    await checkedFailure(file,/^照片下方需包含肩部$/);
  });
  await test('侧边溢出超过 15% 拒绝', async () => {
    const file=path.join(tmp,'靠边.png');
    await sharp(fixture).extract({left:200,top:0,width:250,height:512}).png().toFile(file);
    await checkedFailure(file,/^人脸太靠近照片边缘$/);
  });
  await test('裁剪上溢 12%、下溢 5%、左右各 15% 为包含边界', async () => {
    const im={width:200,height:200}, base={left:50,top:50,width:100,height:100};
    for(const [crop,error] of [
      [{...base,top:-12},/头顶不完整/], [{...base,top:105},/包含肩部/],
      [{...base,left:-15},/靠近照片边缘/], [{...base,left:115},/靠近照片边缘/],
    ]) {
      assert.doesNotThrow(()=>validateCrop(im,crop,100));
      const beyond={...crop};
      if(crop.top!==base.top)beyond.top+=crop.top<0?-0.01:0.01;
      else beyond.left+=crop.left<0?-0.01:0.01;
      assert.throws(()=>validateCrop(im,beyond,100),error);
    }
  });
  await test('90px 原图分辨率不足必须失败', async () => {
    const file=path.join(tmp,'低清90.png');await sharp(fixture).resize(90).png().toFile(file);
    await checkedFailure(file,/^原图分辨率不足（人脸区域约 \d+ 像素高，要求 220 像素），请换更清晰的原图$/);
  });
  await test('240px 原图配 150px 目标进入 1.2～1.5 倍提醒分支', async () => {
    const file=path.join(tmp,'偏小240.png');await sharp(fixture).resize(240).png().toFile(file);
    const r=await checkedOutput(file,{...opts,width:121,height:150});
    assert.match(r.note,/原图偏小，已放大 1\.[234]\d 倍，请放大检查清晰度/);
  });
  await test('240px 原图配默认 220px 目标超过 1.5 倍仍须拒绝', async () => {
    const file=path.join(tmp,'默认目标240.png');await sharp(fixture).resize(240).png().toFile(file);
    await checkedFailure(file,/原图分辨率不足/);
  });
  await test('放大倍数恰好 1.5 可用，超过即拒绝', async () => {
    const im={width:200,height:200}, crop={left:50,top:50,width:100,height:100};
    assert.equal(validateCrop(im,crop,150),1.5);
    assert.throws(()=>validateCrop(im,crop,150.01),/原图分辨率不足/);
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
  await test('JPEG 元数据可读但像素解码失败，统一中文提示', async () => {
    const file=path.join(tmp,'截断.jpg'), jpeg=await sharp(fixture).jpeg().toBuffer();
    await fs.writeFile(file,jpeg.subarray(0,Math.floor(jpeg.length*0.6)));
    assert.equal((await sharp(file).metadata()).format,'jpeg','确保覆盖元数据之后的像素解码错误');
    await assert.rejects(decodeImage(file),{message:'无法读取图片，文件可能损坏或格式不受支持'});
    await checkedFailure(file,/^无法读取图片，文件可能损坏或格式不受支持$/);
  });
  await test('输出 EACCES/EPERM/EROFS 使用中文提示且不暴露路径', async () => {
    const file=path.join(tmp,'写权限.png');await fs.copyFile(fixture,file);
    for(const code of ['EACCES','EPERM','EROFS']) {
      const stub=mock.method(fs,'open',async()=>{throw Object.assign(new Error(`${code}: ${file}`),{code});});
      try {
        const r=await checkedFailure(file,/^无法写入原图所在文件夹，请把照片复制到桌面等可写位置再试$/);
        assert.ok(!r.note.includes(tmp));assert.ok(!r.note.includes(code));
      } finally { stub.mock.restore(); }
    }
  });
  await test('输出创建后写入被拒绝，清理半成品并隐藏路径', async () => {
    const originalOpen=fs.open;
    const stub=mock.method(fs,'open',async (...args)=>{
      const handle=await originalOpen(...args);
      handle.writeFile=async()=>{throw Object.assign(new Error(`EACCES: ${args[0]}`),{code:'EACCES'});};
      return handle;
    });
    try {
      await assert.rejects(saveExclusive(path.join(tmp,'半成品.png'),Buffer.from('image')),
        {message:'无法写入原图所在文件夹，请把照片复制到桌面等可写位置再试'});
      await assert.rejects(fs.stat(path.join(tmp,'半成品-报名照.jpg')),{code:'ENOENT'});
    } finally { stub.mock.restore(); }
  });
  await test('所有预设带 source，未核实字段为空', async () => {
    const presets=JSON.parse(await fs.readFile(path.join(root,'presets.json'),'utf8'));
    for(const p of presets){assert.ok(Object.hasOwn(p,'source'));if(p.source!==null)assert.match(p.source,/^https:\/\//);else for(const k of ['width','height','minKB','maxKB','background'])assert.equal(p[k],null);}
  });
  console.log(`\n全部 ${count} 项通过（真实 CPU ONNX 推理，测试无需联网）。`);
} finally { await fs.rm(tmp,{recursive:true,force:true}); }
