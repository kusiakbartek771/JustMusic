// Minimalny klient Discord RPC (lokalny IPC klienta Discord – bez zewnętrznych bibliotek).
// - SET_ACTIVITY: status „Słucha …”
// - (opcjonalnie) OAuth + SPEAKING_START/STOP: wykrywanie mówiących na kanale głosowym
const net = require('net');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { app } = require('electron');

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };

let sock = null;
let clientId = null;
let ready = false;
let user = null;
let nonceN = 0;
const pending = new Map(); // nonce -> { resolve, reject }
let emit = () => {};
let reconnectTimer = null;
let lastActivity = null;
let voice = { enabled: false, secret: '', channelId: null, subscribed: null, authed: false };
let lastCloseReason = '';
let foundSocket = false;
let retryDelay = 3000;

function setEmitter(fn) {
  emit = fn;
}

function candidatePaths() {
  if (process.platform === 'win32') return Array.from({ length: 10 }, (_, i) => `\\\\?\\pipe\\discord-ipc-${i}`);
  const bases = [process.env.XDG_RUNTIME_DIR, process.env.TMPDIR, process.env.TMP, process.env.TEMP, '/tmp'].filter(Boolean);
  const subs = ['', 'app/com.discordapp.Discord', 'app/com.discordapp.DiscordCanary', '.flatpak/dev.vencord.Vesktop/xdg-run', 'app/dev.vencord.Vesktop', 'snap.discord', 'snap.discord-canary'];
  const out = [];
  for (const b of bases) for (const s of subs) for (let i = 0; i < 10; i++) out.push(path.join(b, s, `discord-ipc-${i}`));
  return [...new Set(out)];
}

function encode(op, data) {
  const json = Buffer.from(JSON.stringify(data), 'utf8');
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(json.length, 4);
  return Buffer.concat([head, json]);
}

function tryConnect(p) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32' && !fs.existsSync(p)) return resolve(null);
    const s = net.createConnection(p);
    let done = false;
    const fail = () => { if (done) return; done = true; clearTimeout(timer); s.destroy(); resolve(null); };
    const timer = setTimeout(fail, 1500);
    s.once('connect', () => { if (done) return; done = true; clearTimeout(timer); s.off('error', fail); resolve(s); });
    s.once('error', fail);
  });
}

const dbg = (...a) => { if (process.env.JM_DEBUG) console.log('[discord]', ((Date.now() % 100000) / 1000).toFixed(2), ...a); };

let connecting = null; // { id, promise } – trwające łączenie

function connect(id) {
  if (connecting && connecting.id === id) return connecting.promise;
  const promise = doConnect(id).finally(() => { if (connecting?.promise === promise) connecting = null; });
  connecting = { id, promise };
  return promise;
}

async function doConnect(id) {
  dbg('connect', id, 'sock', !!sock, 'ready', ready);
  if (!id) throw new Error('Brak Application ID');
  if (sock && clientId === id && ready) return status();
  disconnect(false);
  clientId = id;
  lastCloseReason = '';
  foundSocket = false;
  // próbujemy kolejnych gniazd, aż któreś odpowie na handshake (część może być nieaktualna, np. po flatpaku)
  for (const p of candidatePaths()) {
    const s = await tryConnect(p);
    if (!s) continue;
    dbg('socket', p);
    foundSocket = true;
    if (await attach(s, id)) break;
    dbg('handshake failed', p);
  }
  if (!sock || !ready) {
    sock = null;
    scheduleReconnect();
    if (/client id/i.test(lastCloseReason)) throw new Error('Discord odrzucił Application ID – sprawdź, czy skopiowałeś „Application ID” (nie Public Key)');
    if (foundSocket) throw new Error(lastCloseReason || 'Discord odrzucił połączenie');
    throw new Error('Nie znaleziono Discorda. Vesktop: Ustawienia → Vesktop → włącz „Rich Presence (arRPC)”');
  }
  retryDelay = 3000;
  if (lastActivity) setActivity(lastActivity).catch(() => {});
  if (voice.enabled) startVoice().catch((e) => emit('error', e.message));
  emit('status', status());
  return status();
}

// Podłącza gniazdo i wykonuje handshake; zwraca true, gdy Discord odpowie READY.
function attach(s, id) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (ok) => { if (!settled) { settled = true; clearTimeout(timer); resolve(ok); } };
    sock = s;
    let buf = Buffer.alloc(0);
    s.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 8) {
        const op = buf.readInt32LE(0);
        const len = buf.readInt32LE(4);
        if (buf.length < 8 + len) break;
        const body = buf.slice(8, 8 + len).toString('utf8');
        buf = buf.slice(8 + len);
        let msg = null;
        try { msg = JSON.parse(body); } catch {}
        dbg('recv', op, body.slice(0, 160));
        if (sock === s) onMessage(op, msg);
        if (ready) settle(true);
      }
    });
    s.on('close', () => {
      dbg('close', settled);
      if (!settled) { if (sock === s) sock = null; return settle(false); }
      if (sock !== s) return;
      const was = ready;
      ready = false;
      sock = null;
      voice.authed = false;
      voice.subscribed = null;
      for (const p of pending.values()) p.reject(new Error('Rozłączono z Discordem'));
      pending.clear();
      if (was) emit('status', status());
      scheduleReconnect();
    });
    s.on('error', () => {});
    const timer = setTimeout(() => { if (!settled) { dbg('handshake timeout'); lastCloseReason = 'Discord nie odpowiedział na czas'; s.destroy(); settle(false); } }, 20000);
    s.write(encode(OP.HANDSHAKE, { v: 1, client_id: id }));
  });
}

// ponawianie: szybko na początku (Discord może dopiero startować), potem rzadziej
function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  if (!clientId) return;
  reconnectTimer = setTimeout(() => {
    if (!sock && clientId) connect(clientId).catch((e) => emit('error', e.message));
  }, retryDelay);
  retryDelay = Math.min(retryDelay * 2, 30000);
}

function onMessage(op, msg) {
  if (op === OP.PING) { sock?.write(encode(OP.PONG, msg)); return; }
  if (op === OP.CLOSE) {
    lastCloseReason = msg?.message || 'Discord zamknął połączenie';
    if (ready) emit('error', lastCloseReason);
    sock?.destroy();
    return;
  }
  if (!msg) return;
  if (msg.cmd === 'DISPATCH' && msg.evt === 'READY') {
    ready = true;
    user = msg.data?.user || null;
    return;
  }
  if (msg.cmd === 'DISPATCH') return onEvent(msg.evt, msg.data);
  if (msg.nonce && pending.has(msg.nonce)) {
    const p = pending.get(msg.nonce);
    pending.delete(msg.nonce);
    if (msg.evt === 'ERROR') p.reject(new Error(msg.data?.message || 'Błąd Discorda'));
    else p.resolve(msg.data);
  }
}

function command(cmd, args = {}, evt) {
  if (!sock || !ready) return Promise.reject(new Error('Brak połączenia z Discordem'));
  const nonce = `jm-${Date.now()}-${++nonceN}`;
  return new Promise((resolve, reject) => {
    pending.set(nonce, { resolve, reject });
    sock.write(encode(OP.FRAME, { cmd, args, evt, nonce }));
    setTimeout(() => { if (pending.has(nonce)) { pending.delete(nonce); reject(new Error('Przekroczono czas: ' + cmd)); } }, cmd === 'AUTHORIZE' ? 120000 : 10000);
  });
}

async function setActivity(activity) {
  lastActivity = activity;
  if (!ready) return false;
  await command('SET_ACTIVITY', { pid: process.pid, activity: activity || undefined });
  return true;
}

function clearActivity() {
  return setActivity(null);
}

function disconnect(forget = true) {
  dbg('disconnect', forget);
  clearTimeout(reconnectTimer);
  if (forget) { clientId = null; lastActivity = null; }
  if (sock) { try { sock.destroy(); } catch {} }
  sock = null;
  ready = false;
}

function status() {
  return { connected: ready, user: user ? { id: user.id, name: user.global_name || user.username } : null, voice: { enabled: voice.enabled, authed: voice.authed, channelId: voice.channelId } };
}

// ---------------- głos: kto mówi ----------------
const tokenFile = () => path.join(app.getPath('userData'), 'discord-token.json');

async function exchange(params) {
  const res = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: voice.secret, ...params }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error('OAuth: ' + (j.error_description || j.error || res.status));
  j.expires_at = Date.now() + (j.expires_in - 60) * 1000;
  fs.writeFileSync(tokenFile(), JSON.stringify(j), { mode: 0o600 });
  return j;
}

async function getToken(interactive) {
  let t = null;
  try { t = JSON.parse(fs.readFileSync(tokenFile(), 'utf8')); } catch {}
  if (t && t.expires_at > Date.now()) return t.access_token;
  if (t?.refresh_token) {
    try { return (await exchange({ grant_type: 'refresh_token', refresh_token: t.refresh_token })).access_token; } catch {}
  }
  if (!interactive) throw new Error('AUTH_REQUIRED');
  const { code } = await command('AUTHORIZE', { client_id: clientId, scopes: ['rpc', 'rpc.voice.read'] });
  return (await exchange({ grant_type: 'authorization_code', code, redirect_uri: 'http://127.0.0.1' })).access_token;
}

async function startVoice(interactive = false) {
  voice.enabled = true;
  if (!ready) return status();
  if (!voice.secret) throw new Error('Do wykrywania mówienia potrzebny jest Client Secret');
  const token = await getToken(interactive);
  await command('AUTHENTICATE', { access_token: token });
  voice.authed = true;
  await command('SUBSCRIBE', {}, 'VOICE_CHANNEL_SELECT');
  const ch = await command('GET_SELECTED_VOICE_CHANNEL').catch(() => null);
  await watchChannel(ch?.id || null);
  emit('status', status());
  return status();
}

async function watchChannel(id) {
  if (voice.subscribed && voice.subscribed !== id) {
    for (const e of ['SPEAKING_START', 'SPEAKING_STOP']) await command('UNSUBSCRIBE', { channel_id: voice.subscribed }, e).catch(() => {});
    voice.subscribed = null;
  }
  voice.channelId = id;
  if (id && voice.subscribed !== id) {
    for (const e of ['SPEAKING_START', 'SPEAKING_STOP']) await command('SUBSCRIBE', { channel_id: id }, e);
    voice.subscribed = id;
  }
  emit('speaking-reset', {});
}

function onEvent(evt, data) {
  if (evt === 'VOICE_CHANNEL_SELECT') {
    watchChannel(data?.channel_id || null).then(() => emit('status', status())).catch((e) => emit('error', e.message));
  } else if (evt === 'SPEAKING_START' || evt === 'SPEAKING_STOP') {
    emit('speaking', { userId: data?.user_id, self: data?.user_id === user?.id, speaking: evt === 'SPEAKING_START' });
  }
}

async function configureVoice({ enabled, secret, interactive }) {
  voice.secret = secret || voice.secret;
  if (!enabled) {
    voice.enabled = false;
    if (voice.subscribed) await watchChannel(null).catch(() => {});
    return status();
  }
  return startVoice(interactive);
}

function forgetToken() {
  fs.rmSync(tokenFile(), { force: true });
  voice.authed = false;
}

module.exports = { setEmitter, connect, disconnect, setActivity, clearActivity, status, configureVoice, forgetToken };
