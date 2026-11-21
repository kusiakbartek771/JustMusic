// Most dla okna mini odtwarzacza.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mini', {
  onState: (fn) => ipcRenderer.on('mini:state', (_e, s) => fn(s)),
  cmd: (cmd, arg) => ipcRenderer.send('mini:cmd', cmd, arg),
  ready: () => ipcRenderer.send('mini:ready'),
});
