// KDE Plasma na Waylandzie: aplikacja nie może sama ustawić okna „zawsze na wierzchu”
// ani jego pozycji (protokół xdg-shell na to nie pozwala). Robi to za nas skrypt KWin
// ładowany przez D-Bus (nic nie jest zapisywane w konfiguracji KDE – znika po wylogowaniu).
// Pozycję okien (np. po przeciągnięciu) odczytujemy przez D-Bus KWin (getWindowInfo).
const { app } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const PLUGIN = 'justmusic-widgets';
const entries = new Map(); // caption -> { above, allDesktops, pos: {x,y}|null }
const uuids = new Map(); // caption -> uuid okna w KWin
let syncTimer = null;
let syncing = Promise.resolve();

function available() {
  return process.platform === 'linux'
    && (process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY)
    && /kde/i.test(process.env.XDG_CURRENT_DESKTOP || '')
    && !process.argv.some((a) => a.includes('ozone-platform=x11'));
}

function gdbus(args, timeout = 3000) {
  return new Promise((resolve, reject) => {
    execFile('gdbus', ['call', '--session', ...args], { timeout }, (err, out) => (err ? reject(err) : resolve(String(out))));
  });
}

const call = (obj, method, ...args) => gdbus(['-d', 'org.kde.KWin', '-o', obj, '-m', method, ...args]);

/** uuid okna o dokładnie tym tytule (przez wyszukiwarkę okien KWin) */
async function findUuid(caption) {
  if (uuids.has(caption)) return uuids.get(caption);
  const out = await call('/WindowsRunner', 'org.kde.krunner1.Match', caption).catch(() => '');
  const re = /\('0_(\{[0-9a-f-]+\})', '((?:[^'\\]|\\.)*)'/g;
  let m;
  while ((m = re.exec(out))) {
    if (m[2] === caption) { uuids.set(caption, m[1]); return m[1]; }
  }
  return null;
}

/** { x, y, width, height } okna albo null */
async function geometry(caption) {
  const id = await findUuid(caption);
  if (!id) return null;
  const out = await call('/KWin', 'org.kde.KWin.getWindowInfo', id).catch(() => '');
  const num = (k) => { const m = out.match(new RegExp(`'${k}': <(-?[\\d.]+)>`)); return m ? Math.round(Number(m[1])) : null; };
  const g = { x: num('x'), y: num('y'), width: num('width'), height: num('height') };
  if (g.x === null || g.width === null) { uuids.delete(caption); return null; } // okno zniknęło
  return g;
}

function script() {
  const data = {};
  for (const [cap, e] of entries) data[cap] = { above: !!e.above, all: e.allDesktops !== false, pos: e.pos || null };
  return `// wygenerowane przez JustMusic – widżety na pulpicie
const W = ${JSON.stringify(data)};
function fix(w) {
  if (!w) return;
  const c = W[w.caption];
  if (!c) return;
  w.keepAbove = c.above;
  w.onAllDesktops = c.all;
  w.skipTaskbar = true; w.skipPager = true; w.skipSwitcher = true;
  if (c.pos) {
    const g = w.frameGeometry;
    w.frameGeometry = { x: c.pos.x, y: c.pos.y, width: g.width, height: g.height };
  }
}
function watch(w) {
  fix(w);
  if (w && w.captionChanged) w.captionChanged.connect(function () { fix(w); });
}
workspace.windowList().forEach(watch);
workspace.windowAdded.connect(watch);
// widżet nigdy nie zatrzymuje fokusu – oddajemy go poprzedniemu oknu (np. grze na pełnym ekranie)
var prev = workspace.activeWindow && !W[workspace.activeWindow.caption] ? workspace.activeWindow : null;
workspace.windowActivated.connect(function (w) {
  if (!w) return;
  if (W[w.caption]) {
    if (prev && prev !== w && !prev.deleted && !prev.minimized) {
      try { workspace.activeWindow = prev; } catch (e) {}
    }
  } else {
    prev = w;
  }
});
`;
}

async function doSync() {
  const file = path.join(app.getPath('userData'), 'kwin-widgets.js');
  fs.writeFileSync(file, script());
  await call('/Scripting', 'org.kde.kwin.Scripting.unloadScript', PLUGIN).catch(() => {});
  if (entries.size) {
    await call('/Scripting', 'org.kde.kwin.Scripting.loadScript', file, PLUGIN);
    await call('/Scripting', 'org.kde.kwin.Scripting.start');
  }
  setTimeout(verify, 350);
}

// Położenie stosujemy, aż okno naprawdę tam stanie (KWin bywa szybszy ze swoim rozmieszczaniem
// świeżo pokazanego okna). Potem je „zapominamy”, żeby kolejne przeładowania skryptu nie cofały
// przeciągnięcia wykonanego przez użytkownika.
let verifyTries = 0;
async function verify() {
  let again = false;
  for (const [cap, e] of entries) {
    if (!e.pos) continue;
    const g = await geometry(cap);
    if (!g) continue; // okna jeszcze nie ma – skrypt ustawi je przy pojawieniu się
    if (Math.abs(g.x - e.pos.x) <= 2 && Math.abs(g.y - e.pos.y) <= 2) e.pos = null;
    else again = true;
  }
  if (again && verifyTries++ < 6) sync();
  else if (!again) verifyTries = 0;
}

function sync() {
  clearTimeout(syncTimer);
  return new Promise((resolve) => {
    syncTimer = setTimeout(() => {
      syncing = syncing.then(doSync).catch((e) => console.warn('[kwin]', e.message)).then(resolve);
    }, 120);
  });
}

function set(caption, { above = true, allDesktops = true, pos } = {}) {
  const prev = entries.get(caption) || {};
  if (pos) verifyTries = 0;
  entries.set(caption, { above, allDesktops, pos: pos === undefined ? prev.pos || null : pos });
  return sync();
}

function remove(caption) {
  entries.delete(caption);
  uuids.delete(caption);
  return sync();
}

function forget(caption) {
  uuids.delete(caption);
}

function clear() {
  entries.clear();
  uuids.clear();
  clearTimeout(syncTimer);
  call('/Scripting', 'org.kde.kwin.Scripting.unloadScript', PLUGIN).catch(() => {});
}

/** czy okno czeka jeszcze na ustawienie pozycji */
const pending = (caption) => !!entries.get(caption)?.pos;

module.exports = { available, set, remove, forget, clear, geometry, pending };
