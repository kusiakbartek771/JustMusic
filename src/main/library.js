// Skanowanie lokalnych plików muzycznych (przyrostowe, z cache metadanych).
const fs = require('fs');
const path = require('path');
const store = require('./store');

const EXT = new Set(['.mp3', '.m4a', '.mp4', '.aac', '.flac', '.ogg', '.oga', '.opus', '.wav', '.webm']);
const MIME = {
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.mp4': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac',
  '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav', '.webm': 'audio/webm',
};

let mm = null;
async function meta() {
  if (!mm) mm = await import('music-metadata');
  return mm;
}

let cache = null; // { files: { [path]: { mtime, size, track } }, extra: [] }
function getCache() {
  if (!cache) cache = store.load('library-cache', { files: {}, extra: [] });
  if (!cache.files) cache.files = {};
  if (!cache.extra) cache.extra = [];
  return cache;
}

function persist() {
  return store.save('library-cache', getCache());
}

async function walk(dir, out, depth = 0) {
  if (depth > 20) return;
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out, depth + 1);
    else if (e.isFile() && EXT.has(path.extname(e.name).toLowerCase())) out.push(p);
  }
}

function fromFilename(p) {
  const base = path.basename(p, path.extname(p)).replace(/_/g, ' ');
  const m = base.match(/^(?:\d{1,3}[.\s-]+)?(.+?)\s+[-–]\s+(.+)$/);
  if (m) return { artist: m[1].trim(), title: m[2].trim() };
  return { artist: '', title: base.replace(/^\d{1,3}[.\s-]+/, '').trim() };
}

async function parseTrack(p, st) {
  const fb = fromFilename(p);
  let common = {};
  let format = {};
  try {
    const { parseFile } = await meta();
    const r = await parseFile(p, { skipCovers: true, duration: false, skipPostHeaders: true });
    common = r.common || {};
    format = r.format || {};
  } catch {}
  return {
    id: 'local:' + p,
    source: 'local',
    path: p,
    title: common.title || fb.title,
    artist: common.artist || (common.artists || []).join(', ') || fb.artist || 'Nieznany wykonawca',
    album: common.album || '',
    year: common.year || null,
    trackNo: common.track?.no || null,
    genre: (common.genre || [])[0] || '',
    duration: Math.round(format.duration || 0),
    thumb: `jm://app/cover?p=${encodeURIComponent(p)}`,
    added: Math.round(st.mtimeMs),
  };
}

async function pool(items, n, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
}

let scanning = null;
async function scan(folders, onProgress) {
  if (scanning) return scanning;
  scanning = (async () => {
    const c = getCache();
    const files = [];
    for (const f of folders || []) await walk(f, files);
    for (const f of c.extra) if (fs.existsSync(f)) files.push(f);
    const unique = [...new Set(files)];
    const next = {};
    let done = 0;
    let changed = false;
    await pool(unique, 8, async (p) => {
      try {
        const st = await fs.promises.stat(p);
        const prev = c.files[p];
        if (prev && prev.mtime === st.mtimeMs && prev.size === st.size) {
          next[p] = prev;
        } else {
          next[p] = { mtime: st.mtimeMs, size: st.size, track: await parseTrack(p, st) };
          changed = true;
        }
      } catch {}
      done++;
      if (onProgress && (done % 25 === 0 || done === unique.length)) onProgress({ done, total: unique.length });
    });
    if (changed || Object.keys(c.files).length !== Object.keys(next).length) {
      c.files = next;
      await persist();
    }
    return tracks();
  })();
  try {
    return await scanning;
  } finally {
    scanning = null;
  }
}

function tracks() {
  return Object.values(getCache().files).map((f) => f.track);
}

async function addFiles(paths) {
  const c = getCache();
  const added = [];
  for (const p of paths) {
    if (!EXT.has(path.extname(p).toLowerCase())) continue;
    try {
      const st = await fs.promises.stat(p);
      if (!st.isFile()) continue;
      const track = await parseTrack(p, st);
      c.files[p] = { mtime: st.mtimeMs, size: st.size, track };
      if (!c.extra.includes(p)) c.extra.push(p);
      added.push(track);
    } catch {}
  }
  if (added.length) await persist();
  return added;
}

async function removeFile(p) {
  const c = getCache();
  delete c.files[p];
  c.extra = c.extra.filter((x) => x !== p);
  await persist();
}

// Okładki (osadzone w pliku lub cover.jpg w folderze), cache w pamięci.
const coverCache = new Map();
const COVER_NAMES = ['cover.jpg', 'cover.png', 'folder.jpg', 'folder.png', 'front.jpg', 'album.jpg', 'Cover.jpg', 'Folder.jpg'];

async function cover(p) {
  if (coverCache.has(p)) return coverCache.get(p);
  let result = null;
  try {
    const { parseFile } = await meta();
    const r = await parseFile(p, { skipPostHeaders: true, duration: false });
    const pic = r.common.picture?.[0];
    if (pic) result = { data: Buffer.from(pic.data), type: pic.format || 'image/jpeg' };
  } catch {}
  if (!result) {
    const dir = path.dirname(p);
    for (const n of COVER_NAMES) {
      try {
        const data = await fs.promises.readFile(path.join(dir, n));
        result = { data, type: n.endsWith('.png') ? 'image/png' : 'image/jpeg' };
        break;
      } catch {}
    }
  }
  coverCache.set(p, result);
  if (coverCache.size > 300) coverCache.delete(coverCache.keys().next().value);
  return result;
}

module.exports = { EXT, MIME, scan, tracks, addFiles, removeFile, cover };
