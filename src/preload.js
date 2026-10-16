const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('api', {
  pathOf: (file) => webUtils.getPathForFile(file),
  pick: () => ipcRenderer.invoke('pick'),
  presets: () => ipcRenderer.invoke('presets'),
  preview: (file) => ipcRenderer.invoke('preview', file),
  process: (options) => ipcRenderer.invoke('process', options),
  reveal: (file) => ipcRenderer.invoke('reveal', file),
  onProgress: (callback) => {
    const listener = (_, stage) => callback(stage);
    ipcRenderer.on('progress', listener);
    return () => ipcRenderer.removeListener('progress', listener);
  },
});
