// Menedżer pobierania (kolejka, równoległość, postęp).
import { S, emit, saveData, remember, uid } from './state.js';
import { toast } from './ui.js';

export const D = {
  jobs: new Map(), // jobId -> { id, track, status, percent, speed, eta, file, error, at }
};

let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  window.jm.dl.onProgress((p) => {
    const job = D.jobs.get(p.id);
    if (!job) return;
    if (job.status === 'canceled' && p.status !== 'canceled') {
      if (p.status === 'downloading') window.jm.dl.cancel(p.id);
      return;
    }
    Object.assign(job, p);
    if (p.status === 'done') {
      S.data.downloads[job.track.id] = p.file;
      saveData();
      emit('downloaded', job.track.id);
    }
    if (p.status === 'error') toast(`Błąd pobierania: ${job.track.title}`, { error: true });
    if (['done', 'error', 'canceled'].includes(p.status)) {
      active--;
      pump();
      if (active === 0 && !queued().length) {
        const ok = [...D.jobs.values()].filter((j) => j.status === 'done' && !j.notified);
        ok.forEach((j) => (j.notified = true));
        if (ok.length) toast(ok.length === 1 ? `Pobrano: ${ok[0].track.title}` : `Pobrano ${ok.length} utworów`);
      }
    }
    emit('downloads');
  });
}

let active = 0;
const queued = () => [...D.jobs.values()].filter((j) => j.status === 'queued');

export function activeCount() {
  return [...D.jobs.values()].filter((j) => ['queued', 'downloading', 'processing', 'resolving'].includes(j.status)).length;
}

export function downloadTracks(tracks) {
  wire();
  let n = 0;
  for (const t of tracks) {
    if (t.source === 'local' || S.data.downloads[t.id]) continue;
    if ([...D.jobs.values()].some((j) => j.track.id === t.id && !['error', 'canceled', 'done'].includes(j.status))) continue;
    remember(t);
    const id = 'dl_' + uid();
    D.jobs.set(id, { id, track: t, status: 'queued', percent: 0, at: Date.now() });
    n++;
  }
  if (!n) {
    toast(tracks.length === 1 ? 'Ten utwór jest już pobrany' : 'Wszystkie utwory są już pobrane');
    return;
  }
  toast(n === 1 ? 'Dodano do pobierania' : `Dodano ${n} utworów do pobierania`);
  emit('downloads');
  pump();
}

async function start(job) {
  active++;
  const t = job.track;
  try {
    let ytId = t.ytId;
    if (!ytId && t.source === 'spotify') {
      job.status = 'resolving';
      emit('downloads');
      ytId = S.data.spMap[t.spotifyId] || (await window.jm.yt.resolve({ title: t.title, artist: t.artist, duration: t.duration }));
      S.data.spMap[t.spotifyId] = ytId;
    }
    if (job.status === 'canceled') { active--; return pump(); }
    const cfg = S.settings.downloads;
    await window.jm.dl.start({
      id: job.id, ytId, title: t.title, artist: t.artist, album: t.album || '',
      dir: cfg.dir, format: cfg.format, tag: cfg.tag,
    });
  } catch (e) {
    job.status = 'error';
    job.error = e.message;
    active--;
    emit('downloads');
    toast(`Błąd pobierania: ${e.message}`, { error: true });
    pump();
  }
}

function pump() {
  const max = Math.max(1, S.settings.downloads.concurrent || 2);
  for (const job of queued()) {
    if (active >= max) break;
    job.status = 'starting';
    start(job);
  }
}

export function cancelJob(id) {
  const job = D.jobs.get(id);
  if (!job) return;
  if (job.status === 'queued') {
    job.status = 'canceled';
    emit('downloads');
  } else if (job.status === 'resolving' || job.status === 'starting') {
    job.status = 'canceled'; // proces jeszcze nie ruszył – zostanie przerwany przy pierwszym postępie
    emit('downloads');
  } else window.jm.dl.cancel(id);
}

export function retryJob(id) {
  const job = D.jobs.get(id);
  if (!job) return;
  job.status = 'queued';
  job.error = null;
  job.percent = 0;
  emit('downloads');
  pump();
}

export function clearFinished() {
  for (const [id, j] of D.jobs) if (['done', 'error', 'canceled'].includes(j.status)) D.jobs.delete(id);
  emit('downloads');
}

export async function deleteDownload(track) {
  const p = S.data.downloads[track.id];
  if (!p) return;
  try { await window.jm.dl.remove(p); } catch {}
  delete S.data.downloads[track.id];
  saveData();
  emit('downloaded', track.id);
  toast('Usunięto plik (do kosza)');
}

// Usuń wpisy o pobranych plikach, które zniknęły z dysku
export async function verifyDownloads() {
  const entries = Object.entries(S.data.downloads);
  if (!entries.length) return;
  try {
    const exists = await window.jm.dl.exists(entries.map((e) => e[1]));
    let changed = false;
    entries.forEach(([id], i) => { if (!exists[i]) { delete S.data.downloads[id]; changed = true; } });
    if (changed) { saveData(); emit('downloaded'); }
  } catch {}
}
