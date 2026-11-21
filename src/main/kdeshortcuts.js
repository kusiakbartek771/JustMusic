// Skróty globalne na KDE Plasma bezpośrednio przez usługę kglobalaccel (D-Bus) – tak jak robią to
// programy KDE. Portal XDG, którego używa Electron, gubi część klawiszy (np. „`”) i rejestruje
// skróty bez klawisza. Wciśnięcia odbieramy przez `gdbus monitor` (sygnał globalShortcutPressed).
const { execFile, spawn } = require('child_process');

const COMP = 'justmusicplayer';
const FRIENDLY = 'JustMusic';
const handlers = new Map(); // akcelerator -> fn
let monitor = null;
let compPath = null;
let cleaned = false;

function available() {
  return process.platform === 'linux' && /kde/i.test(process.env.XDG_CURRENT_DESKTOP || '') && !!process.env.DBUS_SESSION_BUS_ADDRESS;
}

const gv = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const asArr = (arr) => `[${arr.map(gv).join(', ')}]`;

function gdbus(args) {
  return new Promise((resolve, reject) => {
    execFile('gdbus', ['call', '--session', '-d', 'org.kde.kglobalaccel', ...args], { timeout: 4000 }, (err, out) => (err ? reject(err) : resolve(String(out))));
  });
}
const kga = (method, ...args) => gdbus(['-o', '/kglobalaccel', '-m', `org.kde.KGlobalAccel.${method}`, ...args]);

// ---- akcelerator Electron → kod klawisza Qt ----
const MOD = { shift: 0x02000000, control: 0x04000000, ctrl: 0x04000000, commandorcontrol: 0x04000000, cmdorctrl: 0x04000000, alt: 0x08000000, option: 0x08000000, altgr: 0x08000000, super: 0x10000000, meta: 0x10000000, cmd: 0x10000000, command: 0x10000000 };
const NAMED = {
  space: 0x20, escape: 0x01000000, esc: 0x01000000, tab: 0x01000001, backspace: 0x01000003, return: 0x01000004, enter: 0x01000004,
  insert: 0x01000006, delete: 0x01000007, del: 0x01000007, pause: 0x01000008, printscreen: 0x01000009, home: 0x01000010, end: 0x01000011,
  left: 0x01000012, up: 0x01000013, right: 0x01000014, down: 0x01000015, pageup: 0x01000016, pagedown: 0x01000017,
  capslock: 0x01000024, numlock: 0x01000025, scrolllock: 0x01000026,
  volumedown: 0x01000070, volumemute: 0x01000071, volumeup: 0x01000072,
  mediaplaypause: 0x01000086, mediastop: 0x01000081, mediaprevioustrack: 0x01000082, medianexttrack: 0x01000083,
  plus: 0x2b, '`': 0x60, '~': 0x7e, '-': 0x2d, '=': 0x3d, '[': 0x5b, ']': 0x5d, '\\': 0x5c, ';': 0x3b, "'": 0x27, ',': 0x2c, '.': 0x2e, '/': 0x2f,
};

function toQt(acc) {
  const parts = String(acc || '').split('+');
  // „Control++” = Ctrl i klawisz plus
  if (acc.endsWith('++')) { parts.splice(-2, 2, '+'); }
  let code = 0;
  let key = null;
  for (const raw of parts) {
    const p = raw.trim();
    const l = p.toLowerCase();
    if (!p) continue;
    if (l in MOD) { code |= MOD[l]; continue; }
    if (key !== null) return null; // dwa zwykłe klawisze
    if (/^[a-z]$/i.test(p)) key = p.toUpperCase().charCodeAt(0);
    else if (/^[0-9]$/.test(p)) key = p.charCodeAt(0);
    else if (/^f([1-9]|[12]\d|3[0-5])$/i.test(p)) key = 0x01000030 + Number(p.slice(1)) - 1;
    else if (/^num[0-9]$/i.test(p)) { key = 0x30 + Number(p.slice(3)); code |= 0x20000000; }
    else if (p === '+') key = 0x2b;
    else if (l in NAMED) key = NAMED[l];
    else if (p in NAMED) key = NAMED[p];
    else return null;
  }
  return key === null ? null : (code | key);
}

// ---- nasłuch wciśnięć ----
function startMonitor() {
  if (monitor || !compPath) return;
  const m = spawn('gdbus', ['monitor', '--session', '--dest', 'org.kde.kglobalaccel', '--object-path', compPath], { stdio: ['ignore', 'pipe', 'ignore'] });
  monitor = m;
  let buf = '';
  m.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      const mm = line.match(/globalShortcutPressed \('((?:[^'\\]|\\.)*)', '((?:[^'\\]|\\.)*)'/);
      if (!mm || mm[1] !== COMP) continue;
      const name = mm[2].replace(/\\(.)/g, '$1');
      const fn = handlers.get(name);
      if (fn) { try { fn(); } catch (e) { console.error('[kde shortcut]', e); } }
    }
  });
  m.on('exit', () => {
    if (monitor === m) monitor = null;
    if (handlers.size) setTimeout(startMonitor, 2000); // np. restart Plasmy
  });
}

// stare skróty z portalu XDG (poprzednie wersje JustMusic) – już nieużywane
async function cleanPortalLeftovers() {
  if (cleaned) return;
  cleaned = true;
  try {
    const out = await gdbus(['-o', '/component/justmusic', '-m', 'org.kde.kglobalaccel.Component.shortcutNames']);
    for (const m of out.matchAll(/'((?:[^'\\]|\\.)*)'/g)) {
      const name = m[1].replace(/\\(.)/g, '$1');
      if (/^[0-9A-F]{32}-/.test(name)) await kga('unregister', gv('justmusic'), gv(name)).catch(() => {});
    }
  } catch {}
}

async function register(accelerator, label, fn) {
  const key = toQt(accelerator);
  if (key === null) return false;
  const id = asArr([COMP, accelerator, FRIENDLY, `JustMusic: ${label || accelerator}`]);
  await kga('doRegister', id);
  // SetPresent | NoAutoloading – obowiązuje skrót ustawiony w JustMusic
  const out = await kga('setShortcutKeys', id, `[([${key}],)]`, 'uint32 6');
  if (!new RegExp(`\\b${key}\\b`).test(out)) {
    await kga('unRegister', id).catch(() => {});
    return false; // klawisz zajęty przez inny program albo skrót systemowy
  }
  handlers.set(accelerator, fn);
  if (!compPath) {
    const p = await kga('getComponent', gv(COMP)).catch(() => '');
    compPath = (p.match(/'(\/component\/[^']+)'/) || [])[1] || `/component/${COMP}`;
  }
  startMonitor();
  cleanPortalLeftovers();
  return true;
}

async function unregister(accelerator) {
  handlers.delete(accelerator);
  await kga('unRegister', asArr([COMP, accelerator, FRIENDLY, ''])).catch(() => {});
  if (!handlers.size && monitor) { const m = monitor; monitor = null; m.kill(); }
}

function unregisterAll() {
  const all = [...handlers.keys()];
  handlers.clear();
  if (monitor) { const m = monitor; monitor = null; m.kill(); }
  // przy zamykaniu aplikacji: oznacz jako nieaktywne (KDE zwalnia klawisze)
  for (const a of all) execFile('gdbus', ['call', '--session', '-d', 'org.kde.kglobalaccel', '-o', '/kglobalaccel', '-m', 'org.kde.KGlobalAccel.setInactive', asArr([COMP, a, FRIENDLY, ''])], () => {});
}

module.exports = { available, register, unregister, unregisterAll, toQt };
