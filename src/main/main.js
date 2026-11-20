// JustMusic – proces główny Electron.
const { app, BrowserWindow, ipcMain, protocol, net, session, dialog, shell, Menu } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');

const store = require('./store');
const yt = require('./ytdlp');
const spotify = require('./spotify');
const library = require('./library');
const plugins = require('./plugins');
const system = require('./system');
const discord = require('./discord');
const updater = require('./updater');
const voicemon = require('./voicemonitor');
const PKG = require('../../package.json');

const RENDERER = path.join(__dirname, '..', 'renderer');
const isMac = process.platform === 'darwin';
const DEV = process.argv.includes('--dev');

protocol.registerSchemesAsPrivileged([
  { scheme: 'jm', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

// Wydajność: mniej zbędnych procesów/usług przeglądarki
app.commandLine.appendSwitch('disable-features', 'SpareRendererForSitePerProcess,Translate');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Linux/Wayland: skróty globalne przez portal XDG (KDE, GNOME 48+)
if (process.platform === 'linux') app.commandLine.appendSwitch('enable-features', 'GlobalShortcutsPortal');

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let win = null;
let appSettings = {};
if (process.platform === 'win32') app.setAppUserModelId('app.justmusic.player');

const STATIC_MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.gif': 'image/gif',
};

function notFound() {
  return new Response('Not found', { status: 404 });
}

async function serveStatic(file, base) {
  const resolved = path.resolve(file);
  if (!resolved.startsWith(path.resolve(base) + path.sep)) return notFound();
  try {
    const data = await fs.promises.readFile(resolved);
    return new Response(data, {
      headers: { 'Content-Type': STATIC_MIME[path.extname(resolved).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' },
    });
  } catch {
    return notFound();
  }
}

// Strumieniowanie pliku audio z obsługą Range (przewijanie).
async function serveMedia(file, req) {
  if (!file) return notFound();
  const ext = path.extname(file).toLowerCase();
  if (!library.EXT.has(ext)) return new Response('Forbidden', { status: 403 });
  let st;
  try {
    st = await fs.promises.stat(file);
  } catch {
    return notFound();
  }
  const size = st.size;
  const type = library.MIME[ext] || 'application/octet-stream';
  const range = req.headers.get('range');
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? Number(m[1]) : 0;
    let end = m && m[2] ? Number(m[2]) : size - 1;
    if (m && !m[1] && m[2]) {
      start = Math.max(0, size - Number(m[2]));
      end = size - 1;
    }
    end = Math.min(end, size - 1);
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    }
    return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), {
      status: 206,
      headers: {
        'Content-Type': type,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes',
      },
    });
  }
  return new Response(Readable.toWeb(fs.createReadStream(file)), {
    status: 200,
    headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' },
  });
}

function registerProtocol() {
  protocol.handle('jm', async (req) => {
    const u = new URL(req.url);
    if (u.host !== 'app') return notFound();
    const p = decodeURIComponent(u.pathname);
    if (p === '/media') return serveMedia(u.searchParams.get('p'), req);
    if (p === '/yt') {
      try {
        return await yt.proxyStream(u.searchParams.get('id'), req);
      } catch (e) {
        console.error('[yt proxy]', e.message);
        return new Response(e.message, { status: 502 });
      }
    }
    if (p === '/cover') {
      const c = await library.cover(u.searchParams.get('p'));
      if (!c) return notFound();
      return new Response(c.data, { headers: { 'Content-Type': c.type, 'Cache-Control': 'max-age=86400' } });
    }
    if (p.startsWith('/plugins/')) {
      const [, , id, ...rest] = p.split('/');
      const dir = plugins.dirOf(id);
      if (!dir) return notFound();
      return serveStatic(path.join(dir, ...rest), dir);
    }
    return serveStatic(path.join(RENDERER, p === '/' ? 'index.html' : p), RENDERER);
  });
}

// Dodaje nagłówki CORS do strumieni YouTube i okładek – potrzebne dla
// korektora (Web Audio), wizualizera i dynamicznego koloru z okładki.
function setupSession() {
  const s = session.defaultSession;
  const ua = s.getUserAgent().replace(/\s?Electron\/\S+/, '').replace(/\s?justmusic\/\S+/i, '').replace(/\s?JustMusic\/\S+/, '');
  s.setUserAgent(ua);
  s.webRequest.onHeadersReceived(
    { urls: ['*://*.googlevideo.com/*', '*://*.ytimg.com/*', '*://i.scdn.co/*', '*://*.ggpht.com/*', '*://*.googleusercontent.com/*', '*://image-cdn-ak.spotifycdn.com/*', '*://*.spotifycdn.com/*'] },
    (d, cb) => {
      const h = d.responseHeaders || {};
      for (const k of Object.keys(h)) if (k.toLowerCase() === 'access-control-allow-origin') delete h[k];
      h['Access-Control-Allow-Origin'] = ['*'];
      cb({ responseHeaders: h });
    }
  );
  s.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'fullscreen' || perm === 'clipboard-sanitized-write' || perm === 'media'));
}

function windowButtons(settings) {
  const wb = settings.layout?.windowButtons || (settings.layout?.nativeFrame ? 'system' : 'app');
  return wb;
}

function createWindow() {
  const settings = appSettings;
  const bounds = store.load('window', {}) || {};
  const wb = windowButtons(settings);
  const native = wb === 'system';
  const bg = settings.theme?.vars?.bg || '#0d0e12';
  const startHidden = process.argv.includes('--hidden') && settings.system?.tray !== false;

  win = new BrowserWindow({
    width: bounds.width || 1360,
    height: bounds.height || 860,
    x: bounds.x,
    y: bounds.y,
    minWidth: 860,
    minHeight: 560,
    show: false,
    title: 'JustMusic',
    backgroundColor: bg,
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    // przyciski okna rysowane przez aplikację (w jej stylu) albo systemowe
    ...(native
      ? (isMac ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 16 } } : {})
      : isMac
        ? { titleBarStyle: 'hidden' }
        : { frame: false }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  if (isMac && !native) win.setWindowButtonVisibility(false);
  if (bounds.maximized) win.maximize();
  if (!DEV) Menu.setApplicationMenu(isMac ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null);

  win.loadURL('jm://app/index.html');
  win.once('ready-to-show', () => { if (!startHidden) win.show(); });

  const sendState = () => send('win:state', { maximized: win.isMaximized(), fullscreen: win.isFullScreen(), focused: win.isFocused() });
  for (const ev of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'focus', 'blur']) win.on(ev, sendState);

  // zamykanie do zasobnika
  win.on('close', (e) => {
    if (!app.isQuitting && appSettings.system?.closeToTray && system.hasTray()) {
      e.preventDefault();
      win.hide();
    }
  });

  // Diagnostyka: JM_DEBUG=1 wypisuje konsolę interfejsu, JM_SCREENSHOT=plik.png robi zrzut i zamyka
  if (process.env.JM_DEBUG || process.env.JM_SCREENSHOT) {
    win.webContents.on('console-message', (e) => console.log(`[renderer:${e.level}] ${e.message} (${e.sourceId}:${e.lineNumber})`));
  }
  if (process.env.JM_SCREENSHOT) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        if (process.env.JM_EVAL) await win.webContents.executeJavaScript(process.env.JM_EVAL).catch((e) => console.log('eval error', e));
        setTimeout(async () => {
          const img = await win.webContents.capturePage();
          fs.writeFileSync(process.env.JM_SCREENSHOT, img.toPNG());
          app.exit(0);
        }, Number(process.env.JM_DELAY || 1500));
      }, 1500);
    });
  }
  if (DEV) win.webContents.openDevTools({ mode: 'detach' });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('jm://app/')) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });

  const saveBounds = () => {
    if (!win || win.isDestroyed()) return;
    store.saveSync('window', { ...win.getNormalBounds(), maximized: win.isMaximized() });
  };
  win.on('close', saveBounds);
  win.on('hide', saveBounds);
  win.on('closed', () => (win = null));
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// ---------------- IPC ----------------
function handle(ch, fn) {
  ipcMain.handle(ch, async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });
}

function setupIpc() {
  handle('app:load', () => {
    const settings = store.load('settings', null);
    const data = store.load('data', null);
    return {
      settings,
      data,
      paths: {
        music: path.join(app.getPath('music'), 'JustMusic'),
        userData: app.getPath('userData'),
        plugins: plugins.userDir(),
      },
      version: app.getVersion(),
      platform: process.platform,
      packaged: app.isPackaged,
      config: PKG.justmusic || {},
      sys: { os: `${os.type()} ${os.release()} (${os.arch()})`, electron: process.versions.electron, chrome: process.versions.chrome, desktop: process.env.XDG_CURRENT_DESKTOP || '', session: process.env.XDG_SESSION_TYPE || '' },
    };
  });
  handle('store:save', (name, data) => {
    if (!['settings', 'data'].includes(name)) throw new Error('bad store');
    if (name === 'settings') {
      yt.setConfig({ ...(data.youtube || {}) });
      const trayWas = appSettings.system?.tray !== false;
      appSettings = data;
      const trayNow = data.system?.tray !== false;
      if (trayWas !== trayNow) system.setTray(trayNow);
    }
    return store.save(name, data);
  });

  handle('yt:config', (c) => yt.setConfig(c));
  handle('yt:status', () => yt.detect());
  handle('yt:install', () => yt.install((p) => send('yt:install-progress', p)));
  handle('yt:search', (q, n) => yt.search(q, n));
  handle('yt:url', (url) => yt.fromUrl(url));
  handle('yt:stream', (id, fresh) => yt.stream(id, fresh));
  handle('yt:resolve', (t) => yt.resolve(t));
  handle('yt:cache', (id) => yt.cache(id));
  handle('cache:info', () => yt.cacheInfo());
  handle('cache:clear', () => yt.cacheClear());

  handle('sp:fetch', (url, creds) => spotify.fetchSpotify(url, creds));

  handle('dl:start', (job) => yt.download(job, (p) => send('dl:progress', p)));
  handle('dl:cancel', (id) => yt.cancel(id));
  handle('dl:exists', (paths) => paths.map((p) => fs.existsSync(p)));
  handle('dl:delete', async (p) => {
    await shell.trashItem(p).catch(() => fs.promises.unlink(p));
  });

  handle('lib:get', () => library.tracks());
  handle('lib:scan', (folders) => library.scan(folders, (p) => send('lib:progress', p)));
  handle('lib:addFiles', (paths) => library.addFiles(paths));
  handle('lib:remove', (p) => library.removeFile(p));
  handle('dialog:folder', async (title) => {
    const r = await dialog.showOpenDialog(win, { title: title || 'Wybierz folder', properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  handle('dialog:audioFiles', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Dodaj pliki audio',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Audio', extensions: [...library.EXT].map((e) => e.slice(1)) }],
    });
    return r.canceled ? [] : r.filePaths;
  });

  handle('m3u:export', async (name, tracks) => {
    const r = await dialog.showSaveDialog(win, { title: 'Eksportuj playlistę', defaultPath: yt.sanitize(name) + '.m3u8', filters: [{ name: 'M3U', extensions: ['m3u8', 'm3u'] }] });
    if (r.canceled) return false;
    const lines = ['#EXTM3U', `#PLAYLIST:${name}`];
    for (const t of tracks) {
      lines.push(`#EXTINF:${t.duration || -1},${t.artist ? t.artist + ' - ' : ''}${t.title}`);
      lines.push(t.path || t.url);
    }
    await fs.promises.writeFile(r.filePath, lines.join('\n'), 'utf8');
    return r.filePath;
  });
  handle('m3u:import', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Importuj playlistę M3U', properties: ['openFile'], filters: [{ name: 'M3U', extensions: ['m3u', 'm3u8'] }] });
    if (r.canceled) return null;
    const file = r.filePaths[0];
    const text = await fs.promises.readFile(file, 'utf8');
    const dir = path.dirname(file);
    const entries = [];
    let info = null;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('#EXTINF:')) {
        info = line.slice(line.indexOf(',') + 1);
        continue;
      }
      if (line.startsWith('#')) continue;
      entries.push({ ref: /^https?:/.test(line) ? line : path.resolve(dir, line), info });
      info = null;
    }
    const localPaths = entries.filter((e) => !/^https?:/.test(e.ref)).map((e) => e.ref);
    const local = await library.addFiles(localPaths);
    return { name: path.basename(file).replace(/\.m3u8?$/i, ''), local, urls: entries.filter((e) => /^https?:/.test(e.ref)) };
  });

  handle('plugins:list', () => plugins.list());
  handle('plugins:openFolder', () => shell.openPath(plugins.userDir()));
  handle('store:catalog', () => plugins.catalog(appSettings.plugins?.catalogUrl || PKG.justmusic?.pluginCatalogUrl));
  handle('store:install', (id) => plugins.install(id, appSettings.plugins?.catalogUrl || PKG.justmusic?.pluginCatalogUrl));
  handle('store:uninstall', (id) => plugins.uninstall(id));

  // ---- okno (własne przyciski) ----
  handle('win:minimize', () => win?.minimize());
  handle('win:toggleMaximize', () => { if (!win) return; if (win.isMaximized()) win.unmaximize(); else win.maximize(); });
  handle('win:close', () => win?.close());
  handle('win:state', () => (win ? { maximized: win.isMaximized(), fullscreen: win.isFullScreen(), focused: win.isFocused() } : {}));

  // ---- system ----
  handle('sys:nowPlaying', (info) => system.nowPlaying(info));
  handle('sys:progress', (ratio, mode) => system.progress(ratio, mode));
  handle('sys:shortcutStatus', () => system.shortcutStatus());
  handle('sys:installShortcut', (opts) => system.installShortcut(opts));
  handle('sys:removeShortcut', () => system.removeShortcut());
  handle('sys:getAutostart', () => system.getAutostart());
  handle('sys:setAutostart', (enabled, hidden) => system.setAutostart(enabled, hidden));
  handle('sys:idle', () => system.idleSeconds());
  handle('sys:globalRegister', (acc, id) => system.registerGlobal(acc, id));
  handle('sys:globalUnregister', (acc) => system.unregisterGlobal(acc));
  handle('sys:globalClear', () => system.unregisterAllGlobals());

  // ---- Discord ----
  handle('discord:connect', (id) => discord.connect(id));
  handle('discord:disconnect', () => discord.disconnect(true));
  handle('discord:activity', (a) => (a ? discord.setActivity(a) : discord.clearActivity()));
  handle('discord:status', () => discord.status());
  handle('discord:voice', (opts) => discord.configureVoice(opts));
  handle('discord:forget', () => discord.forgetToken());
  handle('voicemon:start', (o) => voicemon.start(o));
  handle('voicemon:stop', () => voicemon.stop());
  handle('voicemon:configure', (o) => voicemon.configure(o));
  handle('voicemon:status', () => voicemon.status());

  // ---- aktualizacje ----
  handle('update:state', () => updater.getState());
  handle('update:check', () => updater.check());
  handle('update:download', () => updater.download());
  handle('update:install', () => updater.install());

  // ---- feedback ----
  handle('feedback:save', async (text) => {
    const dir = path.join(app.getPath('userData'), 'feedback');
    await fs.promises.mkdir(dir, { recursive: true });
    const file = path.join(dir, `feedback-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`);
    await fs.promises.writeFile(file, text, 'utf8');
    return file;
  });

  handle('http:get', async (url, type) => {
    if (!/^https:\/\//.test(url)) throw new Error('Tylko HTTPS');
    const res = await net.fetch(url, { headers: { 'User-Agent': 'JustMusic/' + app.getVersion() + ' (https://github.com/justmusic)' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return type === 'json' ? res.json() : res.text();
  });

  handle('shell:open', (p) => shell.openPath(p));
  handle('shell:show', (p) => shell.showItemInFolder(p));
  handle('shell:external', (url) => {
    if (/^(https?:\/\/|mailto:)/.test(url)) return shell.openExternal(url);
  });

  handle('win:overlay', () => {});
  handle('app:relaunch', () => {
    app.relaunch();
    app.exit(0);
  });
}

app.whenReady().then(async () => {
  appSettings = store.load('settings', {}) || {};
  yt.setConfig(appSettings.youtube || {});
  registerProtocol();
  setupSession();
  setupIpc();
  system.init({ windowGetter: () => win, onCommand: (cmd, arg) => send('player:cmd', { cmd, arg }) });
  discord.setEmitter((type, payload) => send('discord:event', { type, payload }));
  voicemon.setEmitter((type, payload) => send('voicemon:event', { type, payload }));
  updater.init((st) => send('update:status', { ...st, current: app.getVersion() }), () => appSettings);
  createWindow();
  if (appSettings.system?.tray !== false) system.setTray(true);
  yt.detect().catch(() => {});

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else system.toggleWindow(true);
  });
});

app.on('second-instance', () => system.toggleWindow(true));
app.on('before-quit', () => { app.isQuitting = true; });
app.on('will-quit', () => {
  system.unregisterAllGlobals();
  discord.disconnect(true);
  voicemon.stop();
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
