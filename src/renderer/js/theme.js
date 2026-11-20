// Motywy, style i układ paneli – wszystko sterowane zmiennymi CSS i atrybutami.
import { S, on, saveSettings, emit } from './state.js';

export const VAR_KEYS = [
  ['bg', 'Tło'], ['surface', 'Panele'], ['surface-2', 'Panele (2)'], ['elevated', 'Menu / wyróżnienie'],
  ['text', 'Tekst'], ['text-dim', 'Tekst drugorzędny'], ['accent', 'Akcent'], ['accent-text', 'Tekst na akcencie'], ['border', 'Obramowania'],
];

export const PRESETS = {
  midnight: { name: 'Midnight', bg: '#0d0e12', surface: '#15171d', 'surface-2': '#1c1f27', elevated: '#252935', text: '#eef0f6', 'text-dim': '#8b91a3', accent: '#7c5cff', 'accent-text': '#ffffff', border: '#262a35' },
  oled: { name: 'OLED Black', bg: '#000000', surface: '#08080a', 'surface-2': '#121215', elevated: '#1c1c21', text: '#ffffff', 'text-dim': '#8a8a94', accent: '#00e0a4', 'accent-text': '#00140e', border: '#1d1d22' },
  fjord: { name: 'Fjord', bg: '#1d222b', surface: '#242a35', 'surface-2': '#2b3240', elevated: '#353d4d', text: '#e5e9f0', 'text-dim': '#97a2b4', accent: '#88c0d0', 'accent-text': '#0f141a', border: '#343c4b' },
  grape: { name: 'Neon Grape', bg: '#120e1c', surface: '#1a1528', 'surface-2': '#231c35', elevated: '#2d2443', text: '#f3eefe', 'text-dim': '#9e92bc', accent: '#ff4fd8', 'accent-text': '#1d0a19', border: '#2e2544' },
  forest: { name: 'Forest', bg: '#0e1411', surface: '#141c18', 'surface-2': '#1b2620', elevated: '#22302a', text: '#e8f2ec', 'text-dim': '#8ca497', accent: '#4ade80', 'accent-text': '#05200e', border: '#23312a' },
  sunset: { name: 'Sunset', bg: '#18110f', surface: '#211715', 'surface-2': '#2b1e1b', elevated: '#362522', text: '#fdf0ea', 'text-dim': '#b39a91', accent: '#ff7a45', 'accent-text': '#1f0d05', border: '#3a2a26' },
  ocean: { name: 'Ocean', bg: '#09131f', surface: '#0e1b2a', 'surface-2': '#142435', elevated: '#1a2d42', text: '#e6f1fb', 'text-dim': '#86a0b8', accent: '#38bdf8', 'accent-text': '#03121c', border: '#1b2f44' },
  crimson: { name: 'Crimson', bg: '#130c0e', surface: '#1b1214', 'surface-2': '#25181b', elevated: '#301f23', text: '#fbecef', 'text-dim': '#a98e94', accent: '#ff3d5e', 'accent-text': '#ffffff', border: '#332226' },
  daylight: { name: 'Daylight', bg: '#eef0f5', surface: '#ffffff', 'surface-2': '#f3f4f8', elevated: '#ffffff', text: '#15171c', 'text-dim': '#636a7a', accent: '#5b4bff', 'accent-text': '#ffffff', border: '#e1e4eb' },
  rose: { name: 'Rosé', bg: '#f8eeee', surface: '#fffafa', 'surface-2': '#f6e8e7', elevated: '#ffffff', text: '#2b1d1f', 'text-dim': '#8a6f73', accent: '#e0457b', 'accent-text': '#ffffff', border: '#ecdad8' },
  sand: { name: 'Sand', bg: '#f3efe6', surface: '#fbf8f1', 'surface-2': '#efe9dc', elevated: '#ffffff', text: '#2a261e', 'text-dim': '#7c7465', accent: '#c2410c', 'accent-text': '#ffffff', border: '#e3dccb' },
};

export const ACCENTS = ['#7c5cff', '#5b8cff', '#38bdf8', '#14b8a6', '#4ade80', '#a3e635', '#facc15', '#ff9f43', '#ff7a45', '#ff3d5e', '#ff4fd8', '#c084fc'];

export const FONTS = {
  system: ['Systemowa', 'system-ui, -apple-system, "Segoe UI", Roboto, Ubuntu, Cantarell, "Noto Sans", sans-serif'],
  inter: ['Inter / Helvetica', '"Inter", "Inter Variable", "Helvetica Neue", Helvetica, Arial, sans-serif'],
  rounded: ['Zaokrąglona', '"SF Pro Rounded", "Nunito", "Varela Round", "Quicksand", system-ui, sans-serif'],
  geometric: ['Geometryczna', '"Poppins", "Montserrat", "Futura", "Century Gothic", system-ui, sans-serif'],
  serif: ['Szeryfowa', '"Iowan Old Style", "Palatino Linotype", Georgia, "Noto Serif", serif'],
  mono: ['Monospace', 'ui-monospace, "JetBrains Mono", "Cascadia Code", "Fira Code", Menlo, Consolas, monospace'],
};

const root = document.documentElement;
let dynamicAccent = null;

export function themeVars() {
  const t = S.settings.theme;
  const base = PRESETS[t.preset] || PRESETS.midnight;
  const vars = { ...base, ...(t.custom || {}) };
  delete vars.name;
  return vars;
}

function luminance(hex) {
  const m = hex.replace('#', '').match(/.{2}/g);
  if (!m) return 0;
  const [r, g, b] = m.map((x) => parseInt(x, 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function applyTheme() {
  const vars = themeVars();
  for (const [k] of VAR_KEYS) root.style.setProperty('--' + k, vars[k]);
  if (dynamicAccent && S.settings.theme.dynamicAccent) {
    root.style.setProperty('--accent', dynamicAccent);
    root.style.setProperty('--accent-text', luminance(dynamicAccent) > 0.45 ? '#111111' : '#ffffff');
  }
  const light = luminance(vars.bg) > 0.5;
  root.dataset.scheme = light ? 'light' : 'dark';
  root.style.colorScheme = light ? 'light' : 'dark';
  root.dataset.ambient = S.settings.theme.ambient ? 'on' : 'off';
  S.settings.theme.vars = { bg: vars.bg };
}

export function applyStyle() {
  const st = S.settings.style;
  root.style.setProperty('--radius', st.radius + 'px');
  root.style.setProperty('--font', (FONTS[st.font] || FONTS.system)[1]);
  root.style.setProperty('--font-scale', String(st.fontScale / 100));
  root.dataset.density = st.density;
  root.dataset.glass = st.glass ? 'on' : 'off';
  root.dataset.animations = st.animations ? 'on' : 'off';
  root.dataset.cover = st.cover;
  root.dataset.panels = st.panels;
  document.getElementById('custom-css').textContent = st.customCSS || '';
}

export function applyLayout() {
  const L = S.settings.layout;
  const app = document.getElementById('app');
  root.dataset.queue = L.queue ? 'on' : 'off';
  root.dataset.compact = L.sidebarCompact ? 'on' : 'off';
  root.dataset.sidebarHidden = L.sidebarHidden ? 'on' : 'off';
  root.dataset.playerStyle = L.playerStyle;
  root.style.setProperty('--sidebar-w', L.sidebarWidth + 'px');
  root.style.setProperty('--queue-w', L.queueWidth + 'px');

  const showSide = !L.sidebarHidden;
  const showQueue = L.queue;
  // kolumny: [sidebar][rs1][main][rs2][queue] – z możliwością zamiany stron
  let cols = [];
  let areas = [];
  const side = showSide ? [['sidebar', 'var(--sidebar-w)'], ['rs1', 'var(--gap)']] : [];
  const queue = showQueue ? [['rs2', 'var(--gap)'], ['queue', 'var(--queue-w)']] : [];
  if (L.sidebar === 'right') {
    // kolejka po lewej, sidebar po prawej
    const q = showQueue ? [['queue', 'var(--queue-w)'], ['rs2', 'var(--gap)']] : [];
    const s = showSide ? [['rs1', 'var(--gap)'], ['sidebar', 'var(--sidebar-w)']] : [];
    cols = [...q, ['main', 'minmax(0, 1fr)'], ...s];
  } else {
    cols = [...side, ['main', 'minmax(0, 1fr)'], ...queue];
  }
  const names = cols.map((c) => c[0]);
  const row = (n) => `"${names.map(() => n).join(' ')}"`;
  const mid = `"${names.join(' ')}"`;
  areas = [row('titlebar')];
  const rows = ['var(--titlebar-h)'];
  if (L.player === 'top') { areas.push(row('player')); rows.push('auto'); }
  areas.push(mid); rows.push('minmax(0, 1fr)');
  if (L.player !== 'top') { areas.push(row('player')); rows.push('auto'); }
  app.style.gridTemplateColumns = cols.map((c) => c[1]).join(' ');
  app.style.gridTemplateAreas = areas.join(' ');
  app.style.gridTemplateRows = rows.join(' ');
  root.dataset.winbtns = windowButtonsStyle();
}

// 'right' (ikony po prawej), 'left' (kropki po lewej), 'system' (natywne)
export function windowButtonsStyle() {
  const wb = S.settings.layout.windowButtons || 'auto';
  if (wb === 'auto') return S.platform === 'darwin' ? 'left' : 'right';
  return wb;
}

// Rejestr motywów z pluginów (np. EvenMoreColors)
export function registerTheme(id, def) {
  PRESETS[id] = { ...def, plugin: true };
  if (S.settings.theme.preset === id) applyTheme();
  emit('themes');
  return () => {
    delete PRESETS[id];
    if (S.settings.theme.preset === id) { S.settings.theme.preset = 'midnight'; saveSettings(); applyTheme(); }
    emit('themes');
  };
}

export function applyAll() {
  applyTheme();
  applyStyle();
  applyLayout();
}

// ---- dynamiczny akcent z okładki ----
export function updateDynamicAccent(src) {
  if (!S.settings.theme.dynamicAccent || !src) {
    if (dynamicAccent) { dynamicAccent = null; applyTheme(); }
    return;
  }
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 32;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0, 32, 32);
      const d = g.getImageData(0, 0, 32, 32).data;
      let best = null, bestScore = -1;
      const buckets = new Map();
      for (let i = 0; i < d.length; i += 4) {
        const [r, gg, b] = [d[i], d[i + 1], d[i + 2]];
        const max = Math.max(r, gg, b), min = Math.min(r, gg, b);
        const sat = max ? (max - min) / max : 0;
        const val = max / 255;
        if (val < 0.25 || sat < 0.25) continue;
        const key = (r >> 5) + ',' + (gg >> 5) + ',' + (b >> 5);
        const e = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0, s: 0 };
        e.n++; e.r += r; e.g += gg; e.b += b; e.s += sat * val;
        buckets.set(key, e);
      }
      for (const e of buckets.values()) {
        const score = e.n * (e.s / e.n);
        if (score > bestScore) { bestScore = score; best = e; }
      }
      if (best) {
        const hex = '#' + [best.r / best.n, best.g / best.n, best.b / best.n].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
        dynamicAccent = hex;
        applyTheme();
      }
    } catch {}
  };
  img.src = src;
}

export function setAmbient(src) {
  const el = document.getElementById('ambient');
  if (src && S.settings.theme.ambient) {
    el.style.backgroundImage = `url("${src.replace(/"/g, '%22')}")`;
    el.classList.add('has-art');
  } else {
    el.classList.remove('has-art');
  }
}

// ---- przeciąganie szerokości paneli ----
export function setupResizers() {
  document.querySelectorAll('.resizer').forEach((r) => {
    r.addEventListener('pointerdown', (e) => {
      const panel = r.dataset.panel;
      const L = S.settings.layout;
      const startX = e.clientX;
      const startW = panel === 'sidebar' ? L.sidebarWidth : L.queueWidth;
      // kierunek zależy od strony, po której jest panel
      const panelOnLeft = panel === 'sidebar' ? L.sidebar !== 'right' : L.sidebar === 'right';
      r.setPointerCapture(e.pointerId);
      r.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      const move = (ev) => {
        const dx = ev.clientX - startX;
        const w = Math.round(Math.max(panel === 'sidebar' ? 180 : 240, Math.min(560, startW + (panelOnLeft ? dx : -dx))));
        if (panel === 'sidebar') L.sidebarWidth = w; else L.queueWidth = w;
        root.style.setProperty(panel === 'sidebar' ? '--sidebar-w' : '--queue-w', w + 'px');
      };
      const up = () => {
        r.removeEventListener('pointermove', move);
        r.removeEventListener('pointerup', up);
        r.classList.remove('dragging');
        document.body.style.cursor = '';
        saveSettings();
        emit('resize');
      };
      r.addEventListener('pointermove', move);
      r.addEventListener('pointerup', up);
    });
    r.addEventListener('dblclick', () => {
      const L = S.settings.layout;
      if (r.dataset.panel === 'sidebar') L.sidebarWidth = 248; else L.queueWidth = 320;
      applyLayout();
      saveSettings();
    });
  });
}

on('settings', applyAll);
