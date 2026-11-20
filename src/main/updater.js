// Aktualizacje z GitHub Releases.
// - Windows (instalator) i Linux (AppImage): pobieranie i instalacja w aplikacji (electron-updater)
// - pozostałe (portable, .deb, .pacman, macOS bez podpisu, tryb deweloperski): powiadomienie + link do pobrania
const { app, shell, net } = require('electron');
const PKG = require('../../package.json');

const REPO = (PKG.justmusic && PKG.justmusic.repo) || '';
let send = () => {};
let autoUpdater = null;
let state = { state: 'idle', version: null, percent: 0, notes: '', url: null, error: null, auto: false };

function canAutoInstall() {
  if (!app.isPackaged) return false;
  if (process.platform === 'linux') return !!process.env.APPIMAGE;
  if (process.platform === 'win32') return !process.env.PORTABLE_EXECUTABLE_DIR;
  return false; // macOS wymaga podpisanej aplikacji
}

function set(patch) {
  state = { ...state, ...patch };
  send(state);
}

function init(sender) {
  send = sender;
  state.auto = canAutoInstall();
  if (!state.auto) return;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (e) {
    state.auto = false;
    return;
  }
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => set({ state: 'checking', error: null }));
  autoUpdater.on('update-available', (i) => set({ state: 'available', version: i.version, notes: notesText(i.releaseNotes), url: releaseUrl(i.version) }));
  autoUpdater.on('update-not-available', () => set({ state: 'none' }));
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => set({ state: 'ready', version: i.version, percent: 100 }));
  autoUpdater.on('error', (e) => set({ state: 'error', error: e?.message || String(e) }));
}

function notesText(n) {
  if (!n) return '';
  if (Array.isArray(n)) n = n.map((x) => x.note || '').join('\n');
  return String(n).replace(/<[^>]+>/g, '').trim().slice(0, 2000);
}

const releaseUrl = (v) => (REPO ? `https://github.com/${REPO}/releases${v ? `/tag/v${v}` : '/latest'}` : null);

function newer(a, b) {
  const pa = String(a).replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

// Plik do pobrania dla tego systemu (tryb ręczny)
function pickAsset(assets) {
  const arch = process.arch === 'arm64' ? /arm64|aarch64/i : /x64|x86_64|amd64/i;
  const by = (re) => assets.find((a) => re.test(a.name) && (!/arm64|aarch64|x64|x86_64|amd64/i.test(a.name) || arch.test(a.name))) || assets.find((a) => re.test(a.name));
  if (process.platform === 'win32') return by(/Installer\.exe$|Setup.*\.exe$/i) || by(/\.exe$/i);
  if (process.platform === 'darwin') return by(/\.dmg$/i);
  if (process.env.APPIMAGE) return by(/\.AppImage$/i);
  const fs = require('fs');
  if (fs.existsSync('/etc/arch-release') && by(/\.pacman$/i)) return by(/\.pacman$/i);
  if (fs.existsSync('/etc/debian_version') && by(/\.deb$/i)) return by(/\.deb$/i);
  return by(/\.AppImage$/i);
}

async function checkManual() {
  if (!REPO) throw new Error('Brak repozytorium aktualizacji w package.json (justmusic.repo)');
  set({ state: 'checking', error: null });
  const res = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'JustMusic-Updater' } });
  if (res.status === 404) return set({ state: 'none' });
  if (!res.ok) throw new Error('GitHub: HTTP ' + res.status);
  const r = await res.json();
  const latest = String(r.tag_name || '').replace(/^v/, '');
  if (!latest || !newer(latest, app.getVersion())) return set({ state: 'none' });
  const asset = pickAsset(r.assets || []);
  set({ state: 'available', version: latest, notes: notesText(r.body), url: r.html_url, download: asset?.browser_download_url || r.html_url });
}

async function check() {
  try {
    if (state.auto && autoUpdater) await autoUpdater.checkForUpdates();
    else await checkManual();
  } catch (e) {
    set({ state: 'error', error: e?.message || String(e) });
  }
  return state;
}

async function download() {
  if (state.auto && autoUpdater) {
    set({ state: 'downloading', percent: 0 });
    autoUpdater.downloadUpdate().catch((e) => set({ state: 'error', error: e.message }));
    return state;
  }
  // tryb ręczny: pobranie przez przeglądarkę
  if (state.download || state.url) await shell.openExternal(state.download || state.url);
  return state;
}

function install() {
  if (autoUpdater && state.state === 'ready') {
    app.isQuitting = true;
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
  }
}

const getState = () => ({ ...state, current: app.getVersion(), repo: REPO, releases: releaseUrl() });

module.exports = { init, check, download, install, getState };
