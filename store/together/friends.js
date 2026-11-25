// Znajomi: „co teraz słuchają”. Każdy ma własny kod znajomego – z niego wynika temat na brokerze
// MQTT i klucz szyfrowania. Swój status publikujesz (zaszyfrowany, „retained”) na swoim temacie,
// a znajomi, którzy znają Twój kod, go czytają. Bez kont i bez własnego serwera – jak pokoje.
import { MqttConn } from './mqtt.js';
import { BROKERS } from './room.js';

const te = new TextEncoder();
const td = new TextDecoder();
const rnd = (n) => crypto.getRandomValues(new Uint8Array(n));
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const sha = async (s) => new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(s)));

async function channel(code) {
  const c = code.replace('-', '');
  return {
    topic: 'justmusic/v1/f/' + hex(await sha('jm-friend-topic|' + c)).slice(0, 32),
    key: await crypto.subtle.importKey('raw', await sha('jm-friend-key|' + c), 'AES-GCM', false, ['encrypt', 'decrypt']),
  };
}

async function seal(key, obj) {
  const iv = rnd(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify(obj))));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}
async function unseal(key, bytes) {
  if (!bytes || bytes.length < 13) return null;
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, key, bytes.subarray(12));
    return JSON.parse(td.decode(pt));
  } catch { return null; }
}

/**
 * opts: { id, code (mój kod), brokers?, onStatus(code, status|null) }
 */
export class FriendsNet {
  static async open(opts) {
    const me = await channel(opts.code);
    const net = new FriendsNet(opts, me);
    await net.connect();
    return net;
  }

  constructor(opts, me) {
    this.o = opts;
    this.me = me;
    this.follows = new Map(); // topic -> { code, key, at }
    this.conns = [];
  }

  async connect() {
    // gdy aplikacja zniknie bez pożegnania, broker sam ogłosi „offline”
    const will = { topic: this.me.topic, payload: await seal(this.me.key, { off: true, at: Date.now() }), retain: true };
    const urls = this.o.brokers?.length ? this.o.brokers : BROKERS;
    this.conns = urls.map((url, i) => new MqttConn({
      url,
      clientId: `jmf-${this.o.id}-${i}`,
      will,
      onState: (up) => {
        if (!up) return;
        const c = this.conns[i];
        for (const t of this.follows.keys()) c?.subscribe(t);
        if (this.last) c?.publish(this.me.topic, this.last, true);
      },
      onMessage: async (topic, payload) => {
        const f = this.follows.get(topic);
        if (!f) return;
        if (!payload.length) { this.o.onStatus?.(f.code, null); return; }
        const msg = await unseal(f.key, payload);
        if (!msg || typeof msg.at !== 'number') return;
        // „ostatnia wola” (off) ma datę z chwili połączenia – przyjmujemy ją mimo starszej daty
        const lateWill = msg.off && !f.off;
        if (msg.at <= f.at && !lateWill) return; // ta sama albo starsza wiadomość z innego brokera
        f.at = Math.max(f.at, msg.at);
        f.off = !!msg.off;
        this.o.onStatus?.(f.code, msg);
      },
    }));
  }

  get links() { return this.conns.filter((c) => c.connected).length; }

  /** mój status (retained – znajomi zobaczą go od razu po połączeniu) */
  async publish(status) {
    this.last = await seal(this.me.key, { ...status, at: Date.now() });
    for (const c of this.conns) c.publish(this.me.topic, this.last, true);
  }

  async follow(code) {
    const ch = await channel(code);
    if (this.follows.has(ch.topic)) return;
    this.follows.set(ch.topic, { code, key: ch.key, at: 0 });
    for (const c of this.conns) c.subscribe(ch.topic);
  }

  async unfollow(code) {
    const ch = await channel(code);
    this.follows.delete(ch.topic);
    // klient MQTT nie ma UNSUBSCRIBE – wiadomości z tego tematu są po prostu ignorowane
  }

  close() {
    for (const c of this.conns) c.close();
    this.conns = [];
  }
}
