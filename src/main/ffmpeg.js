// Pobieranie gotowego ffmpeg (+ ffprobe) do folderu aplikacji – potrzebny do MP3/OPUS, okładek i tagów.
const { app, net } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const isWin = process.platform === 'win32';
const exe = (n) => (isWin ? n + '.exe' : n);
const binDir = () => path.join(app.getPath('userData'), 'bin');
const localFfmpeg = () => path.join(binDir(), exe('ffmpeg'));

// Statyczne kompilacje ffmpeg z zaufanych, popularnych źródeł
function sources() {
  const arm = process.arch === 'arm64';
  if (isWin) return [{ url: 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip', file: 'ffmpeg.zip' }];
  if (process.platform === 'darwin') {
    const a = arm ? 'arm64' : 'amd64';
    return [
      { url: `https://ffmpeg.martin-riedl.de/redirect/latest/macos/${a}/release/ffmpeg.zip`, file: 'ffmpeg.zip' },
      { url: `https://ffmpeg.martin-riedl.de/redirect/latest/macos/${a}/release/ffprobe.zip`, file: 'ffprobe.zip' },
    ];
  }
  return [{ url: `https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-${arm ? 'linuxarm64' : 'linux64'}-gpl.tar.xz`, file: 'ffmpeg.tar.xz' }];
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true, stdio: 'ignore' });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} zakończył się kodem ${code}`))));
  });
}

async function download(url, dest, onProgress, part, parts) {
  const res = await net.fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Pobieranie ffmpeg: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const fh = await fs.promises.open(dest, 'w');
  let got = 0;
  let last = 0;
  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await fh.write(value);
      got += value.length;
      const now = Date.now();
      if (total && now - last > 200) {
        last = now;
        onProgress({ phase: 'download', percent: Math.round(((part + got / total) / parts) * 100), mb: Math.round(got / 1048576), totalMb: Math.round(total / 1048576) });
      }
    }
  } finally {
    await fh.close();
  }
}

function findFile(dir, name) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const r = findFile(p, name);
      if (r) return r;
    } else if (e.name === name) return p;
  }
  return null;
}

let installing = null;
async function install(onProgress = () => {}) {
  if (installing) return installing;
  installing = (async () => {
    const tmp = path.join(app.getPath('temp'), `justmusic-ffmpeg-${Date.now()}`);
    await fs.promises.mkdir(tmp, { recursive: true });
    await fs.promises.mkdir(binDir(), { recursive: true });
    try {
      const list = sources();
      for (const [i, s] of list.entries()) {
        const archive = path.join(tmp, s.file);
        await download(s.url, archive, onProgress, i, list.length);
        onProgress({ phase: 'extract', percent: 100 });
        const out = path.join(tmp, `x${i}`);
        await fs.promises.mkdir(out, { recursive: true });
        // tar rozpakowuje .tar.xz (Linux) oraz .zip (Windows 10+ i macOS mają bsdtar)
        await run('tar', [s.file.endsWith('.tar.xz') ? '-xJf' : '-xf', archive, '-C', out]);
        await fs.promises.rm(archive, { force: true });
      }
      for (const name of ['ffmpeg', 'ffprobe']) {
        const found = findFile(tmp, exe(name));
        if (!found) {
          if (name === 'ffmpeg') throw new Error('Nie znaleziono ffmpeg w pobranym archiwum');
          continue;
        }
        const target = path.join(binDir(), exe(name));
        await fs.promises.rm(target, { force: true });
        await fs.promises.copyFile(found, target);
        if (!isWin) await fs.promises.chmod(target, 0o755);
      }
      return localFfmpeg();
    } finally {
      fs.promises.rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
  })();
  try {
    return await installing;
  } finally {
    installing = null;
  }
}

async function remove() {
  for (const n of ['ffmpeg', 'ffprobe']) await fs.promises.rm(path.join(binDir(), exe(n)), { force: true });
}

module.exports = { install, remove, localFfmpeg, isInstalling: () => !!installing };
