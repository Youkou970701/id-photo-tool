// 真正打开主进程与 preload，执行真实推理并截图；只处理公有领域测试夹具。
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
let tmp;
require('../src/main');
app.whenReady().then(async () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win.webContents.isLoading()) await new Promise(resolve => win.webContents.once('did-finish-load', resolve));
  const js = source => win.webContents.executeJavaScript(source, true);
  win.webContents.on('console-message', (_, details) => { if(details.level==='error') console.error(details.message); });
  tmp=await fs.mkdtemp(path.join(os.tmpdir(),'idphoto-ui-'));
  const photo=path.join(tmp,'NASA-公开测试图.png');
  await fs.copyFile(path.join(__dirname,'../tests/fixtures/astronaut.png'),photo);
  await js(`choose(${JSON.stringify(photo)})`);
  await js(`document.getElementById('preset').value='2';document.getElementById('preset').dispatchEvent(new Event('change'))`);
  if(await js(`document.getElementById('background').value`) !== '')throw new Error('未知底色必须留空');
  await js(`document.getElementById('process').click()`);
  if(await js(`document.getElementById('status').className`) !== 'bad')throw new Error('缺规格应拒绝处理');
  await js(`document.getElementById('preset').value='0';document.getElementById('preset').dispatchEvent(new Event('change'));document.getElementById('process').click()`);
  const start=Date.now();
  while(await js('busy')) {
    if(Date.now()-start>120000)throw new Error('UI 处理超时');
    await new Promise(r=>setTimeout(r,100));
  }
  const result=await js(`({status:document.getElementById('status').textContent,type:document.getElementById('status').className,output:output})`);
  if(result.type!=='ok')throw new Error(result.status);
  const {width,height}=await require('sharp')(result.output).metadata();
  if(width!==178||height!==220)throw new Error('界面输出尺寸错误');
  console.log('Electron UI smoke passed:',result.status);
  await fs.mkdir(path.join(__dirname,'../docs'),{recursive:true});
  await fs.writeFile(path.join(__dirname,'../docs/screenshot.png'),(await win.webContents.capturePage()).toPNG());
  await fs.rm(tmp,{recursive:true,force:true});app.quit();
}).catch(async e=>{console.error(e);if(tmp)await fs.rm(tmp,{recursive:true,force:true});app.exit(1);});
