const { app, BrowserWindow, ipcMain, dialog, shell, session } = require('electron');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const presets = require('../presets.json');
let busy = false;
const outputs = new Set();
const workers = new Set();
function run(task, file, options, onProgress) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'worker.js'), { workerData: { task, file, options, modelDirectory: app.isPackaged ? path.join(process.resourcesPath, 'models') : path.join(__dirname, '../vendor/models') } });
    workers.add(worker);
    worker.on('message', message => {
      if (message.stage) onProgress?.(message.stage);
      else if ('result' in message) resolve(message.result);
      else if (message.error) reject(new Error(message.error));
    });
    worker.on('error', reject);
    worker.on('exit', code => { workers.delete(worker); if (code !== 0) reject(new Error('本地处理进程异常退出')); });
  });
}
function createWindow() {
  const win = new BrowserWindow({ width: 940, height: 840, minWidth: 760, minHeight: 680,
    titleBarStyle: 'hiddenInset', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.loadFile(path.join(__dirname, 'index.html'));
}
ipcMain.handle('pick', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: '人像照片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'tif', 'tiff'] }] });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle('presets', () => presets);
ipcMain.handle('preview', (_, file) => run('preview', file));
ipcMain.handle('process', async (event, { file, options }) => {
  if (busy) return { ok: false, note: '已有照片正在处理，请稍候' };
  busy = true;
  try {
    const result = await run('process', file, options, stage => { if (!event.sender.isDestroyed()) event.sender.send('progress', stage); });
    if (result.ok) outputs.add(result.output);
    return result;
  } catch (error) { return { ok: false, note: error.message }; }
  finally { busy = false; }
});
ipcMain.handle('reveal', (_, file) => { if (outputs.has(file)) shell.showItemInFolder(file); });
app.whenReady().then(() => {
  // 无联网功能：即使误加远程资源也会被 session 阻止。
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_, cb) => cb({ cancel: true }));
  session.defaultSession.setPermissionRequestHandler((_, __, cb) => cb(false));
  createWindow();
});
app.on('before-quit', () => { for (const worker of workers) worker.terminate(); });
app.on('window-all-closed', () => app.quit());
