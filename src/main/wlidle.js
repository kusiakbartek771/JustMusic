// Bezczynność użytkownika na Waylandzie (KDE, GNOME 47+, Sway, Hyprland…) przez protokół ext-idle-notify-v1.
// Electron na Waylandzie zwraca zawsze 0 s bezczynności – ten minimalny klient Wayland (czysty JS,
// bez bibliotek natywnych) pyta kompozytor bezpośrednio. Wersja 2 protokołu ignoruje blokady
// wygaszacza (np. odtwarzanie muzyki), więc liczy się wyłącznie aktywność myszy i klawiatury.
const net = require('net');
const path = require('path');

const THRESHOLD_MS = Number(process.env.JM_IDLE_THRESHOLD_MS) || 5000; // po tylu ms bez ruchu kompozytor zgłasza „idled”

let sock = null;
let ready = false;
let idleSince = 0; // znacznik czasu początku bezczynności (0 = aktywny)
let nextId = 2;

const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b; };
function str(s) {
  const raw = Buffer.from(s + '\0', 'utf8');
  const pad = Buffer.alloc((4 - (raw.length % 4)) % 4);
  return Buffer.concat([u32(raw.length), raw, pad]);
}
function msg(id, op, args = []) {
  const body = Buffer.concat(args);
  const head = Buffer.alloc(8);
  head.writeUInt32LE(id, 0);
  head.writeUInt32LE(((8 + body.length) << 16) | op, 4);
  return Buffer.concat([head, body]);
}

function supported() {
  return process.platform === 'linux' && !!process.env.WAYLAND_DISPLAY && !!process.env.XDG_RUNTIME_DIR;
}

function start() {
  if (sock || !supported()) return;
  const display = process.env.WAYLAND_DISPLAY;
  const p = path.isAbsolute(display) ? display : path.join(process.env.XDG_RUNTIME_DIR, display);
  sock = net.createConnection(p);
  const REGISTRY = nextId++;
  const SYNC = nextId++;
  const globals = {};
  let notifier = null;
  let seat = null;

  sock.on('connect', () => {
    // wl_display.get_registry + wl_display.sync (koniec listy globali)
    sock.write(Buffer.concat([msg(1, 1, [u32(REGISTRY)]), msg(1, 0, [u32(SYNC)])]));
  });

  let buf = Buffer.alloc(0);
  sock.on('data', (d) => {
    buf = buf.length ? Buffer.concat([buf, d]) : d;
    while (buf.length >= 8) {
      const id = buf.readUInt32LE(0);
      const w = buf.readUInt32LE(4);
      const size = w >>> 16;
      const op = w & 0xffff;
      if (size < 8 || buf.length < size) break;
      const a = buf.subarray(8, size);
      buf = buf.subarray(size);
      if (id === REGISTRY && op === 0) {
        // wl_registry.global(name, interface, version)
        const name = a.readUInt32LE(0);
        const len = a.readUInt32LE(4);
        const iface = a.toString('utf8', 8, 8 + len - 1);
        const version = a.readUInt32LE(8 + Math.ceil(len / 4) * 4);
        globals[iface] ||= { name, version };
      } else if (id === SYNC && op === 0) {
        onGlobals();
      } else if (id === notifier?.notification) {
        if (op === 0) idleSince = Date.now() - THRESHOLD_MS; // idled
        else if (op === 1) idleSince = 0; // resumed
      } else if (id === 1 && op === 0) {
        // wl_display.error – protokół nieobsługiwany lub odrzucony
        stop();
      }
    }
  });

  function bind(iface, version) {
    const g = globals[iface];
    const id = nextId++;
    sock.write(msg(REGISTRY, 0, [u32(g.name), str(iface), u32(Math.min(version, g.version)), u32(id)]));
    return id;
  }

  function onGlobals() {
    if (!globals.ext_idle_notifier_v1 || !globals.wl_seat) { stop(); return; }
    seat = bind('wl_seat', 1);
    const v = globals.ext_idle_notifier_v1.version;
    const n = bind('ext_idle_notifier_v1', Math.min(2, v));
    const notification = nextId++;
    // v2: get_input_idle_notification (ignoruje blokady), v1: get_idle_notification
    sock.write(msg(n, v >= 2 ? 2 : 1, [u32(notification), u32(THRESHOLD_MS), u32(seat)]));
    notifier = { id: n, notification };
    ready = true;
  }

  sock.on('error', () => stop());
  sock.on('close', () => { sock = null; ready = false; });
}

function stop() {
  ready = false;
  if (sock) { try { sock.destroy(); } catch {} }
  sock = null;
}

// sekundy bezczynności albo null, gdy metoda niedostępna
function idleSeconds() {
  if (!ready) return null;
  return idleSince ? Math.floor((Date.now() - idleSince) / 1000) : 0;
}

module.exports = { start, stop, idleSeconds, supported, isReady: () => ready };
