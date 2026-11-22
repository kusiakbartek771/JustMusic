// Okno mini odtwarzacza – tylko wyświetla stan i odsyła polecenia do aplikacji.
import { icon } from './icons.js';
import { setupI18n } from './i18n.js';

const $ = (id) => document.getElementById(id);
const M = window.mini;
let st = {};
let lastThumb = null;
let dragging = false;

const fmt = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};

$('prev').innerHTML = icon('prev');
$('next').innerHTML = icon('next');
$('expand').innerHTML = icon('maximize');
$('close').innerHTML = icon('x');
$('pin').innerHTML = icon('pin');
$('size').innerHTML = icon('pip');
$('cover').querySelector('.ph').innerHTML = icon('music');

const cmd = (c, a) => M.cmd(c, a);
$('play').onclick = () => cmd('toggle');
$('prev').onclick = () => cmd('prev');
$('next').onclick = () => cmd('next');
$('like').onclick = () => cmd('like');
$('vol').onclick = () => cmd('mute');
$('pin').onclick = () => cmd('pin');
$('expand').onclick = () => cmd('expand');
$('close').onclick = () => cmd('close');
$('size').onclick = () => cmd('size', document.body.classList.contains('big') ? 'small' : 'big');
$('cover').ondblclick = () => cmd('expand');

// przewijanie kliknięciem / przeciągnięciem po pasku
const bar = $('bar');
const ratioAt = (e) => { const r = bar.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
bar.addEventListener('pointerdown', (e) => {
  if (!st.dur) return;
  dragging = true;
  bar.setPointerCapture(e.pointerId);
  $('fill').style.width = ratioAt(e) * 100 + '%';
});
bar.addEventListener('pointermove', (e) => { if (dragging) { $('fill').style.width = ratioAt(e) * 100 + '%'; $('t0').textContent = fmt(ratioAt(e) * st.dur); } });
bar.addEventListener('pointerup', (e) => {
  if (!dragging) return;
  dragging = false;
  const t = ratioAt(e) * st.dur;
  st.time = t;
  cmd('seek', t);
});

// kółko myszy: głośność
let volHide = null;
document.addEventListener('wheel', (e) => {
  e.preventDefault();
  const v = Math.max(0, Math.min(1, (st.muted ? 0 : st.vol ?? 0.8) + (e.deltaY < 0 ? 0.05 : -0.05)));
  st.vol = v; st.muted = false;
  cmd('volume', v);
  drawVol(true);
}, { passive: false });

function drawVol(show) {
  const v = st.muted ? 0 : st.vol ?? 0.8;
  $('vol').innerHTML = icon(v === 0 ? 'mute' : v < 0.4 ? 'volumeLow' : 'volume');
  $('volfill').style.width = v * 100 + '%';
  if (show) {
    document.body.classList.add('showvol');
    clearTimeout(volHide);
    volHide = setTimeout(() => document.body.classList.remove('showvol'), 1000);
  }
}

function applyTheme(t) {
  if (!t) return;
  const r = document.documentElement.style;
  for (const [k, v] of Object.entries(t)) if (v) r.setProperty('--' + k, v);
}

function drawTime() {
  if (dragging) return;
  const d = st.dur || 0;
  $('t0').textContent = fmt(st.time);
  $('t1').textContent = fmt(d);
  $('fill').style.width = d ? Math.min(100, (st.time / d) * 100) + '%' : '0%';
}

function draw() {
  applyTheme(st.theme);
  document.body.classList.toggle('empty', !st.has);
  $('title').textContent = st.has ? st.title : 'Nic nie gra';
  $('title').title = st.title || '';
  $('artist').textContent = st.artist || '';
  if (st.thumb !== lastThumb) {
    lastThumb = st.thumb;
    const img = $('cover').querySelector('img');
    document.body.classList.toggle('noimg', !st.thumb);
    if (st.thumb) {
      img.onerror = () => document.body.classList.add('noimg');
      img.src = st.thumb;
      $('bg').style.backgroundImage = `url("${st.thumb.replace(/"/g, '%22')}")`;
    } else {
      img.removeAttribute('src');
      $('bg').style.backgroundImage = '';
    }
  }
  $('play').innerHTML = st.loading && st.has ? '<div class="spin"></div>' : icon(st.playing ? 'pause' : 'play');
  $('like').innerHTML = icon(st.liked ? 'heartFill' : 'heart');
  $('like').classList.toggle('on', !!st.liked);
  $('pin').classList.toggle('on', !!st.onTop);
  document.body.classList.toggle('playing', !!st.playing);
  drawVol(false);
  drawTime();
  marquee();
}

// zbyt długi tytuł przewija się
function marquee() {
  const el = $('title');
  el.classList.remove('scroll');
  el.style.removeProperty('--shift');
  requestAnimationFrame(() => {
    const over = el.scrollWidth - el.clientWidth;
    if (over > 4) {
      el.style.setProperty('--shift', `-${over + 12}px`);
      el.style.setProperty('--dur', `${Math.max(6, over / 18)}s`);
      el.classList.add('scroll');
    }
  });
}

// układ zależny od rozmiaru okna
const layout = () => document.body.classList.toggle('big', innerHeight >= 220 && innerHeight > innerWidth * 0.6);
addEventListener('resize', () => { layout(); marquee(); });
layout();

// lokalny zegar między aktualizacjami, żeby pasek postępu był płynny
let lastTick = performance.now();
setInterval(() => {
  const n = performance.now();
  if (st.playing && !st.loading && st.dur) st.time = Math.min(st.dur, (st.time || 0) + (n - lastTick) / 1000);
  lastTick = n;
  drawTime();
}, 250);

let lastKey = '';
let langSet = false;
M.onState((s) => {
  if (s.lang && !langSet) { langSet = true; setupI18n(s.lang); }
  const key = `${s.id}|${s.title}|${s.playing}|${s.loading}|${s.liked}|${s.thumb}|${s.onTop}|${s.vol}|${s.muted}|${JSON.stringify(s.theme || null)}`;
  st = { ...st, ...s };
  lastTick = performance.now();
  if (key !== lastKey || s.has !== undefined) { lastKey = key; draw(); } else drawTime();
});

document.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); cmd('toggle'); }
  else if (e.key === 'ArrowRight') cmd(e.ctrlKey ? 'next' : 'seekBy', 5);
  else if (e.key === 'ArrowLeft') e.ctrlKey ? cmd('prev') : cmd('seekBy', -5);
  else if (e.key === 'Escape') cmd('expand');
});

M.ready();
