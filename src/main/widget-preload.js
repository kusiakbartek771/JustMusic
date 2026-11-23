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
  /** Windows/macOS: przesuwanie okna przez aplikację zamiast -webkit-app-region (ten na Windowsie
   *  potrafi przykryć przyciski i wtedy zamiast kliknięcia okno się przesuwa) */
  manualDrag: process.platform === 'win32' || process.platform === 'darwin',
  dragStart: () => ipcRenderer.send('widget:drag', true),
  dragEnd: (why) => ipcRenderer.send('widget:drag', false, why),
  /** pokazuje główne okno JustMusic */
  focusApp: () => ipcRenderer.send('widget:focusApp'),
});
