// Strona widżetu „WhatIsThatSong?” – działa w oknie na pulpicie (most window.jmw)
// albo w podglądzie w ustawieniach pluginu (iframe + postMessage).
import { FONTS, normalize } from './defaults.js';

const preview = new URLSearchParams(location.search).has('preview');
const isPopup = document.body.classList.contains('popup');
if (preview) document.body.classList.add('preview');
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
  volume: '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>',
  volumeLow: '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>',
  mute: '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/>',
  seek: '<path d="M13 19V5l9 7-9 7Z" fill="currentColor" stroke="none"/><path d="M3 19V5l9 7-9 7Z" fill="currentColor" stroke="none"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  fwd10: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  back10: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  back: '<path d="M11 19V5l-9 7 9 7Z" fill="currentColor" stroke="none"/><path d="M21 19V5l-9 7 9 7Z" fill="currentColor" stroke="none"/>',
};
const svg = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[n]}</svg>`;

const root = document.getElementById('w');
root.innerHTML = `
  <div class="bgimg"></div>
  <div class="cover" title="Otwórz JustMusic"><img alt="" draggable="false"><div class="ph">${svg('music')}</div></div>
  <div class="info">
    <div class="status"><span class="viz"><i></i><i></i><i></i></span><span class="st-text">Teraz gra</span></div>
    <div class="title"><span></span></div>
    <div class="artist" title="Pokaż wykonawcę"></div>
    <div class="album"></div>
    <div class="next"></div>
  </div>
  <div class="ctl">
    <button class="b-like" title="Polub">${svg('heart')}</button>
    <button class="b-prev" title="Poprzedni">${svg('prev')}</button>
    <button class="b-back sk" title="Cofnij 10 s">${svg('back10')}<b>10</b></button>
    <button class="b-play main" title="Odtwórz / pauza">${svg('play')}</button>
    <button class="b-fwd sk" title="Do przodu 10 s">${svg('fwd10')}<b>10</b></button>
    <button class="b-next" title="Następny">${svg('next')}</button>
    <button class="b-artist" title="Pokaż wykonawcę">${svg('user')}</button>
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
  back: $('.b-back'), fwd: $('.b-fwd'), artistBtn: $('.b-artist'), prog: $('.prog'),
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
    cfg.behavior.locked || preview || isPopup ? 'locked' : 'drag', preview && 'preview',
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
  el.artistBtn.hidden = !t?.artist;
  root.classList.toggle('has-artist', !!t?.artist);
  const thumb = t?.thumb || null;
  if (thumb !== lastThumb) {
    lastThumb = thumb;
    imgFailed = false;
    if (thumb) el.img.src = thumb; else el.img.removeAttribute('src');
    el.bg.style.backgroundImage = thumb ? `url("${String(thumb).replace(/"/g, '%22')}")` : '';
  }
  root.classList.toggle('noimg', !thumb || imgFailed);
  tick();
  fit();
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
  if (seeking) return;
  const p = position();
  el.fill.style.width = st.duration ? `${(p / st.duration) * 100}%` : '0%';
  el.cur.textContent = fmt(p);
  el.dur.textContent = fmt(st.duration);
}
setInterval(() => { if (st.playing) tick(); }, 250);

// ---------- rozmiar okna = rozmiar treści ----------
let lastSize = '';
function fit() {
  const target = isPopup && document.body.dataset.kind === 'osd' ? osd.box : root;
  const r = target.getBoundingClientRect();
  const pad = parseFloat(getComputedStyle(document.body).paddingLeft) || 0;
  const w = Math.ceil(r.width + pad * 2), h = Math.ceil(r.height + pad * 2);
  const k = `${w}x${h}`;
  if (k === lastSize || !r.width) return;
  lastSize = k;
  chan.resize(w, h);
}
new ResizeObserver(() => fit()).observe(root);

// ---------- popup (popup.html) ----------
const osd = {
  box: document.getElementById('osd'),
  ic: document.querySelector('.osd-ic'), text: document.querySelector('.osd-text'),
  sub: document.querySelector('.osd-sub'), fill: document.querySelector('.osd-bar i'),
};
let popTimer = null;
let popDur = 5000;
let popState = 'off'; // off | in | out
function popShow(m) {
  const b = document.body;
  b.dataset.kind = m.kind === 'osd' ? 'osd' : 'track';
  b.dataset.anim = m.anim || 'slide';
  b.dataset.from = m.from || 'right';
  if (m.kind === 'osd' && m.osd) {
    osd.ic.innerHTML = svg(ICONS[m.osd.icon] ? m.osd.icon : 'music');
    osd.text.textContent = m.osd.text || '';
    osd.sub.textContent = m.osd.sub || '';
    const hasBar = Number.isFinite(m.osd.value);
    osd.box.classList.toggle('nobar', !hasBar);
    if (hasBar) osd.fill.style.width = `${Math.max(0, Math.min(1, m.osd.value)) * 100}%`;
  }
  lastSize = '';
  fit();
  // ten sam rodzaj popupu, który już jest na ekranie – tylko odświeżamy treść i czas
  if (popState !== 'in') {
    b.classList.remove('in', 'out');
    void b.offsetWidth;
    b.classList.add('in');
    popState = 'in';
  }
  popDur = Math.max(800, m.duration || 5000);
  armTimer(popDur);
}
function armTimer(ms) {
  clearTimeout(popTimer);
  popTimer = setTimeout(popHide, ms);
}
function popHide() {
  clearTimeout(popTimer);
  if (popState !== 'in') return;
  popState = 'out';
  const b = document.body;
  b.classList.remove('in');
  b.classList.add('out');
  setTimeout(() => { if (popState === 'out') { popState = 'off'; b.classList.remove('out'); chan.post({ cmd: 'popupDone' }); } }, b.dataset.anim === 'none' ? 0 : 230);
}
if (isPopup && !preview) {
  // najechanie myszką zatrzymuje chowanie
  document.body.addEventListener('mouseenter', () => { if (popState === 'in') clearTimeout(popTimer); });
  document.body.addEventListener('mouseleave', () => { if (popState === 'in') armTimer(1500); });
  osd.box.addEventListener('click', popHide);
}

// ---------- sterowanie ----------
const cmd = (c, extra) => chan.post({ cmd: c, ...extra });
el.play.addEventListener('click', () => { st.playing = !st.playing; st.time = position(); st.at = Date.now(); render(); cmd('toggle'); });
el.prev.addEventListener('click', () => cmd('prev'));
el.nextBtn.addEventListener('click', () => cmd('next'));
el.like.addEventListener('click', () => { st.liked = !st.liked; render(); cmd('like'); });
el.cover.addEventListener('click', () => chan.focusApp());
// przewijanie: kliknięcie albo przeciągnięcie po pasku (podczas przeciągania widać czas)
let seeking = false;
const ratioAt = (e) => { const r = el.bar.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); };
const showSeek = (ratio) => {
  el.fill.style.width = `${ratio * 100}%`;
  if (st.duration) el.cur.textContent = fmt(ratio * st.duration);
};
el.bar.addEventListener('pointerdown', (e) => {
  if (!st.track || e.button !== 0) return;
  e.preventDefault();
  seeking = true;
  root.classList.add('seeking');
  try { el.bar.setPointerCapture(e.pointerId); } catch {}
  showSeek(ratioAt(e));
});
el.bar.addEventListener('pointermove', (e) => { if (seeking) showSeek(ratioAt(e)); });
const endSeek = (e, apply) => {
  if (!seeking) return;
  seeking = false;
  root.classList.remove('seeking');
  if (!apply) return tick();
  const ratio = ratioAt(e);
  if (st.duration) { st.time = ratio * st.duration; st.at = Date.now(); }
  tick();
  cmd('seek', { ratio });
};
el.bar.addEventListener('pointerup', (e) => endSeek(e, true));
el.bar.addEventListener('pointercancel', (e) => endSeek(e, false));
const skip = (d) => {
  if (!st.track) return;
  const p = position() + d;
  st.time = Math.max(0, st.duration ? Math.min(st.duration, p) : p);
  st.at = Date.now();
  tick();
  cmd('seekBy', { delta: d });
};
el.back.addEventListener('click', () => skip(-10));
el.fwd.addEventListener('click', () => skip(10));
// profil wykonawcy – otwiera JustMusic na stronie wykonawcy
const openArtist = () => { if (!st.track?.artist || preview) return; chan.focusApp(); cmd('artist'); };
el.artistBtn.addEventListener('click', openArtist);
el.artist.addEventListener('click', openArtist);
root.addEventListener('wheel', (e) => { e.preventDefault(); cmd('volume', { delta: e.deltaY < 0 ? 0.05 : -0.05 }); }, { passive: false });

// język interfejsu (JustMusic 1.6+; na starszych wersjach zostaje polski)
let langSet = false;
function setLang(code) {
  if (langSet || !code || code === 'pl') return;
  langSet = true;
  import('/js/i18n.js').then((m) => m.setupI18n(code)).catch(() => {});
}

chan.on((m) => {
  if (m.t === 'config') {
    cfg = normalize(m.w);
    theme = m.theme || {};
    setLang(m.lang);
    applyConfig();
  } else if (m.t === 'state') {
    st = { ...st, ...m, at: Date.now() };
    render();
  } else if (m.t === 'show' && isPopup) {
    popShow(m);
  } else if (m.t === 'hide' && isPopup) {
    popHide();
  }
});
chan.post({ cmd: 'ready' });
applyConfig();
