// Mini odtwarzacz: małe okno z okładką i sterowaniem (opcjonalnie zawsze na wierzchu).
// Stan dostaje od okna głównego (renderer), polecenia odsyła do niego tą samą drogą co zasobnik.
const { BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const store = require('./store');
const kwin = require('./kwin');

const CAPTION = 'JustMusic – mini odtwarzacz';
let win = null;
let last = null;          // ostatni stan od renderera
let opts = { onTop: true };
let hooks = { send: () => {}, mainWin: () => null, onChange: () => {}, hasTray: () => false };
let posTimer = null;

const useKwin = () => kwin.available();

function init(h) {
  hooks = { ...hooks, ...h };
  ipcMain.on('mini:cmd', (e, cmd, arg) => {
    if (!win || e.sender !== win.webContents) return;
    if (cmd === 'expand') return expand();
    if (cmd === 'close') return close();
    if (cmd === 'pin') return setOnTop(!opts.onTop);
    if (cmd === 'size') return setSize(arg);
    hooks.send('player:cmd', { cmd: 'mini', arg: { cmd, arg } });
  });
  ipcMain.on('mini:ready', (e) => {
    if (win && e.sender === win.webContents) pushState();
  });
}

function saved() {
  return store.load('mini', {}) || {};
}

async function savePos() {
  if (!win || win.isDestroyed()) return;
  let b = win.getBounds();
  if (useKwin()) {
    const g = await kwin.geometry(CAPTION).catch(() => null);
    if (g) b = { ...b, x: g.x, y: g.y };
    else b = { ...b, x: undefined, y: undefined };
  }
  const s = saved();
  store.saveSync('mini', { ...s, width: b.width, height: b.height, ...(b.x !== undefined ? { x: b.x, y: b.y } : {}), onTop: opts.onTop });
}

function visibleOn(x, y) {
  return screen.getAllDisplays().some((d) => x >= d.bounds.x - 40 && y >= d.bounds.y - 40 && x < d.bounds.x + d.bounds.width - 40 && y < d.bounds.y + d.bounds.height - 40);
}

function open({ hideMain = true } = {}) {
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
    if (hideMain) hooks.mainWin()?.hide();
    return;
  }
  const s = saved();
  opts.onTop = s.onTop !== false;
  const width = Math.max(260, Math.min(700, s.width || 380));
  const height = Math.max(96, Math.min(700, s.height || 128));
  let pos = {};
  if (Number.isFinite(s.x) && Number.isFinite(s.y) && visibleOn(s.x, s.y)) pos = { x: s.x, y: s.y };
  else {
    const wa = screen.getPrimaryDisplay().workArea;
    pos = { x: wa.x + wa.width - width - 24, y: wa.y + wa.height - height - 24 };
  }
  win = new BrowserWindow({
    width, height, ...pos,
    minWidth: 260, minHeight: 96, maxWidth: 900, maxHeight: 900,
    frame: false, transparent: true, hasShadow: true, resizable: true,
    maximizable: false, minimizable: true, fullscreenable: false,
    alwaysOnTop: opts.onTop,
    show: false,
    title: CAPTION,
    backgroundColor: '#00000000',
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'mini-preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false,
    },
  });
  if (opts.onTop) win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(false);
  // strona może zmienić tytuł – utrzymujemy stały (po nim KWin rozpoznaje okno)
  win.on('page-title-updated', (e) => e.preventDefault());
  win.loadURL('jm://app/mini.html');
  win.once('ready-to-show', () => {
    win.show();
    if (useKwin()) kwin.set(CAPTION, { above: opts.onTop, allDesktops: false, normal: true, pos: { x: pos.x, y: pos.y } });
  });
  const schedule = () => { clearTimeout(posTimer); posTimer = setTimeout(savePos, 600); };
  win.on('move', schedule);
  win.on('resize', () => { schedule(); });
  win.on('close', () => { clearTimeout(posTimer); savePos(); });
  win.on('closed', () => {
    win = null;
    if (useKwin()) kwin.remove(CAPTION);
    hooks.onChange(false);
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  if (hideMain) hooks.mainWin()?.hide();
  hooks.onChange(true);
}

function setOnTop(v) {
  opts.onTop = !!v;
  if (!win) return;
  win.setAlwaysOnTop(opts.onTop, 'floating');
  if (useKwin()) kwin.set(CAPTION, { above: opts.onTop, allDesktops: false, normal: true });
  savePos();
  pushState();
}

// Szybkie rozmiary: kompaktowy pasek / duża okładka
function setSize(kind) {
  if (!win) return;
  const [w, h] = kind === 'big' ? [300, 400] : [380, 128];
  win.setSize(w, h, true);
}

function expand() {
  const m = hooks.mainWin();
  if (m) {
    if (m.isMinimized()) m.restore();
    m.show();
    m.focus();
  }
  close();
}

function close() {
  if (win && !win.isDestroyed()) win.close();
  // główne okno schowane, a zasobnika brak – bez tego nie dałoby się wrócić do aplikacji
  const m = hooks.mainWin();
  if (m && !m.isVisible() && !hooks.hasTray()) m.show();
}

function toggle() {
  if (win && !win.isDestroyed()) expand();
  else open();
}

function pushState() {
  if (win && !win.isDestroyed() && last) win.webContents.send('mini:state', { ...last, onTop: opts.onTop });
}

function state(s) {
  last = { ...(last || {}), ...s };
  pushState();
}

const isOpen = () => !!(win && !win.isDestroyed());

module.exports = { init, open, close, toggle, expand, state, isOpen };
