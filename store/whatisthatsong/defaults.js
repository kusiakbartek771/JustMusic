// Wspólne dla pluginu i strony widżetu: domyślne ustawienia, układy i gotowe style.

export const LAYOUTS = [
  ['card', 'Karta'],
  ['tall', 'Pionowa'],
  ['bar', 'Pasek'],
  ['cover', 'Okładka'],
  ['text', 'Sam tekst'],
];

export const FONTS = {
  app: ['Aplikacji', 'var(--app-font)'],
  system: ['Systemowa', 'system-ui, "Segoe UI", "Noto Sans", Ubuntu, Roboto, sans-serif'],
  rounded: ['Zaokrąglona', 'ui-rounded, "SF Pro Rounded", Nunito, Quicksand, "Varela Round", "Comfortaa", system-ui, sans-serif'],
  serif: ['Szeryfowa', 'Georgia, "Noto Serif", "Times New Roman", serif'],
  mono: ['Maszynowa', '"JetBrains Mono", "Cascadia Code", "Fira Code", ui-monospace, Menlo, Consolas, monospace'],
  condensed: ['Wąska', '"Bahnschrift SemiCondensed", "Roboto Condensed", "Arial Narrow", "Noto Sans Display", sans-serif'],
};

export const ELEMENTS = [
  ['cover', 'Okładka'],
  ['status', 'Napis „Teraz gra”'],
  ['title', 'Tytuł'],
  ['artist', 'Wykonawca'],
  ['album', 'Album'],
  ['progress', 'Pasek postępu'],
  ['time', 'Czas'],
  ['controls', 'Przyciski sterowania'],
  ['like', 'Serduszko (polub)'],
  ['next', 'Następny utwór'],
  ['viz', 'Animowane słupki, gdy gra'],
];

export function defaultStyle() {
  return {
    colors: 'app', // app | custom
    bg: '#14161c',
    bgOpacity: 82,
    text: '#f1f3f8',
    dim: '#9aa1b2',
    accent: '#7c5cff',
    radius: 18,
    scale: 100,
    width: 340,
    font: 'app',
    bold: true,
    align: 'left',
    shadow: true,
    border: true,
    textShadow: false,
    coverShape: 'rounded', // rounded | square | circle | vinyl
    coverBg: false, // rozmyta okładka jako tło
    marquee: true,
    controls: 'always', // always | hover
  };
}

export function defaultWidget(n = 1) {
  return {
    id: 'w' + Math.random().toString(36).slice(2, 8),
    name: n === 1 ? 'Teraz gra' : `Widżet ${n}`,
    enabled: true,
    layout: 'card',
    show: { cover: true, status: true, title: true, artist: true, album: false, progress: true, time: true, controls: true, like: true, next: false, viz: true },
    style: defaultStyle(),
    pos: { anchor: 'bottom-right', marginX: 24, marginY: 24, display: '', x: null, y: null },
    behavior: { onTop: true, allDesktops: true, clickThrough: false, locked: false, opacity: 100, hidePaused: false, hideIdle: false },
  };
}

/** gotowe style – zmieniają tylko wygląd, nie elementy ani położenie */
export const PRESETS = [
  { id: 'app', name: 'Motyw aplikacji', style: { colors: 'app', bgOpacity: 88, border: true, shadow: true, textShadow: false, coverBg: false, radius: 18 } },
  { id: 'glass', name: 'Szkło', style: { colors: 'custom', bg: '#0b0d12', bgOpacity: 48, text: '#ffffff', dim: '#c9cfdc', accent: '#ffffff', border: true, shadow: true, textShadow: true, coverBg: false, radius: 22 } },
  { id: 'cover', name: 'Z okładki', style: { colors: 'app', bgOpacity: 70, border: false, shadow: true, textShadow: true, coverBg: true, radius: 20 } },
  { id: 'neon', name: 'Neon', style: { colors: 'custom', bg: '#0d0618', bgOpacity: 92, text: '#fdf2ff', dim: '#c58cf0', accent: '#ff4fd8', border: true, shadow: true, textShadow: false, coverBg: false, radius: 14, font: 'condensed' } },
  { id: 'light', name: 'Jasny', style: { colors: 'custom', bg: '#ffffff', bgOpacity: 94, text: '#16181d', dim: '#646b7a', accent: '#5b4bff', border: true, shadow: true, textShadow: false, coverBg: false, radius: 18 } },
  { id: 'minimal', name: 'Bez tła', style: { colors: 'custom', bg: '#000000', bgOpacity: 0, text: '#ffffff', dim: '#e2e5ee', accent: '#ffffff', border: false, shadow: false, textShadow: true, coverBg: false, radius: 12 } },
  { id: 'retro', name: 'Retro', style: { colors: 'custom', bg: '#f3e9d2', bgOpacity: 96, text: '#3b2a1a', dim: '#8a6b4a', accent: '#c2410c', border: true, shadow: true, textShadow: false, coverBg: false, radius: 6, font: 'serif', coverShape: 'vinyl' } },
  { id: 'terminal', name: 'Terminal', style: { colors: 'custom', bg: '#050805', bgOpacity: 90, text: '#7dff9b', dim: '#3fae5a', accent: '#7dff9b', border: true, shadow: false, textShadow: false, coverBg: false, radius: 4, font: 'mono', coverShape: 'square' } },
];

/** uzupełnia brakujące pola (np. po aktualizacji pluginu) */
export function normalize(w, n = 1) {
  const d = defaultWidget(n);
  return {
    ...d,
    ...w,
    show: { ...d.show, ...(w?.show || {}) },
    style: { ...d.style, ...(w?.style || {}) },
    pos: { ...d.pos, ...(w?.pos || {}) },
    behavior: { ...d.behavior, ...(w?.behavior || {}) },
  };
}

// ---------- popupy ----------
export const ANIMS = [['slide', 'Wysunięcie'], ['fade', 'Pojawienie się'], ['zoom', 'Powiększenie'], ['none', 'Bez animacji']];

export function defaultPopup() {
  const w = defaultWidget();
  w.id = 'popup';
  w.name = 'Popupy';
  w.show = { ...w.show, album: false, next: false, time: false };
  w.style = { ...w.style, width: 360 };
  w.pos = { anchor: 'top-right', marginX: 24, marginY: 24, display: '', x: null, y: null };
  w.behavior = { ...w.behavior, locked: true };
  w.pop = {
    track: true, trackDur: 5, // przy zmianie utworu
    hotkey: true, accel: 'Control+Alt+W', hotkeyDur: 8, // po skrócie klawiszowym
    osd: true, osdVolume: true, osdPause: true, osdSeek: true, osdDur: 1.6, // głośność / pauza / przewijanie
    background: true, // tylko gdy JustMusic jest w tle
    anim: 'slide',
  };
  return w;
}

export function normalizePopup(p) {
  const d = defaultPopup();
  return {
    ...d,
    layout: p?.layout || d.layout,
    show: { ...d.show, ...(p?.show || {}) },
    style: { ...d.style, ...(p?.style || {}) },
    pos: { ...d.pos, ...(p?.pos || {}), anchor: p?.pos?.anchor && p.pos.anchor !== 'free' ? p.pos.anchor : d.pos.anchor },
    behavior: { ...d.behavior, locked: true },
    pop: { ...d.pop, ...(p?.pop || {}) },
  };
}
