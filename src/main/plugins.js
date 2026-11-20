// Pluginy: aplikacja nie ma wbudowanych pluginów – instaluje się je ze sklepu
// (katalog dołączony do aplikacji + opcjonalny zdalny katalog JSON) do userData/plugins.
const { app, net } = require('electron');
const fs = require('fs');
const path = require('path');

const catalogDir = path.join(__dirname, '..', '..', 'store'); // lokalny katalog sklepu
const userDir = () => path.join(app.getPath('userData'), 'plugins');
const dirs = new Map(); // id -> katalog zainstalowanego pluginu

function readManifest(dir) {
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const id = String(m.id || path.basename(dir)).replace(/[^a-z0-9_-]/gi, '');
  return {
    id,
    name: m.name || id,
    version: m.version || '0.0.0',
    short: m.short || '',
    description: m.description || m.short || '',
    author: m.author || '',
    icon: m.icon || 'puzzle',
    tags: m.tags || [],
    main: m.main || 'index.js',
    style: m.style || null,
    files: m.files || null,
    permissions: m.permissions || [],
  };
}

function readDir(base) {
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = path.join(base, e.name);
    try {
      out.push({ ...readManifest(dir), dir });
    } catch (err) {
      console.warn('[plugins] invalid plugin', dir, err.message);
    }
  }
  return out;
}

// zainstalowane pluginy
function list() {
  fs.mkdirSync(userDir(), { recursive: true });
  const items = readDir(userDir());
  dirs.clear();
  for (const p of items) dirs.set(p.id, p.dir);
  return items.map(({ dir, ...rest }) => rest);
}

function dirOf(id) {
  if (!dirs.size) list();
  return dirs.get(id) || null;
}

// ---------------- sklep ----------------
let remoteCache = { url: null, at: 0, items: [] };

async function remoteCatalog(url) {
  if (!url || !/^https:\/\//.test(url)) return [];
  if (remoteCache.url === url && Date.now() - remoteCache.at < 10 * 60e3) return remoteCache.items;
  const res = await net.fetch(url);
  if (!res.ok) throw new Error('Katalog: HTTP ' + res.status);
  const j = await res.json();
  const base = url.replace(/[^/]*$/, '');
  const items = (j.plugins || []).map((p) => ({
    ...p,
    remote: true,
    baseUrl: p.baseUrl || base + p.id + '/',
    files: p.files || ['manifest.json', p.main || 'index.js'],
  }));
  remoteCache = { url, at: Date.now(), items };
  return items;
}

async function catalog(remoteUrl) {
  const local = readDir(catalogDir).map(({ dir, ...p }) => ({ ...p, remote: false }));
  let remote = [];
  let error = null;
  try { remote = await remoteCatalog(remoteUrl); } catch (e) { error = e.message; }
  const map = new Map();
  for (const p of local) map.set(p.id, p);
  for (const p of remote) {
    const cur = map.get(p.id);
    // wersja z GitHuba ma pierwszeństwo (gdy nie starsza niż dołączona do aplikacji)
    if (!cur || String(p.version).localeCompare(String(cur.version), undefined, { numeric: true }) >= 0) map.set(p.id, p);
  }
  return { items: [...map.values()], error };
}

function safeRel(file) {
  const n = path.normalize(file).replace(/^([/\\])+/, '');
  if (n.startsWith('..') || path.isAbsolute(n)) throw new Error('Nieprawidłowa ścieżka pliku: ' + file);
  return n;
}

async function install(id, remoteUrl) {
  const { items } = await catalog(remoteUrl);
  const p = items.find((x) => x.id === id);
  if (!p) throw new Error('Nie znaleziono pluginu w sklepie');
  const target = path.join(userDir(), p.id);
  const tmp = target + '.installing';
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  try {
    if (p.remote) {
      for (const f of p.files) {
        const rel = safeRel(f);
        const res = await net.fetch(p.baseUrl + rel.split(path.sep).join('/'));
        if (!res.ok) throw new Error(`Pobieranie ${rel}: HTTP ${res.status}`);
        fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
        fs.writeFileSync(path.join(tmp, rel), Buffer.from(await res.arrayBuffer()));
      }
    } else {
      fs.cpSync(path.join(catalogDir, path.basename(id)), tmp, { recursive: true });
    }
    readManifest(tmp); // walidacja
    fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(tmp, target);
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
  return list();
}

function uninstall(id) {
  const dir = path.join(userDir(), path.basename(id));
  fs.rmSync(dir, { recursive: true, force: true });
  return list();
}

module.exports = { list, dirOf, userDir, catalog, install, uninstall };
