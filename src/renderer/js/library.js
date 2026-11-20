// Biblioteka lokalna: foldery, skanowanie, dodawanie plików, przeciąganie z systemu.
import { S, setLocal, saveSettings } from './state.js';
import { toast } from './ui.js';

export async function loadCached() {
  try {
    setLocal(await window.jm.lib.get());
  } catch (e) {
    console.error(e);
  }
}

let scanning = false;
export async function rescan(verbose = false) {
  if (scanning) return;
  scanning = true;
  try {
    const before = S.local.length;
    const tracks = await window.jm.lib.scan(S.settings.library.folders);
    setLocal(tracks);
    if (verbose) {
      const diff = tracks.length - before;
      toast(diff > 0 ? `Znaleziono ${diff} nowych utworów` : `Biblioteka aktualna (${tracks.length})`);
    }
  } catch (e) {
    toast('Błąd skanowania: ' + e.message, { error: true });
  } finally {
    scanning = false;
  }
}

export async function addFolder() {
  const dir = await window.jm.dialog.folder('Wybierz folder z muzyką');
  if (!dir) return;
  const f = S.settings.library.folders;
  if (f.includes(dir)) return toast('Ten folder jest już w bibliotece');
  f.push(dir);
  saveSettings();
  toast('Skanowanie folderu…');
  await rescan(true);
}

export function removeFolder(dir) {
  S.settings.library.folders = S.settings.library.folders.filter((x) => x !== dir);
  saveSettings();
  rescan(false);
}

export async function addFiles(paths, silent = false) {
  if (!paths.length) return;
  const added = await window.jm.lib.addFiles(paths);
  if (!added.length) return toast('Brak obsługiwanych plików audio', { error: true });
  const map = new Map(S.local.map((t) => [t.id, t]));
  for (const t of added) map.set(t.id, t);
  setLocal([...map.values()]);
  if (!silent) toast(added.length === 1 ? `Dodano: ${added[0].title}` : `Dodano ${added.length} plików`);
  return added;
}

export async function addFilesDialog() {
  const paths = await window.jm.dialog.audioFiles();
  if (paths.length) addFiles(paths);
}

// Przeciąganie plików z eksploratora/Findera
export function setupFileDrop() {
  let depth = 0;
  const hasFiles = (e) => e.dataTransfer?.types?.includes('Files');
  window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; depth++; document.body.classList.add('dragging-files'); });
  window.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) document.body.classList.remove('dragging-files'); });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    document.body.classList.remove('dragging-files');
    const paths = [...e.dataTransfer.files].map((f) => window.jm.pathOf(f)).filter(Boolean);
    const added = await addFiles(paths, true);
    if (added?.length) {
      const { playTracks } = await import('./player.js');
      toast(added.length === 1 ? `Dodano: ${added[0].title}` : `Dodano ${added.length} plików do biblioteki`, { action: { label: 'Odtwórz', onClick: () => playTracks(added, 0) } });
    }
  });
}
