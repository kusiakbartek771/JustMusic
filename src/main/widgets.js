// Widżety na pulpicie dla pluginów: małe przezroczyste okna bez ramki, zawsze na wierzchu.
// Treść widżetu to strona z folderu pluginu (jm://app/plugins/<id>/...). Plugin rozmawia z nią
// przez proces główny: post() → widżet, wiadomości z widżetu → zdarzenie 'message'.
const { BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const kwin = require('./kwin');

const isMac = process.platform === 'darwin';
const wins = new Map(); // key -> { win, opts, caption, last, movedByUs, timer }
let emit = () => {};
let focusApp = () => {};
let pollTimer = null;
const useKwin = () => kwin.available();

function caps() {
  const wayland = process.platform === 'linux' && (process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY);
  const kde = useKwin();
  return {
    supported: true,
    onTop: !wayland || kde, // GNOME/inne kompozytory Waylanda nie pozwalają na „zawsze na wierzchu”
    position: !wayland || kde,
    backend: kde ? 'kwin' : wayland ? 'wayland' : process.platform,
    displays: screen.getAllDisplays().map((d, i) => ({
      id: String(d.id), index: i, primary: d.id === screen.getPrimaryDisplay().id,
      label: d.label || `Ekran ${i + 1}`, workArea: d.workArea, scale: d.scaleFactor,
    })),
  };
}

function display(id) {
  const all = screen.getAllDisplays();
  return all.find((d) => String(d.id) === String(id)) || screen.getPrimaryDisplay();
}

/** Pozycja okna z kotwicy (róg/krawędź ekranu + odstęp) albo z zapisanych x/y */
function computePos(o, w, h) {
  const d = display(o.display);
  const a = d.workArea;
  if (o.anchor === 'free' && Number.isFinite(o.x) && Number.isFinite(o.y)) {
    // nie pozwól, żeby widżet zniknął poza ekranem (np. po odłączeniu monitora)
    const hit = screen.getAllDisplays().some((s) => o.x + 40 > s.workArea.x && o.x < s.workArea.x + s.workArea.width - 40 && o.y >= s.workArea.y - 10 && o.y < s.workArea.y + s.workArea.height - 30);
    if (hit) return { x: Math.round(o.x), y: Math.round(o.y) };
  }
  const anchor = o.anchor && o.anchor !== 'free' ? o.anchor : 'bottom-right';
  const mx = Number.isFinite(o.marginX) ? o.marginX : 24;
  const my = Number.isFinite(o.marginY) ? o.marginY : 24;
  const [v, hz] = anchor === 'center' ? ['center', 'center'] : anchor.split('-');
  const hor = hz || 'center';
  const x = hor === 'left' ? a.x + mx : hor === 'right' ? a.x + a.width - w - mx : a.x + Math.round((a.width - w) / 2);
  const y = v === 'top' ? a.y + my : v === 'bottom' ? a.y + a.height - h - my : a.y + Math.round((a.height - h) / 2);
  return { x: Math.round(x), y: Math.round(y) };
}

function place(item) {
  const { win, opts } = item;
  if (win.isDestroyed()) return;
  const [w, h] = win.getSize();
  const pos = computePos(opts, w, h);
  item.last = pos;
  if (useKwin()) {
    item.movedByUs = Date.now();
    kwin.set(item.caption, { above: opts.onTop !== false, allDesktops: opts.allDesktops !== false, pos });
  } else {
    item.movedByUs = Date.now();
    win.setPosition(pos.x, pos.y);
  }
}

function applyFlags(item) {
  const { win, opts } = item;
  const top = opts.onTop !== false;
  win.setAlwaysOnTop(top, top ? (isMac ? 'floating' : 'screen-saver') : 'normal');
  try { win.setVisibleOnAllWorkspaces(opts.allDesktops !== false, { visibleOnFullScreen: true, skipTransformProcessType: true }); } catch {}
  win.setOpacity(Math.min(1, Math.max(0.15, Number(opts.opacity ?? 1))));
  setSoftHidden(item, opts.visible === false);
}

// Ukrywanie BEZ zamykania okna: zwijamy je do 1×1 px i przepuszczamy kliknięcia.
// Prawdziwe hide()/show() tworzy dla kompozytora nowe okno, a nowe okno dostaje fokus –
// gra na pełnym ekranie (np. Minecraft) traci go wtedy i sama się minimalizuje.
function setSoftHidden(item, hide) {
  const { win, opts } = item;
  if (hide) {
    win.setIgnoreMouseEvents(true, { forward: true });
    if (!item.soft) {
      item.soft = true;
      const [w, h] = win.getSize();
      if (!item.want) item.want = { w, h };
      item.movedByUs = Date.now();
      setWinSize(win, 1, 1);
    }
  } else {
    win.setIgnoreMouseEvents(!!opts.clickThrough, { forward: true });
    if (item.soft) {
      item.soft = false;
      item.movedByUs = Date.now();
      if (item.want) setWinSize(win, item.want.w, item.want.h);
      place(item);
    }
  }
}

function setWinSize(win, w, h) {
  win.setMinimumSize(1, 1);
  win.setResizable(true);
  win.setSize(w, h);
  win.setResizable(false);
}

function validPage(page) {
  const p = String(page || 'widget.html');
  if (p.includes('..') || p.startsWith('/') || p.includes('\\') || !/^[\w./-]+\.html$/.test(p)) throw new Error('Nieprawidłowa strona widżetu');
  return p;
}

function open(pluginId, wid, opts = {}) {
  const key = `${pluginId}/${wid}`;
  if (!/^[\w-]+\/[\w-]+$/.test(key)) throw new Error('Nieprawidłowy identyfikator widżetu');
  const page = validPage(opts.page);
  const existing = wins.get(key);
  if (existing && !existing.win.isDestroyed()) { update(key, opts); return key; }

  const width = Math.max(60, Math.min(1600, Math.round(opts.width || 320)));
  const height = Math.max(30, Math.min(1200, Math.round(opts.height || 100)));
  const caption = `JustMusic widget ${key}`;
  const item = { opts: { ...opts }, caption, last: null, movedByUs: 0, timer: null };
  const pos = computePos(item.opts, width, height);
  const win = new BrowserWindow({
    width, height, x: pos.x, y: pos.y,
    show: false, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
    focusable: false, // widżet nie może zabierać fokusu (gry na pełnym ekranie się wtedy minimalizują)
    resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
    skipTaskbar: true, title: caption, alwaysOnTop: opts.onTop !== false,
    ...(isMac ? { type: 'panel' } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'widget-preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, backgroundThrottling: false,
    },
  });
  item.win = win;
  item.last = pos;
  wins.set(key, item);
  win.on('page-title-updated', (e) => e.preventDefault()); // tytuł służy do rozpoznania okna przez KWin
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  applyFlags(item);
  if (useKwin()) kwin.set(caption, { above: opts.onTop !== false, allDesktops: opts.allDesktops !== false, pos });
  win.loadURL(`jm://app/plugins/${pluginId}/${page}?wid=${encodeURIComponent(wid)}`);
  // okno pokazujemy od razu (ukryte = zwinięte do 1×1) i już go nie zamykamy – patrz setSoftHidden()
  win.once('ready-to-show', () => { item.loaded = true; if (!win.isDestroyed()) win.showInactive(); });

  // przeciągnięcie przez użytkownika (Windows, macOS, X11) – na KDE/Wayland sprawdza to poll()
  const onMove = () => {
    if (Date.now() - item.movedByUs < 600) return;
    clearTimeout(item.timer);
    item.timer = setTimeout(() => {
      if (win.isDestroyed()) return;
      const [x, y] = win.getPosition();
      if (item.last && Math.abs(item.last.x - x) < 3 && Math.abs(item.last.y - y) < 3) return;
      item.last = { x, y };
      emit({ type: 'moved', key, x, y });
    }, 350);
  };
  win.on('moved', onMove);
  if (!isMac && process.platform !== 'win32') win.on('move', onMove);
  win.on('closed', () => {
    clearTimeout(item.timer);
    if (wins.get(key) === item) wins.delete(key);
    if (useKwin()) kwin.remove(caption);
    emit({ type: 'closed', key });
    schedulePoll();
  });
  schedulePoll();
  return key;
}

function update(key, opts = {}) {
  const item = wins.get(key);
  if (!item || item.win.isDestroyed()) return false;
  const prev = item.opts;
  item.opts = { ...prev, ...opts };
  applyFlags(item);
  const moved = ['anchor', 'marginX', 'marginY', 'display', 'x', 'y'].some((k) => k in opts && opts[k] !== prev[k]);
  if (moved) place(item);
  else if (useKwin() && (prev.onTop !== item.opts.onTop || prev.allDesktops !== item.opts.allDesktops)) {
    kwin.set(item.caption, { above: item.opts.onTop !== false, allDesktops: item.opts.allDesktops !== false });
  }
  return true;
}

/** widżet zgłasza rozmiar swojej treści – dopasowujemy okno (i trzymamy kotwicę) */
function resize(key, w, h) {
  const item = wins.get(key);
  if (!item || item.win.isDestroyed()) return;
  w = Math.max(40, Math.min(1600, Math.round(w)));
  h = Math.max(20, Math.min(1200, Math.round(h)));
  item.want = { w, h };
  if (item.soft) return; // zastosujemy przy pokazaniu
  const [cw, ch] = item.win.getSize();
  if (cw === w && ch === h) return;
  item.movedByUs = Date.now();
  setWinSize(item.win, w, h);
  if (item.opts.anchor !== 'free') place(item);
}

function post(key, msg) {
  const item = wins.get(key);
  if (item && !item.win.isDestroyed()) item.win.webContents.send('widget:msg', msg);
}

function close(key) {
  const item = wins.get(key);
  if (item && !item.win.isDestroyed()) item.win.destroy();
  wins.delete(key);
}

function closeAll(prefix) {
  for (const key of [...wins.keys()]) if (!prefix || key.startsWith(prefix + '/')) close(key);
  if (!prefix && useKwin()) kwin.clear();
}

// KDE/Wayland: aplikacja nie dostaje informacji o przesunięciu okna – pytamy KWin co kilka sekund
function schedulePoll() {
  clearInterval(pollTimer);
  pollTimer = null;
  if (!useKwin() || !wins.size) return;
  pollTimer = setInterval(async () => {
    for (const [key, item] of wins) {
      if (item.win.isDestroyed() || !item.win.isVisible() || item.soft) continue;
      const g = await kwin.geometry(item.caption);
      if (!g || !item.last || kwin.pending(item.caption)) continue;
      if (Date.now() - item.movedByUs < 1500) { item.last = { x: g.x, y: g.y }; continue; }
      if (Math.abs(item.last.x - g.x) < 3 && Math.abs(item.last.y - g.y) < 3) continue;
      item.last = { x: g.x, y: g.y };
      emit({ type: 'moved', key, x: g.x, y: g.y });
    }
  }, 2500);
}

function keyOf(sender) {
  for (const [key, item] of wins) if (!item.win.isDestroyed() && item.win.webContents === sender) return key;
  return null;
}

function init(emitter, onFocusApp) {
  emit = emitter;
  if (onFocusApp) focusApp = onFocusApp;
  ipcMain.on('widget:focusApp', (e) => { if (keyOf(e.sender)) focusApp(); });
  ipcMain.on('widget:post', (e, msg) => {
    const key = keyOf(e.sender);
    if (key) emit({ type: 'message', key, msg });
  });
  ipcMain.on('widget:resize', (e, w, h) => {
    const key = keyOf(e.sender);
    if (key && Number.isFinite(w) && Number.isFinite(h)) resize(key, w, h);
  });
  screen.on('display-metrics-changed', () => { for (const item of wins.values()) if (item.opts.anchor !== 'free') place(item); });
  screen.on('display-removed', () => { for (const item of wins.values()) place(item); });
}

module.exports = { init, caps, open, update, post, close, closeAll };
