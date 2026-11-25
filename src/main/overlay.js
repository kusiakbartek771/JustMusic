// Lokalny serwer nakładek dla pluginów (np. do streamowania): strona pluginu jest dostępna pod
// http://127.0.0.1:<port>/<plugin>/… – tak dodaje się ją w OBS, Streamlabs czy TikTok LIVE Studio
// jako źródło „Przeglądarka” / „Link”. Dane na żywo idą przez Server-Sent Events (/<plugin>/events).
// Serwer słucha tylko na 127.0.0.1 i udostępnia wyłącznie pliki z folderu pluginu.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let server = null;
let port = 0;
const sites = new Map(); // pluginId -> { dir, last, clients: Set<res> }
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.gif': 'image/gif', '.webp': 'image/webp' };
const safeId = (id) => /^[a-z0-9_-]{1,64}$/i.test(String(id || ''));

function handler(req, res) {
  // tylko lokalnie, bez wywołań z innych stron (DNS rebinding)
  const host = String(req.headers.host || '').replace(/:\d+$/, '');
  if (!['127.0.0.1', 'localhost'].includes(host)) { res.writeHead(403); return res.end(); }
  if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
  const url = new URL(req.url, 'http://127.0.0.1');
  const [, id, ...rest] = decodeURIComponent(url.pathname).split('/');
  const site = sites.get(id);
  if (!site) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('JustMusic: ta nakładka jest wyłączona – włącz plugin w JustMusic.'); }
  const rel = rest.join('/') || 'overlay.html';
  if (rel === 'events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' });
    res.write('retry: 2000\n\n');
    if (site.last) res.write(`data: ${site.last}\n\n`);
    site.clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => { clearInterval(ping); site.clients.delete(res); });
    return;
  }
  if (rel === 'state.json') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
    return res.end(site.last || '{}');
  }
  const file = path.resolve(site.dir, rel);
  if (!file.startsWith(path.resolve(site.dir) + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

function listen(want) {
  return new Promise((resolve, reject) => {
    const s = http.createServer(handler);
    s.once('error', reject);
    s.listen(want, '127.0.0.1', () => resolve(s));
  });
}

/** Uruchamia serwer (jeden dla wszystkich pluginów) i rejestruje stronę pluginu. */
async function start(pluginId, dir, wantPort = 4848) {
  if (!safeId(pluginId) || !dir) throw new Error('Nieprawidłowy plugin');
  wantPort = Math.max(1024, Math.min(65535, Number(wantPort) || 4848));
  if (server && port !== wantPort && sites.size <= (sites.has(pluginId) ? 1 : 0)) { server.close(); server = null; }
  if (!server) {
    try { server = await listen(wantPort); } catch (e) {
      if (e.code === 'EADDRINUSE') throw new Error(`Port ${wantPort} jest zajęty – wybierz inny w ustawieniach pluginu`);
      throw e;
    }
    port = wantPort;
  }
  const prev = sites.get(pluginId);
  sites.set(pluginId, { dir, last: prev?.last || null, clients: prev?.clients || new Set() });
  return { port, url: `http://127.0.0.1:${port}/${pluginId}/` };
}

function push(pluginId, data) {
  const site = sites.get(pluginId);
  if (!site) return false;
  site.last = JSON.stringify(data ?? null);
  for (const res of site.clients) res.write(`data: ${site.last}\n\n`);
  return site.clients.size;
}

function stop(pluginId) {
  const site = sites.get(pluginId);
  if (site) for (const res of site.clients) { try { res.end(); } catch {} }
  sites.delete(pluginId);
  if (!sites.size && server) { server.close(); server = null; port = 0; }
}

/** Plik tekstowy dla źródła „Tekst z pliku” (np. OBS) – w folderze danych aplikacji */
function writeText(pluginId, name, text) {
  if (!safeId(pluginId) || !/^[\w.-]{1,64}\.txt$/.test(String(name))) throw new Error('Nieprawidłowa nazwa pliku');
  const dir = path.join(app.getPath('userData'), 'stream', pluginId);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, String(text ?? ''), 'utf8');
  return file;
}

module.exports = { start, push, stop, writeText };
