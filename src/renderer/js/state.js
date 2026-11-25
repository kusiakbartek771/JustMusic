// Globalny stan aplikacji + zapisywanie + prosta szyna zdarzeń.

export const DEFAULT_SETTINGS = {
  theme: { preset: 'midnight', vars: null, custom: {}, dynamicAccent: false, ambient: true },
  style: {
    radius: 12, font: 'system', fontScale: 100, density: 'comfortable', glass: false, animations: true,
    cover: 'rounded', panels: 'cards', customCSS: '',
  },
  layout: {
    sidebar: 'left', player: 'bottom', queue: true, sidebarWidth: 248, queueWidth: 320,
    sidebarCompact: false, sidebarHidden: false, windowButtons: 'auto', playerStyle: 'full',
    sidebarSections: { playlists: true, bookmarks: true, plugins: true },
    homeSections: { quick: true, recent: true, playlists: true, bookmarks: true },
  },
  playback: {
    volume: 0.8, muted: false, shuffle: false, repeat: 'off', resume: true, prefetch: true,
    eq: { enabled: false, preset: 'flat', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], preamp: 0 },
    seekStep: 10, fadeMs: 250, bass: 0,
    normalize: true, normTarget: -14, crossfade: 0, gapless: true, trimSilence: true,
  },
  downloads: { dir: '', format: 'm4a', tag: true, concurrent: 2 },
  youtube: { searchMode: 'youtube', results: 25, cookiesBrowser: '', extraArgs: '', ytdlpPath: '', ffmpegPath: '', jsRuntime: true },
  spotify: { clientId: '', clientSecret: '' },
  library: { folders: [], scanOnStart: true },
  plugins: { enabled: {}, data: {}, catalogUrl: '' },
  system: { tray: true, closeToTray: false, taskbarProgress: true, desktopEntry: true },
  updates: { autoCheck: true, autoInstall: true },
  onboarded: false,
  lang: null,        // null = przy pierwszym uruchomieniu język systemu
};

export const DEFAULT_DATA = {
  tracks: {},        // id -> metadane utworów nielokalnych (YouTube/Spotify)
  playlists: [],     // { id, name, desc, color, trackIds, created, updated }
  liked: [],         // ids
  bookmarks: [],     // { id, type: 'moment'|'track'|'playlist'|'search'|'link', ... }
  history: [],       // { id, at }
  searches: [],      // ostatnie zapytania
  downloads: {},     // trackId -> ścieżka pliku
  spMap: {},         // spotifyId -> ytId
  lufs: {},          // trackId -> zmierzona głośność (LUFS) albo false
  trim: {},          // trackId -> { a: koniec ciszy na początku, b: początek ciszy do końca } (s)
  session: null,     // { queue, index, time }
};

export const S = {
  settings: null,
  data: null,
  paths: {},
  platform: 'linux',
  version: '1.0.0',
  local: [],               // utwory lokalne
  localById: new Map(),
  ytStatus: null,
};

function merge(def, val) {
  if (val === undefined || val === null) return structuredClone(def);
  if (Array.isArray(def) || typeof def !== 'object' || def === null) return val;
  const out = {};
  for (const k of Object.keys(def)) out[k] = merge(def[k], val[k]);
  for (const k of Object.keys(val)) if (!(k in out)) out[k] = val[k];
  return out;
}

export async function initState() {
  const r = await window.jm.load();
  S.settings = merge(DEFAULT_SETTINGS, r.settings);
  S.data = merge(DEFAULT_DATA, r.data);
  S.paths = r.paths;
  S.platform = r.platform;
  S.version = r.version;
  S.config = r.config || {};
  S.sys = r.sys || {};
  S.packaged = !!r.packaged;
  S.lastCrash = r.lastCrash || null;
  if (!S.settings.downloads.dir) S.settings.downloads.dir = r.paths.music;
  // migracja: dawna opcja „natywna ramka”
  if (S.settings.layout.nativeFrame) { S.settings.layout.windowButtons = 'system'; delete S.settings.layout.nativeFrame; }
}

// ---- zdarzenia ----
const listeners = new Map();
export function on(ev, fn) {
  if (!listeners.has(ev)) listeners.set(ev, new Set());
  listeners.get(ev).add(fn);
  return () => listeners.get(ev)?.delete(fn);
}
export function emit(ev, payload) {
  const set = listeners.get(ev);
  if (set) for (const fn of [...set]) {
    try { fn(payload); } catch (e) { console.error(`[event ${ev}]`, e); }
  }
}

// ---- zapisywanie (debounce) ----
const timers = {};
function debounced(name, getter, ms = 400) {
  clearTimeout(timers[name]);
  timers[name] = setTimeout(() => window.jm.save(name, getter()).catch(console.error), ms);
}
export function saveData() { debounced('data', () => S.data); }
export function saveSettings() { debounced('settings', () => S.settings, 250); }
export function flush() {
  for (const k of Object.keys(timers)) clearTimeout(timers[k]);
  window.jm.save('data', S.data);
  window.jm.save('settings', S.settings);
}

// ---- utwory ----
export function setLocal(tracks) {
  S.local = tracks;
  S.localById = new Map(tracks.map((t) => [t.id, t]));
  emit('library');
}

export function getTrack(id) {
  return S.localById.get(id) || S.data.tracks[id] || null;
}

const KEEP = ['id', 'source', 'ytId', 'spotifyId', 'title', 'artist', 'album', 'duration', 'thumb', 'path'];
export function remember(t) {
  if (!t || t.source === 'local') return t;
  const cur = S.data.tracks[t.id];
  if (!cur) {
    const o = {};
    for (const k of KEEP) if (t[k] !== undefined && t[k] !== null) o[k] = t[k];
    S.data.tracks[t.id] = o;
    saveData();
  }
  return S.data.tracks[t.id];
}

export function tracksOf(ids) {
  const out = [];
  for (const id of ids) {
    const t = getTrack(id);
    if (t) out.push(t);
  }
  return out;
}

export function isLiked(id) { return S.data.liked.includes(id); }
export function toggleLike(t) {
  const i = S.data.liked.indexOf(t.id);
  if (i >= 0) S.data.liked.splice(i, 1);
  else { remember(t); S.data.liked.unshift(t.id); }
  saveData();
  emit('liked', t.id);
  return i < 0;
}

export function isDownloaded(id) { return !!S.data.downloads[id]; }

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function pushHistory(id) {
  const h = S.data.history;
  if (h[0]?.id === id) return;
  h.unshift({ id, at: Date.now() });
  if (h.length > 500) h.length = 500;
  saveData();
}
