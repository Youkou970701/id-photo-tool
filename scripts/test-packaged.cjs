// 用 Electron 运行，验证安装包内 app.asar 的工作线程、原生库、WASM 与 extraResources。
const { app } = require('electron');
const { Worker } = require('node:worker_threads');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const bundle = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '../dist/mac-arm64/报名照助手.app/Contents/Resources');
let tmp;
app.whenReady().then(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'idphoto-package-'));
  for (const extension of ['png','heic']) {
    const file = path.join(tmp,`打包测试.${extension}`);
    await fs.copyFile(path.join(__dirname,`../tests/fixtures/astronaut.${extension}`),file);
    const result = await new Promise((resolve,reject) => {
      const worker = new Worker(path.join(bundle,'app.asar/src/worker.js'),{workerData:{task:'process',file,options:{width:178,height:220,minKB:2,maxKB:20,background:'#ffffff'},modelDirectory:path.join(bundle,'models')}});
      worker.on('error',reject);
      worker.on('message',m=>{if(m.error)reject(new Error(m.error));else if(m.result)resolve(m.result)});
      worker.on('exit',code=>{if(code!==0)reject(new Error('worker exit '+code))});
    });
    assert.equal(result.ok,true,result.note);
    const meta=await sharp(result.output).metadata();assert.equal(meta.width,178);assert.equal(meta.height,220);
    assert.ok(result.bytes>=2048 && result.bytes<=20480);
    console.log(`✓ packaged app.asar worker + ${extension} (${result.bytes} bytes)`);
  }
  await fs.rm(tmp,{recursive:true,force:true});app.quit();
}).catch(async e=>{console.error(e);if(tmp)await fs.rm(tmp,{recursive:true,force:true});app.exit(1)});
