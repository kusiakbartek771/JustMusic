// Wspólne akcje: playlisty, zakładki, menu utworu.
import { S, emit, saveData, remember, uid, toggleLike, isLiked, getTrack, tracksOf } from './state.js';
import { toast, promptDialog, confirmDialog, fmtTime } from './ui.js';
import * as player from './player.js';
import { navigate } from './router.js';
import { downloadTracks } from './downloads.js';

// ---------------- playlisty ----------------
const PL_COLORS = ['#7c5cff', '#ff4fd8', '#38bdf8', '#4ade80', '#ff7a45', '#facc15', '#ff3d5e', '#14b8a6'];

export function getPlaylist(id) {
  return S.data.playlists.find((p) => p.id === id) || null;
}

export async function createPlaylist({ name, tracks = [], open = false, silent = false } = {}) {
  if (!name) {
    name = await promptDialog({ title: 'Nowa playlista', value: `Moja playlista #${S.data.playlists.length + 1}`, ok: 'Utwórz' });
    if (!name) return null;
  }
  tracks.forEach(remember);
  const pl = {
    id: 'pl_' + uid(),
    name,
    desc: '',
    color: PL_COLORS[S.data.playlists.length % PL_COLORS.length],
    trackIds: [...new Set(tracks.map((t) => t.id))],
    created: Date.now(),
    updated: Date.now(),
  };
  S.data.playlists.unshift(pl);
  saveData();
  emit('playlists');
  if (!silent) toast(`Utworzono „${name}”`);
  if (open) navigate('playlist', pl.id);
  return pl;
}

export function addToPlaylist(plId, tracks) {
  const pl = getPlaylist(plId);
  if (!pl) return;
  let added = 0;
  for (const t of tracks) {
    remember(t);
    if (!pl.trackIds.includes(t.id)) {
      pl.trackIds.push(t.id);
      added++;
    }
  }
  pl.updated = Date.now();
  saveData();
  emit('playlists');
  emit('playlist:' + pl.id);
  if (added) toast(added === 1 ? `Dodano do „${pl.name}”` : `Dodano ${added} utworów do „${pl.name}”`);
  else toast('Utwory są już na tej playliście');
}

export function removeFromPlaylist(plId, ids) {
  const pl = getPlaylist(plId);
  if (!pl) return;
  const set = new Set(ids);
  const before = pl.trackIds.slice();
  pl.trackIds = pl.trackIds.filter((id) => !set.has(id));
  pl.updated = Date.now();
  saveData();
  emit('playlists');
  emit('playlist:' + pl.id);
  toast(`Usunięto ${ids.length > 1 ? ids.length + ' utworów' : 'utwór'}`, {
    action: { label: 'Cofnij', onClick: () => { pl.trackIds = before; saveData(); emit('playlists'); emit('playlist:' + pl.id); } },
  });
}

export function reorderPlaylist(plId, fromIdx, toIdx) {
  const pl = getPlaylist(plId);
  if (!pl) return;
  const sorted = [...fromIdx].sort((a, b) => a - b);
  const moving = sorted.map((i) => pl.trackIds[i]);
  let target = toIdx - sorted.filter((i) => i < toIdx).length;
  const rest = pl.trackIds.filter((_, i) => !sorted.includes(i));
  rest.splice(target, 0, ...moving);
  pl.trackIds = rest;
  pl.updated = Date.now();
  saveData();
  emit('playlists');
  emit('playlist:' + pl.id);
}

export async function renamePlaylist(plId) {
  const pl = getPlaylist(plId);
  if (!pl) return;
  const name = await promptDialog({ title: 'Zmień nazwę playlisty', value: pl.name });
  if (!name) return;
  pl.name = name;
  pl.updated = Date.now();
  saveData();
  emit('playlists');
  emit('playlist:' + pl.id);
}

export async function editDescription(plId) {
  const pl = getPlaylist(plId);
  if (!pl) return;
  const desc = await promptDialog({ title: 'Opis playlisty', value: pl.desc || '', multiline: true });
  if (desc === null) return;
  pl.desc = desc;
  saveData();
  emit('playlist:' + pl.id);
}

export async function deletePlaylist(plId) {
  const pl = getPlaylist(plId);
  if (!pl) return;
  if (!(await confirmDialog({ title: `Usunąć „${pl.name}”?`, text: 'Pliki pobrane na dysk pozostaną nietknięte.', ok: 'Usuń', danger: true }))) return;
  S.data.playlists = S.data.playlists.filter((p) => p.id !== plId);
  S.data.bookmarks = S.data.bookmarks.filter((b) => !(b.type === 'playlist' && b.ref === plId));
  saveData();
  emit('playlists');
  emit('bookmarks');
  navigate('home', null, { replace: true });
}

export function duplicatePlaylist(plId) {
  const pl = getPlaylist(plId);
  if (!pl) return;
  createPlaylist({ name: pl.name + ' (kopia)', tracks: tracksOf(pl.trackIds), open: true });
}

export async function exportPlaylist(name, tracks) {
  const list = tracks.map((t) => ({
    title: t.title, artist: t.artist, duration: t.duration,
    path: t.path || S.data.downloads[t.id] || null,
    url: t.ytId ? `https://www.youtube.com/watch?v=${t.ytId}` : t.spotifyId ? `https://open.spotify.com/track/${t.spotifyId}` : '',
  }));
  const file = await window.jm.m3u.export(name, list);
  if (file) toast('Wyeksportowano playlistę');
}

export async function importM3U() {
  try {
    const r = await window.jm.m3u.import();
    if (!r) return;
    const tracks = [...r.local];
    for (const u of r.urls) {
      const yt = u.ref.match(/(?:v=|youtu\.be\/)([\w-]{11})/);
      if (yt) {
        const [artist, title] = (u.info || '').includes(' - ') ? u.info.split(' - ', 2) : ['', u.info || yt[1]];
        tracks.push({ id: 'yt:' + yt[1], source: 'youtube', ytId: yt[1], title, artist, duration: 0, thumb: `https://i.ytimg.com/vi/${yt[1]}/mqdefault.jpg` });
      }
    }
    if (!tracks.length) return toast('Nie znaleziono utworów w pliku', { error: true });
    if (r.local.length) await (await import('./library.js')).loadCached();
    await createPlaylist({ name: r.name, tracks, open: true });
  } catch (e) {
    toast(e.message, { error: true });
  }
}

// ---------------- zakładki ----------------
export function addBookmark(b) {
  S.data.bookmarks.unshift({ id: 'bm_' + uid(), at: Date.now(), ...b });
  saveData();
  emit('bookmarks');
}

export function removeBookmark(id) {
  S.data.bookmarks = S.data.bookmarks.filter((b) => b.id !== id);
  saveData();
  emit('bookmarks');
}

export function findBookmark(type, ref) {
  return S.data.bookmarks.find((b) => b.type === type && b.ref === ref);
}

export function toggleBookmark(type, ref, extra = {}) {
  const b = findBookmark(type, ref);
  if (b) {
    removeBookmark(b.id);
    toast('Usunięto z zakładek');
    return false;
  }
  addBookmark({ type, ref, ...extra });
  toast('Dodano do zakładek');
  return true;
}

export async function bookmarkMoment(withNote = false) {
  const t = player.P.current;
  if (!t) return toast('Nic teraz nie gra');
  const time = Math.floor(player.P.audio.currentTime || 0);
  remember(t);
  let note = '';
  if (withNote) {
    note = await promptDialog({ title: `Zakładka w ${fmtTime(time)}`, text: `${t.title} — ${t.artist}`, placeholder: 'Notatka (opcjonalnie)…', ok: 'Dodaj' });
    if (note === null) return;
  }
  addBookmark({ type: 'moment', ref: t.id, time, note });
  toast(`Zapisano moment ${fmtTime(time)}`, { action: { label: 'Zakładki', onClick: () => navigate('bookmarks') } });
}

export function playMoment(b) {
  const t = getTrack(b.ref);
  if (!t) return toast('Utwór niedostępny', { error: true });
  if (player.P.current?.id === t.id) {
    player.seek(b.time);
    player.play();
  } else {
    player.playTracks([t], 0);
    const a = player.P.audio;
    const once = () => { a.currentTime = b.time; a.removeEventListener('loadedmetadata', once); };
    a.addEventListener('loadedmetadata', once);
  }
}

// ---------------- menu utworu ----------------
const extraItems = new Set(); // rozszerzenia z pluginów
export function registerTrackMenuItem(item) {
  extraItems.add(item);
  return () => extraItems.delete(item);
}

export function playlistSubmenu(tracks) {
  return () => [
    { label: 'Nowa playlista…', icon: 'plus', onClick: () => createPlaylist({ tracks }) },
    S.data.playlists.length ? { sep: true } : null,
    ...S.data.playlists.slice(0, 40).map((p) => ({ label: p.name, icon: 'listMusic', onClick: () => addToPlaylist(p.id, tracks) })),
  ];
}

export function trackMenu(tracks, { playlistId = null, onRemove = null } = {}) {
  const t = tracks[0];
  const single = tracks.length === 1;
  const liked = single && isLiked(t.id);
  const downloaded = single && (t.source === 'local' || S.data.downloads[t.id]);
  const filePath = single ? t.path || S.data.downloads[t.id] : null;
  const items = [
    tracks.length > 1 ? { title: `${tracks.length} zaznaczonych` } : null,
    { label: 'Odtwórz', icon: 'play', onClick: () => player.playTracks(tracks, 0) },
    { label: 'Odtwórz następnie', icon: 'playNext', onClick: () => { player.enqueue(tracks, true); toast('Zagra jako następne'); } },
    { label: 'Dodaj do kolejki', icon: 'queue', onClick: () => { player.enqueue(tracks); toast('Dodano do kolejki'); } },
    { sep: true },
    { label: 'Dodaj do playlisty', icon: 'listPlus', submenu: playlistSubmenu(tracks) },
    single
      ? { label: liked ? 'Usuń z polubionych' : 'Polub', icon: liked ? 'heartFill' : 'heart', onClick: () => toggleLike(t) }
      : { label: 'Polub wszystkie', icon: 'heart', onClick: () => { tracks.forEach((x) => !isLiked(x.id) && toggleLike(x)); toast('Polubiono'); } },
    single ? { label: findBookmark('track', t.id) ? 'Usuń z zakładek' : 'Dodaj do zakładek', icon: 'bookmark', onClick: () => { remember(t); toggleBookmark('track', t.id); } } : null,
    { sep: true },
    !downloaded || !single
      ? { label: single ? 'Pobierz' : 'Pobierz zaznaczone', icon: 'download', onClick: () => downloadTracks(tracks) }
      : null,
    filePath ? { label: 'Pokaż w folderze', icon: 'folder', onClick: () => window.jm.shell.show(filePath) } : null,
    single && t.artist ? { label: `Szukaj: ${t.artist.split(',')[0]}`, icon: 'user', onClick: () => navigate('search', { q: t.artist.split(',')[0].trim() }) } : null,
    single && t.album && t.source === 'local' ? { label: 'Przejdź do albumu', icon: 'disc', onClick: () => navigate('collection', { type: 'album', key: t.album }) } : null,
    single && t.ytId ? { label: 'Otwórz w YouTube', icon: 'external', onClick: () => window.jm.shell.external(`https://www.youtube.com/watch?v=${t.ytId}`) } : null,
    single && (t.ytId || t.spotifyId) ? { label: 'Kopiuj link', icon: 'copy', onClick: () => { navigator.clipboard.writeText(t.ytId ? `https://youtu.be/${t.ytId}` : `https://open.spotify.com/track/${t.spotifyId}`); toast('Skopiowano link'); } } : null,
  ];
  if (extraItems.size) {
    items.push({ sep: true });
    for (const it of extraItems) items.push({ label: it.label, icon: it.icon || 'puzzle', onClick: () => it.onClick(tracks) });
  }
  if (playlistId) {
    items.push({ sep: true }, { label: 'Usuń z tej playlisty', icon: 'trash', danger: true, onClick: () => removeFromPlaylist(playlistId, tracks.map((x) => x.id)) });
  } else if (onRemove) {
    items.push({ sep: true }, { label: onRemove.label, icon: 'trash', danger: true, onClick: () => onRemove.fn(tracks) });
  }
  return items;
}
