// Bezpieczny most między interfejsem a procesem głównym.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

async function call(ch, ...args) {
  const r = await ipcRenderer.invoke(ch, ...args);
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

function listen(ch) {
  return (fn) => {
    const h = (_e, payload) => fn(payload);
    ipcRenderer.on(ch, h);
    return () => ipcRenderer.removeListener(ch, h);
  };
}

contextBridge.exposeInMainWorld('jm', {
  platform: process.platform,
  load: () => call('app:load'),
  save: (name, data) => call('store:save', name, data),
  relaunch: () => call('app:relaunch'),
  yt: {
    config: (c) => call('yt:config', c),
    status: () => call('yt:status'),
    install: () => call('yt:install'),
    onInstallProgress: listen('yt:install-progress'),
    installFfmpeg: () => call('ffmpeg:install'),
    removeFfmpeg: () => call('ffmpeg:remove'),
    onFfmpegProgress: listen('ffmpeg:progress'),
    search: (q, n) => call('yt:search', q, n),
    fromUrl: (url) => call('yt:url', url),
    stream: (id, fresh) => call('yt:stream', id, fresh),
    resolve: (t) => call('yt:resolve', t),
    cache: (id) => call('yt:cache', id),
  },
  cache: { info: () => call('cache:info'), clear: () => call('cache:clear') },
  spotify: { fetch: (url, creds) => call('sp:fetch', url, creds) },
  dl: {
    start: (job) => call('dl:start', job),
    cancel: (id) => call('dl:cancel', id),
    exists: (paths) => call('dl:exists', paths),
    remove: (p) => call('dl:delete', p),
    onProgress: listen('dl:progress'),
  },
  lib: {
    get: () => call('lib:get'),
    scan: (folders) => call('lib:scan', folders),
    addFiles: (paths) => call('lib:addFiles', paths),
    remove: (p) => call('lib:remove', p),
    onProgress: listen('lib:progress'),
  },
  dialog: {
    folder: (title) => call('dialog:folder', title),
    audioFiles: () => call('dialog:audioFiles'),
  },
  m3u: {
    export: (name, tracks) => call('m3u:export', name, tracks),
    import: () => call('m3u:import'),
  },
  plugins: {
    list: () => call('plugins:list'),
    openFolder: () => call('plugins:openFolder'),
    catalog: () => call('store:catalog'),
    install: (id) => call('store:install', id),
    uninstall: (id) => call('store:uninstall', id),
  },
  window: {
    minimize: () => call('win:minimize'),
    toggleMaximize: () => call('win:toggleMaximize'),
    close: () => call('win:close'),
    state: () => call('win:state'),
    onState: listen('win:state'),
  },
  system: {
    nowPlaying: (info) => call('sys:nowPlaying', info),
    progress: (ratio, mode) => call('sys:progress', ratio, mode),
    shortcutStatus: () => call('sys:shortcutStatus'),
    installShortcut: (opts) => call('sys:installShortcut', opts),
    removeShortcut: () => call('sys:removeShortcut'),
    getAutostart: () => call('sys:getAutostart'),
    setAutostart: (enabled, hidden) => call('sys:setAutostart', enabled, hidden),
    idle: () => call('sys:idle'),
    globalRegister: (acc, id) => call('sys:globalRegister', acc, id),
    globalUnregister: (acc) => call('sys:globalUnregister', acc),
    globalClear: () => call('sys:globalClear'),
    onCommand: listen('player:cmd'),
  },
  discord: {
    connect: (id) => call('discord:connect', id),
    disconnect: () => call('discord:disconnect'),
    activity: (a) => call('discord:activity', a),
    status: () => call('discord:status'),
    voice: (opts) => call('discord:voice', opts),
    forget: () => call('discord:forget'),
    onEvent: listen('discord:event'),
  },
  voicemon: {
    start: (o) => call('voicemon:start', o),
    stop: () => call('voicemon:stop'),
    configure: (o) => call('voicemon:configure', o),
    status: () => call('voicemon:status'),
    onEvent: listen('voicemon:event'),
  },
  feedback: { save: (text) => call('feedback:save', text), send: (msg) => call('feedback:send', msg) },
  update: {
    state: () => call('update:state'),
    check: () => call('update:check'),
    download: () => call('update:download'),
    install: () => call('update:install'),
    onStatus: listen('update:status'),
  },
  http: { get: (url, type) => call('http:get', url, type) },
  shell: {
    open: (p) => call('shell:open', p),
    show: (p) => call('shell:show', p),
    external: (url) => call('shell:external', url),
  },
  win: { overlay: (c) => call('win:overlay', c) },
  widgets: {
    caps: () => call('widgets:caps'),
    open: (pluginId, wid, opts) => call('widgets:open', pluginId, wid, opts),
    update: (key, opts) => call('widgets:update', key, opts),
    post: (key, msg) => call('widgets:post', key, msg),
    close: (key) => call('widgets:close', key),
    closeAll: (pluginId) => call('widgets:closeAll', pluginId),
    onEvent: listen('widgets:event'),
  },
  pathOf: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return null;
    }
  },
});
