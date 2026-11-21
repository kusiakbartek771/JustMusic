// Most dla stron widżetów (okna na pulpicie) – tylko wymiana wiadomości z pluginem.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jmw', {
  /** wiadomości od pluginu */
  onMessage: (fn) => {
    const h = (_e, msg) => fn(msg);
    ipcRenderer.on('widget:msg', h);
    return () => ipcRenderer.removeListener('widget:msg', h);
  },
  /** wiadomość do pluginu (np. { cmd: 'toggle' }) */
  post: (msg) => ipcRenderer.send('widget:post', msg),
  /** dopasowanie okna do rozmiaru treści */
  resize: (w, h) => ipcRenderer.send('widget:resize', w, h),
  /** pokazuje główne okno JustMusic */
  focusApp: () => ipcRenderer.send('widget:focusApp'),
});
