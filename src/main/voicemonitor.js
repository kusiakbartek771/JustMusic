// Wykrywanie mówienia na podstawie dźwięku z aplikacji czatu głosowego (Linux: PipeWire / PulseAudio).
// Działa z każdym klientem (Discord, Vesktop, WebCord, TeamSpeak…) – bez autoryzacji i bez RPC.
// Słucha tylko strumienia wyjściowego wybranej aplikacji (głosy innych osób), nie mikrofonu.
const { spawn, execFile } = require('child_process');

const DEFAULT_MATCH = 'discord|vesktop|vencord|webcord|legcord|armcord|teamspeak|mumble';

let emit = () => {};
let opts = { match: DEFAULT_MATCH, threshold: 0.012, holdMs: 700 };
let running = false;
let scanTimer = null;
const monitors = new Map(); // index sink-input -> { proc, name, level, lastLoud }
let speaking = false;
let releaseTimer = null;
let lastLevelEmit = 0;

function setEmitter(fn) { emit = fn; }

function supported() {
  return process.platform === 'linux';
}

function pactl(args) {
  return new Promise((resolve) => {
    execFile('pactl', args, { timeout: 4000, maxBuffer: 4 * 1024 * 1024 }, (err, out) => resolve(err ? null : out));
  });
}

// Lista strumieni odtwarzania: [{ index, name, binary, appId, pid }]
async function sinkInputs() {
  const json = await pactl(['-f', 'json', 'list', 'sink-inputs']);
  if (json) {
    try {
      return JSON.parse(json).map((si) => {
        const p = si.properties || {};
        return { index: si.index, name: p['application.name'] || '', binary: p['application.process.binary'] || '', appId: p['pipewire.access.portal.app_id'] || p['application.id'] || '', pid: Number(p['application.process.id']) || 0 };
      });
    } catch {}
  }
  // starsze pactl bez JSON – parsowanie tekstu
  const text = await pactl(['list', 'sink-inputs']);
  if (!text) return [];
  return text.split(/\n(?=Sink Input #)/).map((block) => {
    const g = (k) => (block.match(new RegExp(`${k} = "([^"]*)"`)) || [])[1] || '';
    return { index: Number((block.match(/Sink Input #(\d+)/) || [])[1]), name: g('application.name'), binary: g('application.process.binary'), appId: g('pipewire.access.portal.app_id'), pid: Number(g('application.process.id')) || 0 };
  }).filter((x) => Number.isFinite(x.index));
}

function setSpeaking(v) {
  if (v === speaking) return;
  speaking = v;
  emit('speaking', { speaking: v, apps: [...monitors.values()].filter((m) => Date.now() - m.lastLoud < opts.holdMs).map((m) => m.name) });
}

function onLevel(m, rms) {
  m.level = rms;
  const now = Date.now();
  if (rms > opts.threshold) {
    m.loudFrames = (m.loudFrames || 0) + 1;
    // co najmniej ~60 ms głośno, żeby pojedyncze kliknięcia/dźwięki powiadomień nie ściszały muzyki
    if (m.loudFrames >= 3) {
      m.lastLoud = now;
      clearTimeout(releaseTimer);
      setSpeaking(true);
      releaseTimer = setTimeout(() => setSpeaking(false), opts.holdMs);
    }
  } else m.loudFrames = 0;
  if (now - lastLevelEmit > 100) {
    lastLevelEmit = now;
    let max = 0;
    for (const x of monitors.values()) max = Math.max(max, x.level || 0);
    emit('level', { level: max, threshold: opts.threshold });
  }
}

function startMonitor(si) {
  // 8 kHz mono, 16 bit – wystarczy do wykrycia głosu, minimalne obciążenie
  const proc = spawn('parec', [`--monitor-stream=${si.index}`, '--raw', '--format=s16le', '--rate=8000', '--channels=1', '--latency-msec=20'], { stdio: ['ignore', 'pipe', 'ignore'] });
  const m = { proc, name: si.name || si.binary, level: 0, lastLoud: 0, loudFrames: 0 };
  let buf = Buffer.alloc(0);
  const CHUNK = 320; // 20 ms
  proc.stdout.on('data', (d) => {
    buf = buf.length ? Buffer.concat([buf, d]) : d;
    while (buf.length >= CHUNK) {
      let sum = 0;
      for (let i = 0; i < CHUNK; i += 2) {
        const s = buf.readInt16LE(i) / 32768;
        sum += s * s;
      }
      buf = buf.subarray(CHUNK);
      onLevel(m, Math.sqrt(sum / (CHUNK / 2)));
    }
  });
  proc.on('error', () => {});
  proc.on('close', () => { if (monitors.get(si.index) === m) monitors.delete(si.index); });
  monitors.set(si.index, m);
}

async function scan() {
  if (!running) return;
  let re;
  try { re = new RegExp(opts.match || DEFAULT_MATCH, 'i'); } catch { re = new RegExp(DEFAULT_MATCH, 'i'); }
  const list = (await sinkInputs()).filter((si) => si.pid !== process.pid && re.test(`${si.name} ${si.binary} ${si.appId}`));
  const want = new Set(list.map((s) => s.index));
  for (const [idx, m] of monitors) if (!want.has(idx)) { m.proc.kill(); monitors.delete(idx); }
  for (const si of list) if (!monitors.has(si.index)) startMonitor(si);
  emit('apps', { apps: [...monitors.values()].map((m) => m.name) });
}

async function start(o = {}) {
  if (!supported()) throw new Error('Wykrywanie po dźwięku działa na Linuksie (PipeWire/PulseAudio)');
  opts = { ...opts, ...o };
  if (!running) {
    const ok = await pactl(['info']);
    if (!ok) throw new Error('Nie znaleziono pactl (PulseAudio/PipeWire)');
    running = true;
    await scan();
    scanTimer = setInterval(scan, 4000);
  }
  return status();
}

function configure(o = {}) {
  opts = { ...opts, ...o };
  return status();
}

function stop() {
  running = false;
  clearInterval(scanTimer);
  clearTimeout(releaseTimer);
  for (const m of monitors.values()) m.proc.kill();
  monitors.clear();
  setSpeaking(false);
  return status();
}

function status() {
  return { supported: supported(), running, apps: [...monitors.values()].map((m) => m.name), speaking, threshold: opts.threshold };
}

module.exports = { setEmitter, start, stop, configure, status, supported, DEFAULT_MATCH };
