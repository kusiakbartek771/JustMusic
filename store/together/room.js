// Pokój „CanWeListenTogether”: szyfrowana szyna wiadomości na publicznych brokerach MQTT.
// Kod pokoju jest jednocześnie kluczem – serwery widzą tylko losowy temat i zaszyfrowane bajty.
// Łączymy się z kilkoma brokerami naraz (odporność na awarie), duplikaty są odrzucane.
import { MqttConn } from './mqtt.js';

export const BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
];

const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // bez 0/O, 1/I/L
const te = new TextEncoder();
const td = new TextDecoder();

const rnd = (n) => crypto.getRandomValues(new Uint8Array(n));
export function randomId(len = 10) {
  return [...rnd(len)].map((b) => ALPHA[b % ALPHA.length]).join('').toLowerCase();
}
export function newCode() {
  const c = [...rnd(8)].map((b) => ALPHA[b % ALPHA.length]).join('');
  return c.slice(0, 4) + '-' + c.slice(4);
}
/** Normalizuje wpisany kod („abcd efgh”, link z kodem…) → „ABCD-EFGH” albo null */
export function normCode(s) {
  const m = String(s || '').toUpperCase().match(/(?<![A-Z0-9])[A-Z0-9]{4}[-\s]?[A-Z0-9]{4}(?![A-Z0-9])/);
  if (!m) return null;
  const c = m[0].replace(/[-\s]/, '');
  if (![...c].every((ch) => ALPHA.includes(ch))) return null;
  return c.slice(0, 4) + '-' + c.slice(4);
}

async function sha(s) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(s)));
}
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

export class Room {
  /**
   * opts: { code, id, role: 'host'|'guest', brokers?, onMessage(chan, msg, retained), onLinks(count) }
   */
  static async open(opts) {
    const code = opts.code.replace('-', '');
    const topic = 'justmusic/v1/' + hex(await sha('jm-together-topic|' + code)).slice(0, 32);
    const key = await crypto.subtle.importKey('raw', await sha('jm-together-key|' + code), 'AES-GCM', false, ['encrypt', 'decrypt']);
    const room = new Room(opts, topic, key);
    await room.connect();
    return room;
  }

  constructor(opts, topic, key) {
    this.o = opts;
    this.topic = topic;
    this.key = key;
    this.conns = [];
    this.seen = new Map();
  }

  async seal(obj) {
    const iv = rnd(12);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.key, te.encode(JSON.stringify(obj))));
    const out = new Uint8Array(12 + ct.length);
    out.set(iv);
    out.set(ct, 12);
    return out;
  }

  async unseal(bytes) {
    if (bytes.length < 13) return null;
    const tag = hex(bytes.subarray(0, 12));
    if (this.seen.has(tag)) return null; // ta sama wiadomość z drugiego brokera
    try {
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, this.key, bytes.subarray(12));
      this.seen.set(tag, Date.now());
      if (this.seen.size > 400) for (const k of [...this.seen.keys()].slice(0, 200)) this.seen.delete(k);
      return JSON.parse(td.decode(pt));
    } catch {
      return null; // nie nasz klucz / uszkodzone
    }
  }

  async connect() {
    const { id, role } = this.o;
    // „ostatnia wola”: broker sam ogłosi zniknięcie, gdy aplikacja padnie bez pożegnania
    const will = role === 'host'
      ? { topic: this.topic + '/s', payload: await this.seal({ k: 'end', lost: true, from: id }), retain: true }
      : { topic: this.topic + '/e', payload: await this.seal({ k: 'bye', lost: true, from: id }), retain: false };
    const urls = (this.o.brokers?.length ? this.o.brokers : BROKERS);
    this.conns = urls.map((url, i) => {
      const c = new MqttConn({
        url,
        clientId: `jm-${id}-${i}`,
        will,
        onState: (up) => { if (up) { c.subscribe(this.topic + '/s'); c.subscribe(this.topic + '/e'); } this.o.onLinks?.(this.links, up); },
        onMessage: async (topic, payload, retained) => {
          const msg = await this.unseal(payload);
          if (!msg || msg.from === id) return;
          this.o.onMessage?.(topic.endsWith('/s') ? 's' : 'e', msg, retained);
        },
      });
      return c;
    });
  }

  get links() {
    return this.conns.filter((c) => c.connected).length;
  }

  /** chan: 's' (stan pokoju, od gospodarza) albo 'e' (zdarzenia od wszystkich) */
  async send(chan, obj, retain = false) {
    if (!this.links) return false;
    const bytes = await this.seal({ ...obj, from: this.o.id });
    for (const c of this.conns) c.publish(this.topic + '/' + chan, bytes, retain);
    return true;
  }

  /** usuwa zapamiętany stan pokoju z serwerów */
  clearRetained() {
    for (const c of this.conns) c.publish(this.topic + '/s', new Uint8Array(0), true);
  }

  close() {
    for (const c of this.conns) c.close();
    this.conns = [];
  }
}
