// Minimalny klient MQTT 3.1.1 przez WebSocket (QoS 0, retain, last will) – bez bibliotek.
const te = new TextEncoder();
const td = new TextDecoder();

function varLen(n) {
  const out = [];
  do { let b = n % 128; n = Math.floor(n / 128); if (n > 0) b |= 0x80; out.push(b); } while (n > 0);
  return out;
}
const str = (s) => { const b = te.encode(s); return [b.length >> 8, b.length & 255, ...b]; };
function packet(type, body) {
  const out = new Uint8Array(1 + varLen(body.length).length + body.length);
  const len = varLen(body.length);
  out[0] = type;
  out.set(len, 1);
  out.set(body, 1 + len.length);
  return out;
}
const concat = (...parts) => {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const o = new Uint8Array(n);
  let i = 0;
  for (const p of parts) { o.set(p, i); i += p.length; }
  return o;
};

/**
 * Połączenie z jednym brokerem. Wznawia się samo po zerwaniu.
 * opts: { url, clientId, will?: { topic, payload: Uint8Array, retain }, onMessage(topic, payload, retained), onState(connected) }
 */
export class MqttConn {
  constructor(opts) {
    this.o = opts;
    this.subs = new Set();
    this.connected = false;
    this.closed = false;
    this.pid = 1;
    this.retry = 1000;
    this.open();
  }

  open() {
    if (this.closed) return;
    let ws;
    try { ws = new WebSocket(this.o.url, ['mqtt']); } catch { this.later(); return; }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    this.buf = new Uint8Array(0);
    ws.onopen = () => {
      const will = this.o.will;
      const flags = 0x02 | (will ? 0x04 | (will.retain ? 0x20 : 0) : 0);
      const body = [...str('MQTT'), 4, flags, 0, 30, ...str(this.o.clientId)];
      const willPart = will ? concat(new Uint8Array(str(will.topic)), new Uint8Array([will.payload.length >> 8, will.payload.length & 255]), will.payload) : new Uint8Array(0);
      ws.send(packet(0x10, concat(new Uint8Array(body), willPart)));
    };
    ws.onmessage = (e) => { this.buf = concat(this.buf, new Uint8Array(e.data)); this.parse(); };
    ws.onclose = () => { this.setConnected(false); clearInterval(this.ping); this.later(); };
    ws.onerror = () => {};
  }

  later() {
    if (this.closed) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.open(), this.retry);
    this.retry = Math.min(this.retry * 2, 30000);
  }

  setConnected(v) {
    if (this.connected === v) return;
    this.connected = v;
    this.o.onState?.(v);
  }

  parse() {
    while (this.buf.length >= 2) {
      let mult = 1, len = 0, i = 1, b;
      do {
        if (i >= this.buf.length) return;
        b = this.buf[i++];
        len += (b & 127) * mult;
        mult *= 128;
      } while (b & 128);
      if (this.buf.length < i + len) return;
      const type = this.buf[0];
      const body = this.buf.subarray(i, i + len);
      this.buf = this.buf.slice(i + len);
      this.handle(type, body);
    }
  }

  handle(type, body) {
    const kind = type >> 4;
    if (kind === 2) { // CONNACK
      if (body[1] !== 0) { this.ws.close(); return; }
      this.retry = 1000;
      this.setConnected(true);
      for (const t of this.subs) this.sendSub(t);
      clearInterval(this.ping);
      this.ping = setInterval(() => this.raw(new Uint8Array([0xc0, 0])), 20000);
    } else if (kind === 3) { // PUBLISH
      const qos = (type >> 1) & 3;
      const tl = (body[0] << 8) | body[1];
      const topic = td.decode(body.subarray(2, 2 + tl));
      const start = 2 + tl + (qos ? 2 : 0);
      this.o.onMessage?.(topic, body.slice(start), !!(type & 1));
    }
  }

  raw(bytes) {
    if (this.ws?.readyState === 1) { this.ws.send(bytes); return true; }
    return false;
  }

  sendSub(topic) {
    const id = this.pid++ & 0xffff || 1;
    this.raw(packet(0x82, new Uint8Array([id >> 8, id & 255, ...str(topic), 0])));
  }

  subscribe(topic) {
    this.subs.add(topic);
    if (this.connected) this.sendSub(topic);
  }

  publish(topic, payload, retain = false) {
    if (!this.connected) return false;
    return this.raw(packet(0x30 | (retain ? 1 : 0), concat(new Uint8Array(str(topic)), payload)));
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
    clearInterval(this.ping);
    if (this.connected) this.raw(new Uint8Array([0xe0, 0])); // DISCONNECT – bez last will
    try { this.ws?.close(); } catch {}
    this.setConnected(false);
  }
}
