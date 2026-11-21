// Integracja z systemem: zasobnik (tray), pasek zadań, autostart, skrót w menu,
// globalne skróty klawiszowe i czas bezczynności.
const { app, Tray, Menu, nativeImage, shell, globalShortcut, powerMonitor } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const isLinux = process.platform === 'linux';
const ASSETS = path.join(__dirname, '..', '..', 'assets');
const APP_ID = 'justmusic';

let tray = null;
let getWin = () => null;
let sendCmd = () => {};
let now = { title: '', artist: '', playing: false, hasTrack: false };

function init({ windowGetter, onCommand }) {
  getWin = windowGetter;
  sendCmd = onCommand;
}

function icon(name, size) {
  const img = nativeImage.createFromPath(path.join(ASSETS, name));
  return size ? img.resize({ width: size, height: size, quality: 'best' }) : img;
}

// ---------------- polecenie uruchomienia aplikacji ----------------
function launchCommand(extraArgs = []) {
  if (process.env.APPIMAGE) return { exe: process.env.APPIMAGE, args: extraArgs };
  if (app.isPackaged) return { exe: process.execPath, args: extraArgs };
  return { exe: process.execPath, args: [app.getAppPath(), ...extraArgs] }; // tryb deweloperski
}

function quoteExec(s) {
  return /[\s"'\\$`]/.test(s) ? `"${s.replace(/(["\\$`])/g, '\\$1')}"` : s;
}

function desktopEntry(extraArgs = [], autostart = false) {
  const { exe, args } = launchCommand(extraArgs);
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=JustMusic',
    'GenericName=Odtwarzacz muzyki',
    'Comment=Odtwarzacz muzyki – YouTube, Spotify, pliki lokalne',
    `Exec=${[exe, ...args].map(quoteExec).join(' ')} %U`,
    `Icon=${APP_ID}`,
    'Terminal=false',
    'Categories=AudioVideo;Audio;Player;Music;',
    'Keywords=music;player;youtube;spotify;muzyka;',
    'StartupWMClass=JustMusic',
    'StartupNotify=true',
    autostart ? 'X-GNOME-Autostart-enabled=true' : null,
    '',
  ].filter((l) => l !== null).join('\n');
}

const linuxPaths = () => {
  const data = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  const config = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return {
    desktop: path.join(data, 'applications', `${APP_ID}.desktop`),
    icon: path.join(data, 'icons', 'hicolor', '512x512', 'apps', `${APP_ID}.png`),
    autostart: path.join(config, 'autostart', `${APP_ID}.desktop`),
  };
};

const winPaths = () => ({
  startMenu: path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'JustMusic.lnk'),
  desktop: path.join(app.getPath('desktop'), 'JustMusic.lnk'),
});

// ---------------- skrót w menu aplikacji (do przypięcia na pasku zadań) ----------------
function shortcutStatus() {
  if (isLinux) return { supported: true, installed: fs.existsSync(linuxPaths().desktop) };
  if (isWin) return { supported: true, installed: fs.existsSync(winPaths().startMenu) };
  return { supported: false, installed: app.isPackaged, mac: true };
}

function installShortcut({ desktop = false } = {}) {
  if (isLinux) {
    const p = linuxPaths();
    fs.mkdirSync(path.dirname(p.desktop), { recursive: true });
    fs.mkdirSync(path.dirname(p.icon), { recursive: true });
    fs.copyFileSync(path.join(ASSETS, 'icon.png'), p.icon);
    fs.writeFileSync(p.desktop, desktopEntry(), { mode: 0o755 });
    if (desktop) {
      const d = path.join(app.getPath('desktop'), `${APP_ID}.desktop`);
      fs.writeFileSync(d, desktopEntry(), { mode: 0o755 });
    }
    refreshDesktopCaches(path.dirname(p.desktop));
    return shortcutStatus();
  }
  if (isWin) {
    const { exe, args } = launchCommand();
    const opts = { target: exe, args: args.map((a) => `"${a}"`).join(' '), description: 'JustMusic', icon: exe, iconIndex: 0, appUserModelId: 'app.justmusic.player' };
    const p = winPaths();
    fs.mkdirSync(path.dirname(p.startMenu), { recursive: true });
    shell.writeShortcutLink(p.startMenu, 'create', opts);
    if (desktop) shell.writeShortcutLink(p.desktop, 'create', opts);
    return shortcutStatus();
  }
  return shortcutStatus();
}

// Odświeżenie list aplikacji (KDE trzyma własną pamięć podręczną – bez tego pasek zadań pokazuje „?”)
function refreshDesktopCaches(dir) {
  const { spawn } = require('child_process');
  for (const [cmd, args] of [['update-desktop-database', [dir]], ['kbuildsycoca6', []], ['kbuildsycoca5', []]]) {
    try { spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch {}
  }
}

// Linux: przy starcie upewnij się, że istnieje aktualny skrót z ikoną –
// środowiska Wayland (KDE, GNOME) biorą ikonę okna wyłącznie z pliku .desktop.
function ensureDesktopEntry() {
  if (!isLinux) return false;
  // pakiety .deb/.pacman instalują własny skrót systemowy
  if (fs.existsSync(`/usr/share/applications/${APP_ID}.desktop`)) return false;
  const p = linuxPaths();
  const want = desktopEntry();
  let cur = null;
  try { cur = fs.readFileSync(p.desktop, 'utf8'); } catch {}
  const iconOk = fs.existsSync(p.icon);
  if (cur === want && iconOk) return false;
  try {
    installShortcut({});
    return true;
  } catch (e) {
    console.warn('[system] desktop entry', e.message);
    return false;
  }
}

function removeShortcut() {
  if (isLinux) {
    const p = linuxPaths();
    for (const f of [p.desktop, p.icon, path.join(app.getPath('desktop'), `${APP_ID}.desktop`)]) fs.rmSync(f, { force: true });
  } else if (isWin) {
    const p = winPaths();
    fs.rmSync(p.startMenu, { force: true });
    fs.rmSync(p.desktop, { force: true });
  }
  return shortcutStatus();
}

// ---------------- autostart ----------------
function getAutostart() {
  if (isLinux) {
    const f = linuxPaths().autostart;
    if (!fs.existsSync(f)) return { enabled: false, hidden: false };
    return { enabled: true, hidden: fs.readFileSync(f, 'utf8').includes('--hidden') };
  }
  const s = app.getLoginItemSettings(app.isPackaged ? {} : { path: process.execPath, args: [app.getAppPath()] });
  return { enabled: !!s.openAtLogin, hidden: !!(s.openAsHidden || (s.launchItems || []).some((i) => (i.args || []).includes('--hidden'))) };
}

function setAutostart(enabled, hidden) {
  const extra = hidden ? ['--hidden'] : [];
  if (isLinux) {
    const f = linuxPaths().autostart;
    if (enabled) {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, desktopEntry(extra, true));
    } else fs.rmSync(f, { force: true });
    return getAutostart();
  }
  const { exe, args } = launchCommand(extra);
  app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: hidden, path: exe, args });
  return getAutostart();
}

// ---------------- zasobnik ----------------
function trayMenu() {
  const w = getWin();
  const visible = w && w.isVisible() && !w.isMinimized();
  return Menu.buildFromTemplate([
    { label: now.hasTrack ? `${now.title}${now.artist ? ' — ' + now.artist : ''}`.slice(0, 60) : 'Nic nie gra', enabled: false },
    { type: 'separator' },
    { label: now.playing ? 'Pauza' : 'Odtwórz', enabled: now.hasTrack, click: () => sendCmd('toggle') },
    { label: 'Następny', enabled: now.hasTrack, click: () => sendCmd('next') },
    { label: 'Poprzedni', enabled: now.hasTrack, click: () => sendCmd('prev') },
    { type: 'separator' },
    { label: visible ? 'Ukryj okno' : 'Pokaż okno', click: () => toggleWindow() },
    { label: 'Mini odtwarzacz', click: () => require('./mini').toggle() },
    { label: 'Zakończ JustMusic', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
}

function toggleWindow(forceShow = false) {
  const w = getWin();
  if (!w) return;
  if (!forceShow && w.isVisible() && !w.isMinimized() && w.isFocused()) w.hide();
  else {
    if (w.isMinimized()) w.restore();
    w.show();
    w.focus();
  }
  refreshTray();
}

function setTray(enabled) {
  if (enabled && !tray) {
    tray = new Tray(icon('icon.png', isMac ? 18 : isWin ? 16 : 24));
    tray.setToolTip('JustMusic');
    tray.on('click', () => toggleWindow());
    if (!isMac) tray.setContextMenu(trayMenu());
    else tray.on('right-click', () => tray.popUpContextMenu(trayMenu()));
  } else if (!enabled && tray) {
    tray.destroy();
    tray = null;
  }
}

function refreshTray() {
  if (!tray) return;
  tray.setToolTip(now.hasTrack ? `JustMusic\n${now.title} — ${now.artist}` : 'JustMusic');
  if (!isMac) tray.setContextMenu(trayMenu());
}

const hasTray = () => !!tray;

// ---------------- pasek zadań (Windows: przyciski miniatury) ----------------
function updateThumbar() {
  const w = getWin();
  if (!isWin || !w) return;
  try {
    w.setThumbarButtons(now.hasTrack ? [
      { tooltip: 'Poprzedni', icon: icon('thumbar/prev.png'), click: () => sendCmd('prev') },
      { tooltip: now.playing ? 'Pauza' : 'Odtwórz', icon: icon(now.playing ? 'thumbar/pause.png' : 'thumbar/play.png'), click: () => sendCmd('toggle') },
      { tooltip: 'Następny', icon: icon('thumbar/next.png'), click: () => sendCmd('next') },
    ] : []);
  } catch {}
}

function nowPlaying(info) {
  const changed = info.playing !== now.playing || info.title !== now.title || info.hasTrack !== now.hasTrack;
  now = { ...now, ...info };
  if (!changed) return;
  refreshTray();
  updateThumbar();
  const w = getWin();
  if (w) w.setTitle(now.hasTrack ? `${now.title} — ${now.artist} · JustMusic` : 'JustMusic');
}

function progress(ratio, mode) {
  const w = getWin();
  if (!w) return;
  try {
    if (ratio < 0) w.setProgressBar(-1);
    else w.setProgressBar(Math.max(0, Math.min(1, ratio)), isWin ? { mode: mode || 'normal' } : undefined);
  } catch {}
}

// ---------------- globalne skróty ----------------
const globals = new Map(); // accelerator -> id
// KDE: bezpośrednio przez kglobalaccel (portal XDG gubi część klawiszy); reszta: Electron.
const kdeKeys = require('./kdeshortcuts');
async function registerGlobal(accelerator, id) {
  try {
    if (kdeKeys.available()) {
      const ok = await kdeKeys.register(accelerator, id, () => sendCmd('shortcut', globals.get(accelerator) || id));
      if (ok) globals.set(accelerator, id);
      return ok;
    }
    if (globals.has(accelerator)) globalShortcut.unregister(accelerator);
    const ok = globalShortcut.register(accelerator, () => sendCmd('shortcut', id));
    if (ok) globals.set(accelerator, id);
    return ok;
  } catch (e) {
    console.warn('[shortcut]', accelerator, e.message);
    return false;
  }
}
function unregisterGlobal(accelerator) {
  if (kdeKeys.available()) kdeKeys.unregister(accelerator);
  else try { globalShortcut.unregister(accelerator); } catch {}
  globals.delete(accelerator);
}
function unregisterAllGlobals() {
  if (kdeKeys.available()) { kdeKeys.unregisterAll(); globals.clear(); return; }
  for (const a of globals.keys()) unregisterGlobal(a);
}

// ---------------- bezczynność ----------------
// Czas bezczynności całego systemu.
// Wayland: Electron zwraca zawsze 0 – używamy protokołu ext-idle-notify (wlidle.js).
// X11, Windows, macOS: powerMonitor działa poprawnie.
const wlidle = require('./wlidle');
function idleSeconds() {
  if (wlidle.supported()) {
    wlidle.start();
    const s = wlidle.idleSeconds();
    if (s !== null) return { seconds: s, state: s > 0 ? 'idle' : 'active', source: 'wayland', reliable: true };
    // kompozytor bez ext-idle-notify (np. starsze środowiska) – wynik niewiarygodny
    return { seconds: 0, state: 'unknown', source: 'none', reliable: false };
  }
  try {
    return { seconds: powerMonitor.getSystemIdleTime(), state: powerMonitor.getSystemIdleState(60), source: 'system', reliable: true };
  } catch {
    return { seconds: 0, state: 'unknown', source: 'none', reliable: false };
  }
}

module.exports = {
  init, setTray, hasTray, toggleWindow, nowPlaying, progress,
  shortcutStatus, installShortcut, removeShortcut, ensureDesktopEntry, getAutostart, setAutostart,
  registerGlobal, unregisterGlobal, unregisterAllGlobals, idleSeconds,
};
