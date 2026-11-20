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

const audio = new Audio();
audio.crossOrigin = 'anonymous';
audio.preload = 'auto';

export const P = {
  audio,
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
let ctx = null, srcNode = null, filters = [], preampNode = null, analyser = null, bassNode = null, bassTrim = null;

export function ensureGraph() {
  if (ctx) return { ctx, analyser };
  try {
    ctx = new AudioContext({ latencyHint: 'playback' });
    srcNode = ctx.createMediaElementSource(audio);
    preampNode = ctx.createGain();
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
    let node = srcNode.connect(preampNode).connect(bassNode).connect(bassTrim);
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
  audio.src = src.url;
  if (startAt > 0) {
    const seekOnce = () => { audio.currentTime = startAt; audio.removeEventListener('loadedmetadata', seekOnce); };
    audio.addEventListener('loadedmetadata', seekOnce);
  }
  pushHistory(track.id);
  // błędy odtwarzania obsługuje zdarzenie 'error' (odświeżenie / buforowanie)
  if (autoplay) playSafe();
}

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
    const done = () => { audio.removeEventListener('canplay', ok); audio.removeEventListener('error', bad); };
    audio.addEventListener('canplay', ok);
    audio.addEventListener('error', bad);
  });
}
let recovering = false;

audio.addEventListener('playing', () => { P.loading = false; emit('loading', false); emit('state'); });
audio.addEventListener('waiting', () => { P.loading = true; emit('loading', true); });
audio.addEventListener('canplay', () => { P.loading = false; emit('loading', false); });
audio.addEventListener('pause', () => emit('state'));
audio.addEventListener('play', () => emit('state'));
audio.addEventListener('durationchange', () => emit('time'));
audio.addEventListener('ended', () => {
  if (S.settings.playback.repeat === 'one') {
    audio.currentTime = 0;
    playSafe();
  } else next(true);
});

// Odzyskiwanie po błędzie odtwarzania – wykonywane sekwencyjnie, tylko raz na utwór.
audio.addEventListener('error', async () => {
  const track = P.current;
  if (!track || !audio.src || recovering) return;
  recovering = true;
  const token = loadToken;
  const t = audio.currentTime;
  const err = audio.error;
  console.warn('[player] media error', err?.code, err?.message, audio.src);
  const resumeAt = () => { if (t) audio.addEventListener('loadedmetadata', () => (audio.currentTime = t), { once: true }); };
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
audio.addEventListener('timeupdate', () => {
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
  const ms = S.settings.playback.fadeMs || 0;
  if (!ms) return audio.pause();
  rampVolume(0, ms, () => { audio.pause(); audio.volume = volumeValue(); });
}

let rampId = 0;
function rampVolume(target, ms, done) {
  const id = ++rampId;
  const start = audio.volume;
  const t0 = performance.now();
  const step = (t) => {
    if (id !== rampId) return;
    const k = Math.min(1, (t - t0) / ms);
    audio.volume = start + (target - start) * k;
    if (k < 1) requestAnimationFrame(step); else done?.();
  };
  requestAnimationFrame(step);
}

export function pause() { if (!audio.paused) fadeOut(); }
export function play() { if (audio.paused) toggle(); }

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

function volumeValue() {
  const pb = S.settings.playback;
  return (pb.muted ? 0 : Math.pow(pb.volume, 2)) * duckFactor(); // krzywa percepcyjna
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
  const resumeAfterUpdate = S.data.session?.resumeAfterUpdate; // nie gub znacznika przy zamykaniu
  S.data.session = { queue: P.queue.slice(-1000), index: P.index, time: audio.currentTime || 0, context: P.context, ...(resumeAfterUpdate ? { resumeAfterUpdate } : {}) };
  saveData();
}

export function restoreSession() {
  const s = S.data.session;
  audio.volume = volumeValue();
  if (!s || !S.settings.playback.resume || !s.queue?.length) return;
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
