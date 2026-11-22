// Silnik odtwarzania: kolejka, źródła (lokalne / YouTube / Spotify→YouTube),
// korektor 10-pasmowy (Web Audio), Media Session (klawisze multimedialne, MPRIS, SMTC).
import { S, emit, on, getTrack, remember, saveData, saveSettings, pushHistory, tracksOf } from './state.js';
import { toast } from './ui.js';

export const EQ_FREQS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const EQ_PRESETS = {
  flat: { name: 'Płaski', g: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  bass: { name: 'Mocny bas', g: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0] },
  treble: { name: 'Wysokie tony', g: [0, 0, 0, 0, 0, 1, 2, 4, 5, 6] },
  vocal: { name: 'Wokal', g: [-2, -2, -1, 1, 3, 4, 3, 1, 0, -1] },
  rock: { name: 'Rock', g: [4, 3, 1, -1, -2, -1, 1, 3, 4, 4] },
  electronic: { name: 'Elektronika', g: [5, 4, 1, 0, -2, 1, 0, 2, 4, 5] },
  pop: { name: 'Pop', g: [-1, 1, 3, 4, 3, 0, -1, -1, 0, 1] },
  acoustic: { name: 'Akustyczny', g: [3, 3, 2, 1, 1, 1, 2, 3, 2, 1] },
  loudness: { name: 'Loudness', g: [5, 3, 0, 0, -1, 0, -1, 0, 3, 4] },
};

// Dwa elementy audio: aktywny (`audio`) i zapasowy, w którym wcześniej ładuje się następny utwór –
// dzięki temu przejścia są płynne (crossfade) albo bez przerwy (gapless). Po przejściu role się zamieniają.
function mkAudio() {
  const a = new Audio();
  a.crossOrigin = 'anonymous';
  a.preload = 'auto';
  return a;
}
const els = [mkAudio(), mkAudio()];
let audio = els[0];
const spareEl = () => (audio === els[0] ? els[1] : els[0]);
const elTrack = new Map(); // element -> utwór w nim załadowany

// Stały obiekt dla reszty aplikacji i pluginów: zawsze wskazuje aktywny element, a nasłuch zdarzeń
// dostaje tylko zdarzenia aktywnego elementu (także po zamianie ról).
const wrapped = new Map(); // `${type}|${capture}` -> Map(fn -> wrapper)
const capOf = (o) => !!(typeof o === 'object' ? o?.capture : o);
const audioProxy = new Proxy({}, {
  get(_, k) {
    if (k === 'addEventListener') {
      return (type, fn, opts) => {
        if (!fn) return;
        const key = `${type}|${capOf(opts)}`;
        if (!wrapped.has(key)) wrapped.set(key, new Map());
        const m = wrapped.get(key);
        if (m.has(fn)) return;
        const once = typeof opts === 'object' && opts?.once;
        const w = (e) => {
          if (e.target !== audio) return;
          if (once) audioProxy.removeEventListener(type, fn, opts);
          typeof fn === 'function' ? fn.call(e.target, e) : fn.handleEvent(e);
        };
        m.set(fn, w);
        for (const el of els) el.addEventListener(type, w, capOf(opts));
      };
    }
    if (k === 'removeEventListener') {
      return (type, fn, opts) => {
        const m = wrapped.get(`${type}|${capOf(opts)}`);
        const w = m?.get(fn);
        if (!w) return;
        m.delete(fn);
        for (const el of els) el.removeEventListener(type, w, capOf(opts));
      };
    }
    const v = audio[k];
    return typeof v === 'function' ? v.bind(audio) : v;
  },
  set(_, k, v) { audio[k] = v; return true; },
});
// zdarzenia tylko aktywnego elementu (wewnętrznie)
function onActive(type, fn) {
  for (const el of els) el.addEventListener(type, (e) => { if (e.target === audio) fn(e); });
}

export const P = {
  get audio() { return audioProxy; },
  queue: [],        // ids
  index: -1,
  original: null,   // kolejność sprzed losowania
  current: null,
  loading: false,
  get playing() { return !audio.paused && !audio.ended; },
  context: null,    // { type, id, name } – skąd odtwarzamy
};

let loadToken = 0;
let srcKind = null;   // 'stream' | 'file'
let retried = false;
let prefetched = null;
let pendingStart = 0; // pozycja do wznowienia po restarcie aplikacji

// ---------------- Web Audio (EQ + analizator) ----------------
let ctx = null, filters = [], preampNode = null, analyser = null, bassNode = null, bassTrim = null;
const boostNodes = new Map(); // element -> GainNode (podbicie cichych utworów przy wyrównywaniu głośności)

export function ensureGraph() {
  if (ctx) return { ctx, analyser };
  try {
    ctx = new AudioContext({ latencyHint: 'playback' });
    preampNode = ctx.createGain();
    for (const el of els) {
      const g = ctx.createGain();
      ctx.createMediaElementSource(el).connect(g).connect(preampNode);
      boostNodes.set(el, g);
      syncBoost(el);
    }
    filters = EQ_FREQS.map((f, i) => {
      const b = ctx.createBiquadFilter();
      b.type = i === 0 ? 'lowshelf' : i === EQ_FREQS.length - 1 ? 'highshelf' : 'peaking';
      b.frequency.value = f;
      b.Q.value = 1.1;
      return b;
    });
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8;
    // osobny suwak basu – niezależny od korektora
    bassNode = ctx.createBiquadFilter();
    bassNode.type = 'lowshelf';
    bassNode.frequency.value = 110;
    bassTrim = ctx.createGain(); // zapas głośności, żeby mocny bas nie przesterowywał
    let node = preampNode.connect(bassNode).connect(bassTrim);
    for (const f of filters) node = node.connect(f);
    node.connect(analyser);
    analyser.connect(ctx.destination);
    applyEq();
  } catch (e) {
    console.error('AudioContext error', e);
  }
  return { ctx, analyser };
}

export const BASS_MIN = -6, BASS_MAX = 15;

export function applyEq() {
  const eq = S.settings.playback.eq;
  if (!ctx) {
    if (eq.enabled || S.settings.playback.bass) ensureGraph();
    return;
  }
  const bass = S.settings.playback.bass || 0;
  const t = ctx.currentTime;
  bassNode.gain.setTargetAtTime(bass, t, 0.03);
  bassTrim.gain.setTargetAtTime(Math.pow(10, -Math.max(0, bass) * 0.45 / 20), t, 0.03);
  filters.forEach((f, i) => (f.gain.value = eq.enabled ? eq.gains[i] || 0 : 0));
  preampNode.gain.value = eq.enabled ? Math.pow(10, (eq.preamp || 0) / 20) : 1;
}

export function getAnalyser() {
  ensureGraph();
  if (ctx?.state === 'suspended') ctx.resume();
  return analyser;
}

// ---------------- wyrównywanie głośności ----------------
// Głośność utworu (LUFS) mierzy ffmpeg w tle, wynik jest zapamiętywany. Głośne utwory są ściszane,
// ciche podbijane (maks. +6 dB, przez Web Audio). Dopóki pomiaru nie ma, zakładamy typową głośność
// muzyki z YouTube, żeby po pomiarze zmiana była niewielka.
const TYPICAL_LUFS = -10;
const MAX_BOOST_DB = 6;
let lufsUnavailable = false;
const measuring = new Set();
const measureQueue = [];

function normOn() { return !!S.settings.playback.normalize; }
export function lufsOf(track) {
  const v = track && S.data.lufs?.[track.id];
  return typeof v === 'number' ? v : null;
}
function gainDb(track) {
  if (!normOn() || !track) return 0;
  const l = lufsOf(track) ?? TYPICAL_LUFS;
  return Math.max(-20, Math.min(MAX_BOOST_DB, (S.settings.playback.normTarget ?? -14) - l));
}
// część „ściszająca” (głośność elementu) i „podbijająca” (GainNode)
const attenOf = (track) => Math.min(1, Math.pow(10, gainDb(track) / 20));
function syncBoost(el) {
  const g = boostNodes.get(el);
  if (!g) return;
  const lin = Math.max(1, Math.pow(10, gainDb(elTrack.get(el)) / 20));
  g.gain.setTargetAtTime(lin, ctx.currentTime, 0.05);
}
function needBoost(track) {
  if (gainDb(track) > 0.5 && !ctx) {
    ensureGraph();
    if (ctx?.state === 'suspended') ctx.resume();
  }
}

/** Po zmianie ustawień wyrównywania – przelicz głośność bieżącego utworu */
export function applyNormalize() {
  for (const el of els) syncBoost(el);
  if (P.current) { needBoost(P.current); measure(P.current, true); }
  if (!audio.paused) rampVolume(volumeValue(), 400);
  else { rampId++; audio.volume = volumeValue(); }
}

async function measureSource(track) {
  if (track.source === 'local') return { file: track.path };
  const dl = S.data.downloads[track.id];
  if (dl) return { file: dl };
  return { ytId: await ytIdFor(track) };
}

function measure(track, urgent = false) {
  if (!normOn() || lufsUnavailable || !track || !window.jm.yt.loudness) return;
  if (track.id in (S.data.lufs || {}) || measuring.has(track.id)) return;
  const i = measureQueue.findIndex((t) => t.id === track.id);
  if (i >= 0) measureQueue.splice(i, 1);
  if (urgent) measureQueue.unshift(track); else measureQueue.push(track);
  if (measureQueue.length > 20) measureQueue.length = 20;
  pumpMeasure();
}

let measureBusy = false;
async function pumpMeasure() {
  if (measureBusy) return;
  const track = measureQueue.shift();
  if (!track) return;
  measureBusy = true;
  measuring.add(track.id);
  try {
    const v = await window.jm.yt.loudness(await measureSource(track));
    S.data.lufs ||= {};
    S.data.lufs[track.id] = typeof v === 'number' ? Math.round(v * 10) / 10 : false;
    saveData();
    emit('loudness', track.id);
    for (const el of els) if (elTrack.get(el)?.id === track.id) syncBoost(el);
    if (P.current?.id === track.id) {
      needBoost(track);
      if (!audio.paused) rampVolume(volumeValue(), 1500);
      else { rampId++; audio.volume = volumeValue(); }
    }
  } catch (e) {
    if (/FFMPEG_MISSING/.test(e?.message || '')) lufsUnavailable = true;
    else console.warn('[loudness]', e?.message || e);
  } finally {
    measuring.delete(track.id);
    measureBusy = false;
    setTimeout(pumpMeasure, 200);
  }
}
export const loudnessAvailable = () => !lufsUnavailable;

// ---------------- źródła ----------------
const mediaUrl = (p) => `jm://app/media?p=${encodeURIComponent(p)}`;

async function ytIdFor(track) {
  if (track.ytId) return track.ytId;
  if (track.source === 'spotify') {
    const cached = S.data.spMap[track.spotifyId];
    if (cached) return cached;
    const id = await window.jm.yt.resolve({ title: track.title, artist: track.artist, duration: track.duration });
    S.data.spMap[track.spotifyId] = id;
    saveData();
    return id;
  }
  throw new Error('Nieznane źródło utworu');
}

async function sourceFor(track, fresh = false) {
  if (track.source === 'local') return { url: mediaUrl(track.path), kind: 'file' };
  const dl = S.data.downloads[track.id];
  if (dl && !fresh) return { url: mediaUrl(dl), kind: 'file', downloaded: true };
  const id = await ytIdFor(track);
  const url = await window.jm.yt.stream(id, fresh);
  return { url, kind: 'stream', ytId: id };
}

function describeError(e) {
  const m = e?.message || String(e);
  if (m.includes('YTDLP_MISSING')) return 'Brak yt-dlp – zainstaluj go w Ustawieniach → Pobieranie (1 klik)';
  if (/Sign in to confirm|bot/i.test(m)) return 'YouTube wymaga weryfikacji – ustaw cookies przeglądarki w Ustawieniach → YouTube';
  return m.replace(/^ERROR:\s*/, '').slice(0, 160);
}

// ---------------- ładowanie ----------------
async function load(track, { autoplay = true, startAt = 0 } = {}) {
  const token = ++loadToken;
  P.current = track;
  P.loading = true;
  retried = false;
  prefetched = null;
  emit('track', track);
  emit('loading', true);
  updateMediaSession(track);
  recovering = false;
  measure(track, true);
  cancelTransition();
  // następny utwór już czeka w zapasowym elemencie – wystarczy zamienić role
  if (spare.track?.id === track.id && spare.ready && !startAt) {
    const prevEl = audio;
    swapToSpare();
    stopEl(prevEl);
    pushHistory(track.id);
    rampId++;
    audio.volume = volumeValue();
    if (autoplay) playSafe();
    else { P.loading = false; emit('loading', false); }
    return;
  }
  dropSpare();
  let src;
  try {
    audio.pause();
    src = await sourceFor(track);
  } catch (e) {
    if (token !== loadToken) return;
    failed(token, describeError(e), !/YTDLP_MISSING/.test(e.message));
    return;
  }
  if (token !== loadToken) return;
  srcKind = src.kind;
  elTrack.set(audio, track);
  syncBoost(audio);
  needBoost(track);
  rampId++;
  audio.volume = volumeValue();
  audio.src = src.url;
  if (startAt > 0) {
    const a = audio;
    a.addEventListener('loadedmetadata', () => { a.currentTime = startAt; }, { once: true });
  }
  pushHistory(track.id);
  // błędy odtwarzania obsługuje zdarzenie 'error' (odświeżenie / buforowanie)
  if (autoplay) playSafe();
}

// ---------------- przejścia: crossfade / gapless ----------------
// spare: następny utwór wczytywany zawczasu do zapasowego elementu
const spare = { track: null, ready: false, kind: null, token: 0, failedId: null };
let transition = null; // { el (wyciszany), id }

function stopEl(el) {
  try { el.pause(); } catch {}
  el.removeAttribute('src');
  try { el.load(); } catch {}
  elTrack.delete(el);
}

function dropSpare() {
  spare.token++;
  if (spare.track) stopEl(spareEl());
  spare.track = null;
  spare.ready = false;
}

function swapToSpare() {
  const el = spareEl();
  audio = el;
  srcKind = spare.kind;
  retried = false;
  prefetched = null;
  spare.track = null;
  spare.ready = false;
  spare.token++;
  syncBoost(el);
}

function cancelTransition() {
  if (!transition) return;
  const t = transition;
  transition = null;
  t.cancel = true;
  if (t.el !== audio) stopEl(t.el);
}

const crossfadeSec = () => Math.max(0, Math.min(12, Number(S.settings.playback.crossfade) || 0));
const smoothOn = () => crossfadeSec() > 0 || S.settings.playback.gapless !== false;

async function prepareSpare(track) {
  if (!track || spare.track?.id === track.id) return;
  dropSpare();
  const token = spare.token;
  spare.track = track;
  measure(track);
  let src;
  try {
    src = await sourceFor(track);
  } catch {
    // zapamiętaj porażkę – bez tego watchEnd ponawiałby próbę co pół sekundy
    if (token === spare.token) { spare.track = null; spare.failedId = track.id; }
    return;
  }
  if (token !== spare.token) return;
  const el = spareEl();
  elTrack.set(el, track);
  syncBoost(el);
  spare.kind = src.kind;
  el.volume = 0;
  const ok = () => { if (token === spare.token) spare.ready = true; done(); };
  const bad = () => { if (token === spare.token) { spare.track = null; spare.ready = false; spare.failedId = track.id; elTrack.delete(el); } done(); };
  const done = () => { el.removeEventListener('canplaythrough', ok); el.removeEventListener('error', bad); };
  el.addEventListener('canplaythrough', ok);
  el.addEventListener('error', bad);
  el.src = src.url;
  el.load();
}

// Start następnego utworu z zapasowego elementu (z płynnym przejściem albo od razu)
function startSpare(fadeSec) {
  const track = spare.track;
  const outEl = audio;
  if (P.index + 1 < P.queue.length) P.index++;
  else P.index = 0;
  loadToken++;
  P.current = track;
  recovering = false;
  P.loading = false;
  swapToSpare();
  emit('queue');
  emit('track', track);
  updateMediaSession(track);
  pushHistory(track.id);
  needBoost(track);
  if (fadeSec > 0) {
    audio.volume = 0;
    playSafe();
    rampVolume(volumeValue(), fadeSec * 1000);
    fadeOutEl(outEl, fadeSec * 1000);
  } else {
    stopEl(outEl);
    rampId++;
    audio.volume = volumeValue();
    playSafe();
  }
  saveSession();
}

function fadeOutEl(el, ms) {
  cancelTransition();
  const t = { el, cancel: false };
  transition = t;
  const outTrack = elTrack.get(el);
  const t0 = performance.now();
  const start = el.volume;
  const base = volumeValue(outTrack) || 1;
  const step = () => {
    if (t.cancel) return;
    const k = Math.min(1, (performance.now() - t0) / ms);
    // uwzględnia zmiany głośności / ściszanie w trakcie przejścia
    el.volume = Math.max(0, Math.min(1, start * (volumeValue(outTrack) / base) * (1 - k)));
    if (k < 1 && !el.paused) setTimeout(step, 30);
    else { if (transition === t) transition = null; stopEl(el); }
  };
  step();
}

// Sprawdzanie końca utworu – częściej niż timeupdate, żeby przejście zaczęło się na czas
let watchTimer = null;
function watchEnd() {
  clearTimeout(watchTimer);
  if (audio.paused || !smoothOn()) return;
  const dur = audio.duration;
  if (Number.isFinite(dur) && dur > 0 && P.current) {
    const left = dur - audio.currentTime;
    const x = crossfadeSec();
    const n = S.settings.playback.repeat === 'one' ? null : peekNext();
    if (n && left < x + 20 && spare.track?.id !== n.id && spare.failedId !== n.id) prepareSpare(n);
    if (n && x > 0 && left <= x && spare.ready && spare.track?.id === n.id && dur > x * 3 && !transition) {
      startSpare(Math.max(0.5, left - 0.05));
    }
    watchTimer = setTimeout(watchEnd, left < x + 2 ? 50 : 500);
    return;
  }
  watchTimer = setTimeout(watchEnd, 500);
}
onActive('playing', watchEnd);
onActive('seeked', () => { if (spare.track && spare.track.id !== peekNext()?.id) dropSpare(); watchEnd(); });
on('queue', () => { if (spare.track && spare.track.id !== peekNext()?.id && spare.track.id !== P.queue[P.index]) dropSpare(); });

function failed(token, msg, skip = true) {
  P.loading = false;
  emit('loading', false);
  toast(msg, { error: true, duration: 5000 });
  if (skip && P.queue.length > 1 && P.index < P.queue.length - 1) setTimeout(() => token === loadToken && next(true), 1500);
}

async function playSafe() {
  // zapisany korektor / bas – graf audio tworzymy przy pierwszym odtwarzaniu
  if (!ctx && (S.settings.playback.eq.enabled || S.settings.playback.bass)) ensureGraph();
  if (ctx?.state === 'suspended') ctx.resume();
  try {
    await audio.play();
    return true;
  } catch (e) {
    // NotSupportedError itp. – właściwą obsługę robi zdarzenie 'error'
    if (e.name !== 'AbortError') console.warn('[player] play():', e.name, e.message);
    return false;
  }
}

// czeka, aż bieżące źródło zacznie grać albo zgłosi błąd
function waitPlayable() {
  return new Promise((resolve) => {
    const ok = () => { done(); resolve(true); };
    const bad = () => { done(); resolve(false); };
    const el = audio;
    const done = () => { el.removeEventListener('canplay', ok); el.removeEventListener('error', bad); };
    el.addEventListener('canplay', ok);
    el.addEventListener('error', bad);
  });
}
let recovering = false;

onActive('playing', () => { P.loading = false; emit('loading', false); emit('state'); });
onActive('waiting', () => { P.loading = true; emit('loading', true); });
onActive('canplay', () => { P.loading = false; emit('loading', false); });
onActive('pause', () => emit('state'));
onActive('play', () => emit('state'));
onActive('durationchange', () => emit('time'));
onActive('ended', () => {
  if (S.settings.playback.repeat === 'one') {
    audio.currentTime = 0;
    playSafe();
    return;
  }
  // gapless: następny utwór jest już wczytany – startuje od razu
  const n = peekNext();
  if (n && spare.ready && spare.track?.id === n.id && smoothOn()) startSpare(0);
  else next(true);
});

// Odzyskiwanie po błędzie odtwarzania – wykonywane sekwencyjnie, tylko raz na utwór.
onActive('error', async () => {
  const track = P.current;
  if (!track || !audio.src || recovering) return;
  recovering = true;
  const token = loadToken;
  const t = audio.currentTime;
  const err = audio.error;
  console.warn('[player] media error', err?.code, err?.message, audio.src);
  const resumeAt = () => { const el = audio; if (t) el.addEventListener('loadedmetadata', () => (el.currentTime = t), { once: true }); };
  const trySrc = async (url) => {
    audio.src = url;
    resumeAt();
    const ready = waitPlayable();
    playSafe();
    return ready;
  };

  // pobrany plik zniknął z dysku → wróć do strumienia
  if (srcKind === 'file' && track.source !== 'local' && S.data.downloads[track.id]) {
    delete S.data.downloads[track.id];
    saveData();
    recovering = false;
    return load(track, { startAt: t });
  }

  if (srcKind === 'stream') {
    // 1) świeży adres strumienia
    if (!retried) {
      retried = true;
      try {
        const src = await sourceFor(track, true);
        if (token !== loadToken) return;
        if (await trySrc(src.url)) { recovering = false; return; }
      } catch {}
      if (token !== loadToken) return;
    }
    // 2) awaryjnie: pobierz do bufora i odtwórz z dysku
    srcKind = 'file';
    P.loading = true;
    emit('loading', true);
    const closeToast = toast('Buforowanie utworu…', { duration: 60000 });
    try {
      const id = await ytIdFor(track);
      const file = await window.jm.yt.cache(id);
      closeToast();
      if (token !== loadToken) return;
      if (await trySrc(mediaUrl(file))) { recovering = false; return; }
      if (token !== loadToken) return;
      failed(token, 'Nie udało się odtworzyć: ' + (track.title || ''));
    } catch (e) {
      closeToast();
      if (token !== loadToken) return;
      failed(token, describeError(e));
    }
    return;
  }
  failed(token, 'Nie można odtworzyć pliku: ' + (track.title || '') + (err?.message ? ` (${err.message})` : ''));
});

// throttlowany timeupdate + prefetch następnego utworu
let lastTime = 0;
onActive('timeupdate', () => {
  const now = performance.now();
  if (now - lastTime < 250) return;
  lastTime = now;
  emit('time');
  if (S.settings.playback.prefetch && !prefetched && audio.duration && audio.currentTime > audio.duration * 0.5) {
    prefetched = true;
    const n = peekNext();
    if (n && n.source !== 'local' && !S.data.downloads[n.id]) ytIdFor(n).then((id) => window.jm.yt.stream(id)).catch(() => {});
  }
  if (now - lastSessionSave > 5000) saveSession();
});

// ---------------- sterowanie ----------------
export function playTracks(tracks, start = 0, context = null) {
  if (!tracks.length) return;
  tracks.forEach(remember);
  let ids = tracks.map((t) => t.id);
  P.context = context;
  P.original = null;
  if (S.settings.playback.shuffle) {
    P.original = ids.slice();
    const first = ids[start];
    const rest = ids.filter((_, i) => i !== start);
    shuffleArr(rest);
    ids = [first, ...rest];
    start = 0;
  }
  P.queue = ids;
  P.index = start;
  emit('queue');
  load(getTrack(ids[start]));
}

export function playTrack(track) { playTracks([track], 0); }

export function playAt(index) {
  if (index < 0 || index >= P.queue.length) return;
  P.index = index;
  emit('queue');
  load(getTrack(P.queue[index]));
}

export function enqueue(tracks, nextUp = false) {
  tracks.forEach(remember);
  const ids = tracks.map((t) => t.id);
  if (P.index < 0 || !P.queue.length) {
    playTracks(tracks, 0);
    return;
  }
  if (nextUp) P.queue.splice(P.index + 1, 0, ...ids);
  else P.queue.push(...ids);
  if (P.original) P.original.push(...ids);
  emit('queue');
  saveSession();
}

export function removeFromQueue(i) {
  if (i === P.index) return;
  P.queue.splice(i, 1);
  if (i < P.index) P.index--;
  emit('queue');
}

export function moveInQueue(from, to) {
  if (from === to) return;
  const [id] = P.queue.splice(from, 1);
  if (to > from) to--;
  P.queue.splice(to, 0, id);
  if (P.index === from) P.index = to;
  else if (from < P.index && to >= P.index) P.index--;
  else if (from > P.index && to <= P.index) P.index++;
  emit('queue');
}

export function clearQueue() {
  const cur = P.queue[P.index];
  P.queue = cur ? [cur] : [];
  P.index = cur ? 0 : -1;
  P.original = null;
  emit('queue');
}

function peekNext() {
  if (P.index + 1 < P.queue.length) return getTrack(P.queue[P.index + 1]);
  if (S.settings.playback.repeat === 'all' && P.queue.length) return getTrack(P.queue[0]);
  return null;
}

export function next(auto = false) {
  if (!P.queue.length) return;
  if (P.index + 1 < P.queue.length) P.index++;
  else if (S.settings.playback.repeat === 'all' || !auto) P.index = 0;
  else {
    audio.pause();
    audio.currentTime = 0;
    emit('state');
    return;
  }
  emit('queue');
  load(getTrack(P.queue[P.index]));
}

export function prev() {
  if (audio.currentTime > 3 || P.index <= 0) {
    audio.currentTime = 0;
    if (audio.paused) playSafe();
    return;
  }
  P.index--;
  emit('queue');
  load(getTrack(P.queue[P.index]));
}

export function toggle() {
  if (!P.current) {
    // nic nie gra – wznów ostatnią sesję lub nic
    if (P.queue.length) return playAt(Math.max(0, P.index));
    return;
  }
  if (!audio.src) {
    const t = pendingStart;
    pendingStart = 0;
    return load(P.current, { startAt: t });
  }
  if (audio.paused) fadeIn(); else fadeOut();
}

function fadeIn() {
  const ms = S.settings.playback.fadeMs || 0;
  const target = volumeValue();
  if (!ms) { audio.volume = target; return playSafe(); }
  audio.volume = 0;
  playSafe();
  rampVolume(target, ms);
}

function fadeOut() {
  cancelTransition();
  const ms = S.settings.playback.fadeMs || 0;
  if (!ms) return audio.pause();
  const el = audio;
  rampVolume(0, ms, () => { el.pause(); el.volume = volumeValue(); });
}

// Płynna zmiana głośności. Zegar zamiast requestAnimationFrame: rAF nie działa, gdy okno jest
// niewidoczne (zablokowany ekran, zasłonięte okno, Wayland) – ściszanie stawało wtedy w połowie
// i po powrocie muzyka „grała” bez dźwięku. Krok liczony z upływu czasu, więc nawet rzadki zegar kończy na czas.
let rampId = 0;
function rampVolume(target, ms, done) {
  const id = ++rampId;
  const el = audio;
  const start = el.volume;
  const t0 = performance.now();
  target = Math.max(0, Math.min(1, target));
  const step = () => {
    if (id !== rampId) return;
    const k = Math.min(1, (performance.now() - t0) / ms);
    if (el !== audio) return;
    el.volume = Math.max(0, Math.min(1, start + (target - start) * k));
    if (k < 1) setTimeout(step, 16);
    else done?.();
  };
  step();
}

export function pause() { if (!audio.paused) fadeOut(); }
export function play() {
  if (audio.paused) return toggle();
  // „gra”, ale mogło zostać przerwane ściszanie – dociągnij głośność do właściwej
  if (Math.abs(audio.volume - volumeValue()) > 0.01) rampVolume(volumeValue(), S.settings.playback.fadeMs || 250);
}

export function seek(t) {
  if (!Number.isFinite(audio.duration)) return;
  audio.currentTime = Math.max(0, Math.min(audio.duration - 0.2, t));
  emit('time');
}

export function seekBy(d) { seek(audio.currentTime + d); }

// Tymczasowe ściszanie przez pluginy (np. Discord gdy ktoś mówi, GoToSleep) – mnożniki per plugin
const ducks = new Map();
function duckFactor() {
  let f = 1;
  for (const v of ducks.values()) f *= v;
  return f;
}
export function setDuck(id, factor, ms = 300) {
  if (factor >= 1) ducks.delete(id);
  else ducks.set(id, Math.max(0, factor));
  if (audio.paused || !ms) { rampId++; audio.volume = volumeValue(); return; }
  rampVolume(volumeValue(), ms);
}

function volumeValue(track = P.current) {
  const pb = S.settings.playback;
  return (pb.muted ? 0 : Math.pow(pb.volume, 2)) * duckFactor() * attenOf(track); // krzywa percepcyjna
}

/** Wzmocnienie basu w dB (BASS_MIN…BASS_MAX), 0 = wyłączone */
export function setBass(db) {
  S.settings.playback.bass = Math.round(Math.max(BASS_MIN, Math.min(BASS_MAX, Number(db) || 0)));
  applyEq();
  if (ctx?.state === 'suspended' && P.playing) ctx.resume();
  saveSettings();
  emit('bass');
}

export function setVolume(v) {
  S.settings.playback.volume = Math.max(0, Math.min(1, v));
  S.settings.playback.muted = false;
  rampId++;
  audio.volume = volumeValue();
  saveSettings();
  emit('volume');
}

export function toggleMute() {
  S.settings.playback.muted = !S.settings.playback.muted;
  rampId++;
  audio.volume = volumeValue();
  saveSettings();
  emit('volume');
}

export function toggleShuffle() {
  const pb = S.settings.playback;
  pb.shuffle = !pb.shuffle;
  if (P.queue.length) {
    const cur = P.queue[P.index];
    if (pb.shuffle) {
      P.original = P.queue.slice();
      const rest = P.queue.filter((_, i) => i !== P.index);
      shuffleArr(rest);
      P.queue = [cur, ...rest];
      P.index = 0;
    } else if (P.original) {
      P.queue = P.original;
      P.index = Math.max(0, P.queue.indexOf(cur));
      P.original = null;
    }
    emit('queue');
  }
  saveSettings();
  emit('modes');
}

export function cycleRepeat() {
  const pb = S.settings.playback;
  pb.repeat = pb.repeat === 'off' ? 'all' : pb.repeat === 'all' ? 'one' : 'off';
  saveSettings();
  emit('modes');
}

function shuffleArr(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------- sesja ----------------
let lastSessionSave = 0;
export function saveSession() {
  lastSessionSave = performance.now();
  const { resumeAfterUpdate, resumeAfterReload } = S.data.session || {}; // nie gub znaczników przy zamykaniu
  S.data.session = { queue: P.queue.slice(-1000), index: P.index, time: audio.currentTime || 0, context: P.context, ...(resumeAfterUpdate ? { resumeAfterUpdate } : {}), ...(resumeAfterReload ? { resumeAfterReload } : {}) };
  saveData();
}

export function restoreSession() {
  const s = S.data.session;
  audio.volume = volumeValue();
  const reload = s?.resumeAfterReload; // np. po zmianie języka
  if (reload) {
    delete s.resumeAfterReload;
    saveData();
    if (reload.playing) setTimeout(() => { if (P.current && !P.playing) toggle(); }, 300);
  }
  if (!s || !(S.settings.playback.resume || reload) || !s.queue?.length) return;
  const ids = s.queue.filter((id) => getTrack(id));
  if (!ids.length) return;
  P.queue = ids;
  P.index = Math.min(Math.max(0, s.index), ids.length - 1);
  P.context = s.context || null;
  emit('queue');
  const t = getTrack(ids[P.index]);
  P.current = t;
  emit('track', t);
  // załaduj bez odtwarzania (lokalne/pobrane od razu; strumień przy pierwszym "play")
  if (t.source === 'local' || S.data.downloads[t.id]) load(t, { autoplay: false, startAt: s.time || 0 });
  else pendingStart = s.time || 0;
}

// ---------------- Media Session ----------------
function updateMediaSession(t) {
  if (!('mediaSession' in navigator) || !t) return;
  const art = t.thumb && !t.thumb.startsWith('jm:') ? [{ src: t.thumb.replace('mqdefault', 'hqdefault'), sizes: '480x360' }] : [];
  navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist || '', album: t.album || '', artwork: art });
}

if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  ms.setActionHandler('play', () => play());
  ms.setActionHandler('pause', () => pause());
  ms.setActionHandler('nexttrack', () => next());
  ms.setActionHandler('previoustrack', () => prev());
  ms.setActionHandler('seekto', (d) => seek(d.seekTime));
  ms.setActionHandler('seekforward', () => seekBy(10));
  ms.setActionHandler('seekbackward', () => seekBy(-10));
  on('time', () => {
    if (audio.duration && Number.isFinite(audio.duration)) {
      try { ms.setPositionState({ duration: audio.duration, position: Math.min(audio.currentTime, audio.duration), playbackRate: 1 }); } catch {}
    }
  });
}

window.addEventListener('beforeunload', saveSession);

export function queueTracks() { return tracksOf(P.queue); }
