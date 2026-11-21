// Strona widżetu „WhatIsThatSong?” – działa w oknie na pulpicie (most window.jmw)
// albo w podglądzie w ustawieniach pluginu (iframe + postMessage).
import { FONTS, normalize } from './defaults.js';

const preview = new URLSearchParams(location.search).has('preview');
const chan = window.jmw && !preview
  ? { post: (m) => window.jmw.post(m), on: (fn) => window.jmw.onMessage(fn), resize: (w, h) => window.jmw.resize(w, h), focusApp: () => window.jmw.focusApp() }
  : {
    post: (m) => parent.postMessage({ src: 'wits', ...m }, '*'),
    on: (fn) => addEventListener('message', (e) => { if (e.source === parent && e.data?.src === 'wits-host') fn(e.data); }),
    resize: (w, h) => parent.postMessage({ src: 'wits', size: { w, h } }, '*'),
    focusApp: () => {},
  };

const ICONS = {
  play: '<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6" y="4" width="4.5" height="16" rx="1.2" fill="currentColor" stroke="none"/><rect x="13.5" y="4" width="4.5" height="16" rx="1.2" fill="currentColor" stroke="none"/>',
  next: '<path d="M5 5.2v13.6a.8.8 0 0 0 1.25.66l9.5-6.8a.8.8 0 0 0 0-1.32l-9.5-6.8A.8.8 0 0 0 5 5.2Z" fill="currentColor" stroke="none"/><rect x="17" y="4.5" width="2.6" height="15" rx="1" fill="currentColor" stroke="none"/>',
  prev: '<path d="M19 5.2v13.6a.8.8 0 0 1-1.25.66l-9.5-6.8a.8.8 0 0 1 0-1.32l9.5-6.8A.8.8 0 0 1 19 5.2Z" fill="currentColor" stroke="none"/><rect x="4.4" y="4.5" width="2.6" height="15" rx="1" fill="currentColor" stroke="none"/>',
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  heartFill: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" fill="currentColor"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
};
const svg = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[n]}</svg>`;

const root = document.getElementById('w');
root.innerHTML = `
  <div class="bgimg"></div>
  <div class="cover" title="Otwórz JustMusic"><img alt="" draggable="false"><div class="ph">${svg('music')}</div></div>
  <div class="info">
    <div class="status"><span class="viz"><i></i><i></i><i></i></span><span class="st-text">Teraz gra</span></div>
    <div class="title"><span></span></div>
    <div class="artist"></div>
    <div class="album"></div>
    <div class="next"></div>
  </div>
  <div class="ctl">
    <button class="b-like" title="Polub">${svg('heart')}</button>
    <button class="b-prev" title="Poprzedni">${svg('prev')}</button>
    <button class="b-play main" title="Odtwórz / pauza">${svg('play')}</button>
    <button class="b-next" title="Następny">${svg('next')}</button>
  </div>
  <div class="prog">
    <div class="bar"><i></i></div>
    <div class="times"><span class="t-cur">0:00</span><span class="t-dur">0:00</span></div>
  </div>`;
const $ = (s) => root.querySelector(s);
const el = {
  bg: $('.bgimg'), cover: $('.cover'), img: $('.cover img'), title: $('.title span'), titleBox: $('.title'), artist: $('.artist'), album: $('.album'),
  next: $('.next'), st: $('.st-text'), bar: $('.bar'), fill: $('.bar i'), cur: $('.t-cur'), dur: $('.t-dur'),
  like: $('.b-like'), play: $('.b-play'), prev: $('.b-prev'), nextBtn: $('.b-next'),
};

let cfg = normalize({});
let theme = {};
let st = { track: null, playing: false, time: 0, duration: 0, at: Date.now(), liked: false, next: null };

const fmt = (s) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  s = Math.floor(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};

// ---------- wygląd ----------
function applyConfig() {
  const s = cfg.style;
  const r = document.documentElement.style;
  const custom = s.colors === 'custom';
  r.setProperty('--bg', custom ? s.bg : theme.surface || theme.bg || s.bg);
  r.setProperty('--text', custom ? s.text : theme.text || s.text);
  r.setProperty('--dim', custom ? s.dim : theme.dim || s.dim);
  r.setProperty('--accent', custom ? s.accent : theme.accent || s.accent);
  r.setProperty('--accent-text', custom ? (lum(s.accent) > 0.45 ? '#111' : '#fff') : theme.accentText || '#fff');
  r.setProperty('--app-font', theme.font || 'system-ui, sans-serif');
  r.setProperty('--font', (FONTS[s.font] || FONTS.app)[1]);
  r.setProperty('--bga', `${Math.max(0, Math.min(100, s.bgOpacity))}%`);
  r.setProperty('--radius', `${s.radius}px`);
  r.setProperty('--width', `${s.width / 14}rem`);
  document.documentElement.style.fontSize = `${(14 * s.scale) / 100}px`;
  const pad = s.shadow ? 16 : 2;
  document.body.style.padding = `${pad}px`;

  root.className = [
    'w', `layout-${cfg.layout}`, `align-${s.align}`, `shape-${s.coverShape}`, `ctl-${s.controls}`,
    s.shadow && 'shadow', s.border && 'border', s.textShadow && 'tshadow', s.bold && 'bold', s.coverBg && 'coverbg',
    cfg.behavior.locked || preview ? 'locked' : 'drag', preview && 'preview',
    ...Object.entries(cfg.show).filter(([, v]) => !v).map(([k]) => `no-${k}`),
  ].filter(Boolean).join(' ');
  render();
}

function lum(hex) {
  const m = String(hex).replace('#', '').match(/.{2}/g);
  if (!m || m.length < 3) return 0;
  const [r, g, b] = m.map((x) => parseInt(x, 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

let lastThumb;
let imgFailed = false;
function render() {
  const t = st.track;
  root.classList.toggle('idle', !t);
  root.classList.toggle('playing', !!st.playing);
  el.title.textContent = t ? t.title || 'Bez tytułu' : 'Nic nie gra';
  el.artist.textContent = t ? t.artist || '' : 'Włącz muzykę w JustMusic';
  el.album.textContent = t?.album || '';
  el.album.hidden = !t?.album;
  el.next.textContent = st.next ? `Następnie: ${st.next.title}${st.next.artist ? ' – ' + st.next.artist : ''}` : '';
  el.next.hidden = !st.next;
  el.st.textContent = !t ? 'WhatIsThatSong?' : st.playing ? 'Teraz gra' : 'Pauza';
  el.play.innerHTML = svg(st.playing ? 'pause' : 'play');
  el.like.innerHTML = svg(st.liked ? 'heartFill' : 'heart');
  el.like.classList.toggle('on', !!st.liked);
  el.like.hidden = !t;
  const thumb = t?.thumb || null;
  if (thumb !== lastThumb) {
    lastThumb = thumb;
    imgFailed = false;
    if (thumb) el.img.src = thumb; else el.img.removeAttribute('src');
    el.bg.style.backgroundImage = thumb ? `url("${String(thumb).replace(/"/g, '%22')}")` : '';
  }
  root.classList.toggle('noimg', !thumb || imgFailed);
  tick();
  requestAnimationFrame(() => { marquee(); fit(); });
}

el.img.addEventListener('error', () => { if (!el.img.getAttribute('src')) return; imgFailed = true; root.classList.add('noimg'); });

function marquee() {
  const box = el.titleBox, span = el.title;
  box.classList.remove('scroll');
  span.style.removeProperty('--d');
  if (!cfg.style.marquee) return;
  const over = span.scrollWidth - box.clientWidth;
  if (over > 4) {
    span.style.setProperty('--d', `${-over - 16}px`);
    span.style.setProperty('--dur', `${Math.max(6, over / 18 + 4)}s`);
    box.classList.add('scroll');
  }
}

// ---------- postęp ----------
function position() {
  const p = st.playing ? st.time + (Date.now() - st.at) / 1000 : st.time;
  return st.duration ? Math.min(st.duration, p) : p;
}
function tick() {
  const p = position();
  el.fill.style.width = st.duration ? `${(p / st.duration) * 100}%` : '0%';
  el.cur.textContent = fmt(p);
  el.dur.textContent = fmt(st.duration);
}
setInterval(() => { if (st.playing) tick(); }, 250);

// ---------- rozmiar okna = rozmiar treści ----------
let lastSize = '';
function fit() {
  const r = root.getBoundingClientRect();
  const pad = parseFloat(getComputedStyle(document.body).paddingLeft) || 0;
  const w = Math.ceil(r.width + pad * 2), h = Math.ceil(r.height + pad * 2);
  const k = `${w}x${h}`;
  if (k === lastSize || !r.width) return;
  lastSize = k;
  chan.resize(w, h);
}
new ResizeObserver(() => fit()).observe(root);

// ---------- sterowanie ----------
const cmd = (c, extra) => chan.post({ cmd: c, ...extra });
el.play.addEventListener('click', () => { st.playing = !st.playing; st.time = position(); st.at = Date.now(); render(); cmd('toggle'); });
el.prev.addEventListener('click', () => cmd('prev'));
el.nextBtn.addEventListener('click', () => cmd('next'));
el.like.addEventListener('click', () => { st.liked = !st.liked; render(); cmd('like'); });
el.cover.addEventListener('click', () => chan.focusApp());
el.bar.addEventListener('click', (e) => {
  const r = el.bar.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  if (st.duration) { st.time = ratio * st.duration; st.at = Date.now(); tick(); }
  cmd('seek', { ratio });
});
root.addEventListener('wheel', (e) => { e.preventDefault(); cmd('volume', { delta: e.deltaY < 0 ? 0.05 : -0.05 }); }, { passive: false });

chan.on((m) => {
  if (m.t === 'config') {
    cfg = normalize(m.w);
    theme = m.theme || {};
    applyConfig();
  } else if (m.t === 'state') {
    st = { ...st, ...m, at: Date.now() };
    render();
  }
});
chan.post({ cmd: 'ready' });
applyConfig();
