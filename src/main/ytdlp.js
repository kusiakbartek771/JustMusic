// Integracja z yt-dlp: wyszukiwanie, strumienie audio, pobieranie, playlisty.
const { app, net } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const isWin = process.platform === 'win32';

let cfg = {};            // ustawienia youtube + downloads z renderera
let bin = null;          // ścieżka do działającego yt-dlp
let version = null;
let ffmpeg = null;
let installing = null;

const streamCache = new Map(); // ytId -> { url, expires }

function setConfig(c) {
  cfg = c || {};
}

function which(cmd) {
  const exts = isWin ? ['.exe', '.cmd', '.bat', ''] : [''];
  const dirs = (process.env.PATH || '').split(path.delimiter);
  // typowe lokalizacje, których PATH aplikacji GUI na macOS często nie zawiera
  if (process.platform === 'darwin') dirs.push('/opt/homebrew/bin', '/usr/local/bin');
  if (process.platform === 'linux') dirs.push('/usr/bin', '/usr/local/bin', path.join(app.getPath('home'), '.local/bin'));
  for (const d of dirs) {
    for (const e of exts) {
      const p = path.join(d, cmd + e);
      try {
        if (fs.statSync(p).isFile()) return p;
      } catch {}
    }
  }
  return null;
}

function localBin() {
  return path.join(app.getPath('userData'), 'bin', isWin ? 'yt-dlp.exe' : 'yt-dlp');
}

function releaseAsset() {
  if (isWin) return 'yt-dlp.exe';
  if (process.platform === 'darwin') return 'yt-dlp_macos';
  return process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';
}

function exec(file, args, { timeout = 120000, env } = {}) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let done = false;
    const p = spawn(file, args, { env: env || process.env, windowsHide: true });
    const t = setTimeout(() => { if (!done) p.kill(); }, timeout);
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => { done = true; clearTimeout(t); resolve({ code: -1, stdout: out, stderr: String(e) }); });
    p.on('close', (code) => { done = true; clearTimeout(t); resolve({ code, stdout: out, stderr: err }); });
  });
}

async function detect() {
  const candidates = [cfg.ytdlpPath, localBin(), which('yt-dlp')].filter(Boolean);
  bin = null;
  version = null;
  for (const c of candidates) {
    if (!fs.existsSync(c)) continue;
    const r = await exec(c, ['--version'], { timeout: 20000 });
    if (r.code === 0) {
      bin = c;
      version = r.stdout.trim();
      break;
    }
  }
  // kolejność: własna ścieżka → ffmpeg z systemu → ffmpeg pobrany przez JustMusic
  const local = require('./ffmpeg').localFfmpeg();
  ffmpeg = cfg.ffmpegPath && fs.existsSync(cfg.ffmpegPath) ? cfg.ffmpegPath : which('ffmpeg') || (fs.existsSync(local) ? local : null);
  return status();
}

function status() {
  return {
    ready: !!bin,
    path: bin,
    version,
    managed: bin === localBin(),
    ffmpeg,
    ffmpegManaged: !!ffmpeg && ffmpeg === require('./ffmpeg').localFfmpeg(),
    installing: !!installing,
  };
}

// Pobiera samodzielną binarkę yt-dlp z oficjalnych wydań na GitHubie.
async function install(onProgress) {
  if (installing) return installing;
  installing = (async () => {
    const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${releaseAsset()}`;
    const target = localBin();
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    const res = await net.fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`Pobieranie yt-dlp nie powiodło się (HTTP ${res.status})`);
    const total = Number(res.headers.get('content-length')) || 0;
    const tmp = target + '.download';
    const fh = await fs.promises.open(tmp, 'w');
    let got = 0;
    try {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        await fh.write(value);
        got += value.length;
        if (onProgress && total) onProgress(got / total);
      }
    } finally {
      await fh.close();
    }
    if (!isWin) await fs.promises.chmod(tmp, 0o755);
    await fs.promises.rename(tmp, target);
    cfg.ytdlpPath = '';
    return detect();
  })();
  try {
    return await installing;
  } finally {
    installing = null;
  }
}

function versionAtLeast(v) {
  if (!version) return false;
  return version.localeCompare(v, undefined, { numeric: true }) >= 0;
}

function splitArgs(s) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(s || ''))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

// Wspólne argumenty + środowisko (m.in. runtime JS potrzebny YouTube od 2025 r.)
function base() {
  const args = ['--ignore-config', '--no-warnings', '--no-color'];
  const env = { ...process.env };
  if (cfg.jsRuntime !== false && versionAtLeast('2025.11.12')) {
    const node = which('node');
    if (node) {
      args.push('--js-runtimes', 'node');
    } else {
      // Electron może działać jako Node.js – używamy go jako runtime JS dla yt-dlp
      args.push('--js-runtimes', `node:${process.execPath}`);
      env.ELECTRON_RUN_AS_NODE = '1';
    }
  }
  if (cfg.cookiesBrowser) args.push('--cookies-from-browser', cfg.cookiesBrowser);
  if (ffmpeg) args.push('--ffmpeg-location', ffmpeg);
  args.push(...splitArgs(cfg.extraArgs));
  return { args, env };
}

async function run(extra, opts = {}) {
  if (!bin) await detect();
  if (!bin) throw new Error('YTDLP_MISSING');
  const b = base();
  const r = await exec(bin, [...b.args, ...extra], { env: b.env, timeout: opts.timeout || 90000 });
  if (r.code !== 0) {
    const msg = (r.stderr.split('\n').find((l) => l.includes('ERROR')) || r.stderr || 'yt-dlp error').trim();
    throw new Error(msg.slice(0, 400));
  }
  return r.stdout;
}

// --- normalizacja metadanych z YouTube ---------------------------------
const JUNK = /\s*[([][^)\]]*\b(official|lyrics?|video|audio|visuali[sz]er|teledysk|clip|hd|hq|4k|mv|m\/v)\b[^)\]]*[)\]]\s*/gi;

function cleanMeta(rawTitle, channel) {
  let title = (rawTitle || '').replace(JUNK, ' ').replace(/\s{2,}/g, ' ').trim();
  let artist = (channel || '').replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();
  const m = title.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (m && !/ - Topic$/i.test(channel || '')) {
    artist = m[1].trim();
    title = m[2].trim();
  }
  title = title.replace(/^["“](.+)["”]$/, '$1');
  return { title: title || rawTitle || '', artist };
}

function mapEntry(e) {
  if (!e || !e.id) return null;
  const { title, artist } = cleanMeta(e.title, e.channel || e.uploader || e.artist);
  return {
    id: 'yt:' + e.id,
    source: 'youtube',
    ytId: e.id,
    title,
    artist: e.artist || artist || '',
    album: e.album || '',
    duration: Math.round(e.duration || 0),
    thumb: `https://i.ytimg.com/vi/${e.id}/mqdefault.jpg`,
    rawTitle: e.title || '',
    channel: e.channel || e.uploader || '',
  };
}

async function search(query, limit = 25) {
  const n = Math.max(5, Math.min(60, limit | 0));
  if (cfg.searchMode === 'music') {
    try {
      const url = `https://music.youtube.com/search?q=${encodeURIComponent(query)}#songs`;
      const out = await run(['--flat-playlist', '-J', '--playlist-end', String(n), url]);
      const list = (JSON.parse(out).entries || []).map(mapEntry).filter(Boolean);
      if (list.length) return list;
    } catch (e) {
      console.warn('[yt] music search failed, fallback', e.message);
    }
  }
  const out = await run(['--flat-playlist', '-J', `ytsearch${n}:${query}`]);
  return (JSON.parse(out).entries || []).map(mapEntry).filter(Boolean);
}

// Link do filmu lub playlisty YouTube
async function fromUrl(url) {
  const out = await run(['--flat-playlist', '-J', url], { timeout: 180000 });
  const j = JSON.parse(out);
  if (j._type === 'playlist' || Array.isArray(j.entries)) {
    return {
      kind: 'playlist',
      name: j.title || 'Playlista YouTube',
      author: j.channel || j.uploader || '',
      cover: j.thumbnails?.length ? j.thumbnails[j.thumbnails.length - 1].url : null,
      tracks: (j.entries || []).map(mapEntry).filter(Boolean),
    };
  }
  const t = mapEntry(j);
  return { kind: 'track', name: t.title, author: t.artist, cover: t.thumb, tracks: [t] };
}

// Adres strumienia + nagłówki HTTP wymagane przez YouTube (np. User-Agent klienta,
// którym yt-dlp pobrał adres). Strumień jest potem przekazywany przez proces główny.
const pendingInfo = new Map();
async function streamInfo(ytId, fresh = false) {
  const c = streamCache.get(ytId);
  if (!fresh && c && c.expires > Date.now()) return c;
  if (!fresh && pendingInfo.has(ytId)) return pendingInfo.get(ytId);
  const p = (async () => {
    const out = await run(['-f', 'bestaudio[ext=m4a]/bestaudio[protocol=https]/bestaudio/best', '-j', '--no-playlist', `https://www.youtube.com/watch?v=${ytId}`]);
    const j = JSON.parse(out);
    const fmt = j.url ? j : (j.requested_formats || [])[0] || {};
    const url = fmt.url;
    if (!url || !/^https?:/.test(url)) throw new Error('Brak strumienia audio');
    let expires = Date.now() + 3 * 3600e3;
    try {
      const e = Number(new URL(url).searchParams.get('expire'));
      if (e) expires = e * 1000 - 120e3;
    } catch {}
    const ext = fmt.ext || j.ext || 'm4a';
    const mime = ext === 'webm' ? 'audio/webm' : ext === 'mp3' ? 'audio/mpeg' : 'audio/mp4';
    // YouTube udostępnia adres dopiero po kilku sekundach (pole available_at) – wcześniej zwraca 403
    const availableAt = (fmt.available_at || j.available_at || 0) * 1000;
    let size = fmt.filesize || 0;
    try { size = size || Number(new URL(url).searchParams.get('clen')) || 0; } catch {}
    const chunk = fmt.downloader_options?.http_chunk_size || j.downloader_options?.http_chunk_size || 10485760;
    const info = { url, headers: fmt.http_headers || j.http_headers || {}, expires, mime, size, availableAt, chunk };
    streamCache.set(ytId, info);
    if (streamCache.size > 300) streamCache.delete(streamCache.keys().next().value);
    return info;
  })();
  pendingInfo.set(ytId, p);
  try {
    return await p;
  } finally {
    pendingInfo.delete(ytId);
  }
}

// Proxy strumienia dla protokołu jm://app/yt?id=… (z obsługą Range = przewijanie).
async function proxyStream(ytId, req, fresh = false) {
  const info = await streamInfo(ytId, fresh);
  const wait = info.availableAt - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, Math.min(wait + 250, 15000)));
  const headers = { ...info.headers };
  delete headers['Accept-Encoding'];
  // zakres o jaki prosi odtwarzacz, przycięty do rozmiaru kawałka (jak w yt-dlp)
  const range = req.headers.get('range');
  const m = /bytes=(\d*)-(\d*)/.exec(range || '');
  let start = m && m[1] ? Number(m[1]) : 0;
  let end = m && m[2] ? Number(m[2]) : info.size ? info.size - 1 : NaN;
  if (Number.isFinite(end)) end = Math.min(end, start + info.chunk - 1);
  headers.Range = `bytes=${start}-${Number.isFinite(end) ? end : ''}`;
  const res = await fetch(info.url, { headers, redirect: 'follow' });
  if ((res.status === 403 || res.status === 410) && !fresh) {
    try { await res.body?.cancel(); } catch {}
    return proxyStream(ytId, req, true);
  }
  if (!res.ok) throw new Error('YouTube HTTP ' + res.status);
  const out = new Headers();
  out.set('Content-Type', info.mime);
  out.set('Accept-Ranges', 'bytes');
  for (const h of ['content-length', 'content-range']) {
    const v = res.headers.get(h);
    if (v) out.set(h, v);
  }
  return new Response(res.body, { status: 206, headers: out });
}

async function stream(ytId, fresh = false) {
  await streamInfo(ytId, fresh);
  return `jm://app/yt?id=${encodeURIComponent(ytId)}${fresh ? '&r=' + Date.now() : ''}`;
}

// Dopasowanie utworu (np. ze Spotify) do filmu na YouTube
const BAD = ['live', 'cover', 'karaoke', 'instrumental', 'remix', 'sped up', 'slowed', 'nightcore', '8d', 'reverb', 'reaction', 'tutorial', 'lesson', 'bass boosted'];

async function resolve({ title, artist, duration }) {
  const q = `${artist ? artist + ' - ' : ''}${title} audio`;
  const out = await run(['--flat-playlist', '-J', `ytsearch8:${q}`]);
  const entries = (JSON.parse(out).entries || []).filter((e) => e && e.id);
  if (!entries.length) throw new Error('Nie znaleziono utworu na YouTube');
  const want = `${title} ${artist}`.toLowerCase();
  const words = title.toLowerCase().split(/\W+/).filter((w) => w.length > 1);
  let best = null;
  let bestScore = -Infinity;
  entries.forEach((e, i) => {
    const t = (e.title || '').toLowerCase();
    const ch = (e.channel || e.uploader || '').toLowerCase();
    let s = -i * 2;
    if (duration && e.duration) {
      const d = Math.abs(e.duration - duration);
      s += d <= 3 ? 30 : d <= 8 ? 15 : d <= 20 ? 0 : -25 - Math.min(d, 120) / 4;
    }
    s += words.filter((w) => t.includes(w)).length * 4;
    if (artist && (ch.includes(artist.toLowerCase()) || t.includes(artist.toLowerCase()))) s += 12;
    if (/ - topic$/.test(ch)) s += 10;
    if (/official audio|audio/.test(t)) s += 4;
    for (const b of BAD) if (t.includes(b) && !want.includes(b)) s -= 18;
    if (s > bestScore) { bestScore = s; best = e; }
  });
  return best.id;
}

// --- pobieranie ---------------------------------------------------------
const jobs = new Map();

function sanitize(s) {
  return (s || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/, '')
    .trim()
    .slice(0, 150);
}

function formatArgs(format) {
  const hasFF = !!ffmpeg;
  if (!hasFF) return { args: ['-f', 'bestaudio[ext=m4a]/bestaudio'] };
  switch (format) {
    case 'mp3':
      return { args: ['-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', '0', '--embed-thumbnail', '--convert-thumbnails', 'jpg', '--embed-metadata'] };
    case 'opus':
      return { args: ['-f', 'bestaudio[acodec=opus]/bestaudio', '-x', '--audio-format', 'opus', '--embed-thumbnail', '--embed-metadata'] };
    case 'best':
      return { args: ['-f', 'bestaudio', '-x', '--embed-metadata'] };
    case 'm4a':
    default:
      return { args: ['-f', 'bestaudio[ext=m4a]/bestaudio', '-x', '--audio-format', 'm4a', '--embed-thumbnail', '--convert-thumbnails', 'jpg', '--embed-metadata'] };
  }
}

// Nadpisuje tagi pliku czystymi metadanymi (bez rekodowania).
async function retag(file, meta) {
  if (!ffmpeg) return file;
  const ext = path.extname(file);
  const tmp = file.slice(0, -ext.length) + '.jmtmp' + ext;
  const args = ['-y', '-v', 'error', '-i', file, '-map', '0', '-c', 'copy'];
  if (meta.title) args.push('-metadata', `title=${meta.title}`);
  if (meta.artist) args.push('-metadata', `artist=${meta.artist}`);
  if (meta.album) args.push('-metadata', `album=${meta.album}`);
  args.push(tmp);
  const r = await exec(ffmpeg, args, { timeout: 120000 });
  if (r.code === 0) {
    await fs.promises.rename(tmp, file);
  } else {
    fs.promises.unlink(tmp).catch(() => {});
  }
  return file;
}

function download(job, emit) {
  const { id, ytId, title, artist, album, dir, format, tag } = job;
  const send = (patch) => emit({ id, ...patch });
  (async () => {
    if (!bin) await detect();
    if (!bin) throw new Error('Brak yt-dlp – zainstaluj go w Ustawieniach → Pobieranie');
    await fs.promises.mkdir(dir, { recursive: true });
    const name = sanitize(`${artist ? artist + ' - ' : ''}${title}`) || ytId;
    const b = base();
    const fa = formatArgs(format);
    const args = [
      ...b.args,
      ...fa.args,
      '--no-playlist',
      '--newline',
      '--progress',
      '--progress-template', 'download:JMPROG %(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s',
      '--print', 'after_move:JMFILE %(filepath)s',
      '-o', path.join(dir, name + '.%(ext)s'),
      `https://www.youtube.com/watch?v=${ytId}`,
    ];
    send({ status: 'downloading', percent: 0 });
    const proc = spawn(bin, args, { env: b.env, windowsHide: true });
    jobs.set(id, proc);
    let file = null;
    let errLine = '';
    const onLine = (line) => {
      line = line.trim();
      if (line.startsWith('JMPROG ')) {
        const [p, speed, eta] = line.slice(7).split('|').map((s) => s.trim());
        const percent = parseFloat(p);
        if (!Number.isNaN(percent)) send({ status: 'downloading', percent, speed, eta });
      } else if (line.startsWith('JMFILE ')) {
        file = line.slice(7).trim();
      } else if (line.includes('[ExtractAudio]') || line.includes('[Metadata]') || line.includes('[EmbedThumbnail]')) {
        send({ status: 'processing', percent: 100 });
      } else if (line.includes('ERROR')) {
        errLine = line;
      }
    };
    const lineReader = (stream) => {
      let buf = '';
      stream.on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.search(/[\r\n]/)) >= 0) {
          onLine(buf.slice(0, i));
          buf = buf.slice(i + 1);
        }
      });
    };
    lineReader(proc.stdout);
    lineReader(proc.stderr);
    const code = await new Promise((r) => {
      proc.on('close', r);
      proc.on('error', () => r(-1));
    });
    jobs.delete(id);
    if (proc.killedByUser) {
      send({ status: 'canceled' });
      return;
    }
    if (code !== 0 || !file) throw new Error(errLine || `yt-dlp zakończył się kodem ${code}`);
    if (tag !== false) {
      send({ status: 'processing', percent: 100 });
      await retag(file, { title, artist, album }).catch(() => {});
    }
    send({ status: 'done', percent: 100, file });
  })().catch((e) => {
    jobs.delete(id);
    send({ status: 'error', error: e.message });
  });
}

function cancel(id) {
  const p = jobs.get(id);
  if (p) {
    p.killedByUser = true;
    p.kill();
  }
}

// Pobranie do cache – awaryjne odtwarzanie, gdy bezpośredni strumień zawodzi.
function cacheDir() {
  return path.join(app.getPath('userData'), 'cache');
}

const caching = new Map();
async function cache(ytId) {
  const dir = cacheDir();
  await fs.promises.mkdir(dir, { recursive: true });
  const existing = (await fs.promises.readdir(dir)).find((f) => f.startsWith(ytId + '.') && !f.endsWith('.part'));
  if (existing) return path.join(dir, existing);
  if (caching.has(ytId)) return caching.get(ytId);
  const p = (async () => {
    const out = await run(['-f', 'bestaudio[ext=m4a]/bestaudio', '--no-playlist', '--print', 'after_move:filepath', '-o', path.join(dir, '%(id)s.%(ext)s'), `https://www.youtube.com/watch?v=${ytId}`], { timeout: 600000 });
    const file = out.trim().split('\n').pop().trim();
    if (!file || !fs.existsSync(file)) throw new Error('Buforowanie nie powiodło się');
    return file;
  })();
  caching.set(ytId, p);
  try {
    return await p;
  } finally {
    caching.delete(ytId);
  }
}

async function cacheInfo() {
  const dir = cacheDir();
  let size = 0;
  let count = 0;
  try {
    for (const f of await fs.promises.readdir(dir)) {
      const st = await fs.promises.stat(path.join(dir, f));
      size += st.size;
      count++;
    }
  } catch {}
  return { size, count, dir };
}

async function cacheClear() {
  await fs.promises.rm(cacheDir(), { recursive: true, force: true });
  return cacheInfo();
}

module.exports = { setConfig, detect, status, install, search, fromUrl, stream, proxyStream, resolve, download, cancel, cache, cacheInfo, cacheClear, sanitize };
