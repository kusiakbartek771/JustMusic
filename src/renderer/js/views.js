// Widoki: Start, Szukaj, Biblioteka, Kolekcja, Polubione, Playlista, Zakładki, Pobrane, Import.
import { S, on, emit, getTrack, tracksOf, remember, saveData, saveSettings, setLocal } from './state.js';
import { h, esc, btn, iconBtn, cover, mosaic, fmtTime, fmtTotal, songs, toast, contextMenu, menuAt, timeAgo, select, debounce, spinner } from './ui.js';
import { icon } from './icons.js';
import { registerView, navigate, refresh } from './router.js';
import { TrackList } from './tracklist.js';
import * as player from './player.js';
import {
  createPlaylist, getPlaylist, renamePlaylist, editDescription, deletePlaylist, duplicatePlaylist, exportPlaylist,
  toggleBookmark, findBookmark, removeBookmark, playMoment, playlistSubmenu, importM3U,
} from './actions.js';
import { D, downloadTracks, cancelJob, retryJob, clearFinished, deleteDownload } from './downloads.js';
import { addFolder, rescan, addFilesDialog } from './library.js';

const totalDur = (tracks) => tracks.reduce((a, t) => a + (t.duration || 0), 0);
const playAll = (tracks, ctx, shuffle = false) => {
  if (!tracks.length) return toast('Brak utworów do odtworzenia');
  if (shuffle !== S.settings.playback.shuffle && shuffle) player.toggleShuffle();
  const start = shuffle ? Math.floor(Math.random() * tracks.length) : 0;
  player.playTracks(tracks, start, ctx);
};

function headBlock({ eyebrow, title, meta, coverEl, color, editable, onTitle }) {
  const head = h('div.view-head');
  head.append(h('div.head-bg', { style: color ? { '--head-color': `color-mix(in srgb, ${color} 45%, transparent)` } : {} }));
  coverEl.classList.add('big-cover');
  const t = h('h1' + (editable ? '.editable' : ''), { text: title, title: editable ? 'Kliknij, aby zmienić nazwę' : '' });
  if (editable) t.addEventListener('click', onTitle);
  head.append(coverEl, h('div', { style: { minWidth: '0' } }, h('div.eyebrow', { text: eyebrow }), t, h('div.meta', { html: meta })));
  return head;
}

function fab(onClick, title = 'Odtwórz') {
  return h('button.play-fab', { title, html: icon('play'), on: { click: onClick } });
}

function greeting() {
  const hr = new Date().getHours();
  if (hr < 5) return 'Dobranoc';
  if (hr < 12) return 'Dzień dobry';
  if (hr < 18) return 'Miłego popołudnia';
  return 'Dobry wieczór';
}

// ======================= START =======================
registerView('home', (root) => {
  const wrap = h('div.view-pad');
  const H = S.settings.layout.homeSections;
  wrap.append(h('h1.page-title', { text: greeting() }));
  const stats = [
    S.local.length ? songs(S.local.length) + ' lokalnie' : null,
    Object.keys(S.data.downloads).length ? `${Object.keys(S.data.downloads).length} pobranych` : null,
    S.data.playlists.length ? `${S.data.playlists.length} playlist` : null,
  ].filter(Boolean);
  wrap.append(h('p.page-sub', { text: stats.length ? stats.join(' · ') : 'Co dziś gramy?' }));

  if (S.ytStatus && !S.ytStatus.ready) {
    const b = h('div.banner.warn', { html: `${icon('alert')}<div class="grow"><b>Silnik YouTube (yt-dlp) nie jest zainstalowany.</b><br><span class="muted">Potrzebny do wyszukiwania, odtwarzania i pobierania z YouTube/Spotify. Instalacja zajmuje kilka sekund.</span></div>` });
    b.append(btn('Zainstaluj teraz', { primary: true, icon: 'download', onClick: () => navigate('settings', 'downloads') }));
    wrap.append(b);
  }

  // szybki dostęp
  if (H.quick) {
    const quick = h('div.quick-grid');
    const qi = (label, ic, onClick, onPlay, thumbEl) => {
      const el = h('div.quick', { on: { click: onClick } });
      el.append(thumbEl || h('div.q-ic', { html: icon(ic) }), h('b', { text: label }));
      if (onPlay) el.append(h('button.play-fab', { html: icon('play'), title: 'Odtwórz', on: { click: (e) => { e.stopPropagation(); onPlay(); } } }));
      return el;
    };
    quick.append(qi('Polubione utwory', 'heartFill', () => navigate('liked'), S.data.liked.length ? () => playAll(tracksOf(S.data.liked), { type: 'liked' }) : null));
    if (S.local.length) quick.append(qi('Biblioteka lokalna', 'library', () => navigate('library'), () => playAll(S.local, { type: 'library' }, true)));
    for (const p of S.data.playlists.slice(0, 4)) {
      const thumbs = p.trackIds.slice(0, 8).map((id) => getTrack(id)?.thumb);
      quick.append(qi(p.name, 'listMusic', () => navigate('playlist', p.id), p.trackIds.length ? () => playAll(tracksOf(p.trackIds), { type: 'playlist', id: p.id }) : null, mosaic(thumbs)));
    }
    if (quick.children.length) wrap.append(quick);
  }

  const empty = !S.data.history.length && !S.data.playlists.length && !S.local.length;
  if (empty) {
    const ob = h('div.onboard');
    const card = (ic, title, text, onClick) => h('div.card', { on: { click: onClick }, html: `${icon(ic)}<h3>${esc(title)}</h3><p>${esc(text)}</p>` });
    ob.append(
      card('search', 'Wyszukaj muzykę', 'Wpisz tytuł lub wykonawcę w polu wyszukiwania u góry (Ctrl+K).', () => document.getElementById('search-input').focus()),
      card('link', 'Importuj ze Spotify', 'Wklej link do playlisty, albumu lub utworu ze Spotify albo YouTube.', () => navigate('import')),
      card('folderPlus', 'Dodaj folder z muzyką', 'Odtwarzaj swoje pliki MP3, FLAC, M4A, OGG i inne.', () => addFolder()),
      card('palette', 'Dostosuj wygląd', 'Motywy, kolory, układ paneli, czcionki i pluginy.', () => navigate('settings', 'appearance')),
    );
    wrap.append(h('div.section', null, h('div.section-head', { html: '<h2>Zacznij tutaj</h2>' }), ob));
  }

  // ostatnio odtwarzane
  if (H.recent && S.data.history.length) {
    const seen = new Set();
    const recent = [];
    for (const x of S.data.history) {
      if (seen.has(x.id)) continue;
      seen.add(x.id);
      const t = getTrack(x.id);
      if (t) recent.push(t);
      if (recent.length >= 16) break;
    }
    const row = h('div.hrow');
    recent.forEach((t, i) => {
      const c = h('div.card', { on: { dblclick: () => player.playTracks(recent, i), contextmenu: (e) => import('./actions.js').then((a) => contextMenu(e, a.trackMenu([t]))) } });
      c.append(cover(t.thumb, 'track-cover'), h('div.title', { text: t.title }), h('div.sub', { text: t.artist || '' }), fab(() => player.playTracks(recent, i)));
      row.append(c);
    });
    if (recent.length) wrap.append(h('div.section', null, h('div.section-head', null, h('h2', { text: 'Ostatnio odtwarzane' })), row));
  }

  // playlisty
  if (H.playlists && S.data.playlists.length) {
    const grid = h('div.grid');
    for (const p of S.data.playlists.slice(0, 12)) grid.append(playlistCard(p));
    wrap.append(h('div.section', null, h('div.section-head', null, h('h2', { text: 'Twoje playlisty' }), h('button.link', { text: '+ Nowa', on: { click: () => createPlaylist({ open: true }) } })), grid));
  }

  // zakładki
  if (H.bookmarks && S.data.bookmarks.length) {
    const list = h('div.bm-list');
    for (const b of S.data.bookmarks.slice(0, 5)) list.append(bookmarkRow(b));
    wrap.append(h('div.section', null, h('div.section-head', null, h('h2', { text: 'Zakładki' }), h('button.link', { text: 'Pokaż wszystkie', on: { click: () => navigate('bookmarks') } })), list));
  }

  root.append(wrap);
  const offs = [on('playlists', refresh), on('library', refresh)];
  return () => offs.forEach((f) => f());
});

function playlistCard(p) {
  const tracks = () => tracksOf(p.trackIds);
  const thumbs = p.trackIds.slice(0, 12).map((id) => getTrack(id)?.thumb);
  const c = mosaic(thumbs);
  if (!thumbs.some(Boolean)) c.style.background = `linear-gradient(135deg, ${p.color}, color-mix(in srgb, ${p.color} 35%, #000))`;
  const card = h('div.card', { on: { click: () => navigate('playlist', p.id) } });
  card.append(c, h('div.title', { text: p.name }), h('div.sub', { text: `${songs(p.trackIds.length)}` }));
  if (p.trackIds.length) card.append(fab((e) => { e.stopPropagation(); playAll(tracks(), { type: 'playlist', id: p.id }); }));
  return card;
}

// ======================= SZUKAJ =======================
const isUrl = (q) => /^https?:\/\/|^spotify:/.test(q.trim());

registerView('search', (root, param) => {
  const q = (param?.q || '').trim();
  const wrap = h('div');
  root.append(wrap);
  let tl = null;
  let alive = true;
  const cleanups = [];

  if (!q) {
    const pad = h('div.view-pad');
    pad.append(h('h1.page-title', { text: 'Szukaj' }), h('p.page-sub', { text: 'YouTube, Twoja biblioteka i playlisty – w jednym miejscu. Możesz też wkleić link.' }));
    if (S.data.searches.length) {
      const chips = h('div.chips');
      for (const s of S.data.searches.slice(0, 20)) {
        chips.append(h('button.chip', { html: `${icon('history')}${esc(s)}<span class="x" data-x="1">✕</span>`, on: {
          click: (e) => {
            if (e.target.dataset.x) { S.data.searches = S.data.searches.filter((x) => x !== s); saveData(); refresh(); return; }
            navigate('search', { q: s });
          },
        } }));
      }
      pad.append(h('div.section', null, h('div.section-head', null, h('h2', { text: 'Ostatnie wyszukiwania' }), h('button.link', { text: 'Wyczyść', on: { click: () => { S.data.searches = []; saveData(); refresh(); } } })), chips));
    }
    const genres = ['Lo-fi hip hop', 'Synthwave', 'Polski rap', 'Jazz klasyka', 'Muzyka do nauki', 'Rock lat 80', 'Disco polo', 'Muzyka klasyczna', 'Deep house', 'Indie'];
    const g = h('div.chips');
    genres.forEach((x) => g.append(h('button.chip', { text: x, on: { click: () => navigate('search', { q: x }) } })));
    pad.append(h('div.section', null, h('div.section-head', { html: '<h2>Inspiracje</h2>' }), g));
    wrap.append(pad);
    setTimeout(() => document.getElementById('search-input')?.focus(), 30);
    return;
  }

  if (isUrl(q)) {
    navigate('import', { url: q }, { replace: true });
    return;
  }

  // zapamiętaj zapytanie
  S.data.searches = [q, ...S.data.searches.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 30);
  saveData();

  const header = h('div.view-pad', { style: { paddingBottom: '8px' } });
  const bmBtn = iconBtn(findBookmark('search', q) ? 'bookmarkFill' : 'bookmark', 'Zapisz wyszukiwanie w zakładkach', () => {
    const on_ = toggleBookmark('search', q);
    bmBtn.innerHTML = icon(on_ ? 'bookmarkFill' : 'bookmark');
  });
  header.append(h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, h('h1.page-title', { text: `„${q}”`, style: { flex: '1', margin: '0' } }), bmBtn));
  wrap.append(header);

  // lokalne wyniki natychmiast
  const ql = q.toLowerCase();
  const terms = ql.split(/\s+/).filter(Boolean);
  const match = (t) => {
    const s = `${t.title} ${t.artist} ${t.album || ''}`.toLowerCase();
    return terms.every((w) => s.includes(w));
  };
  const known = [...S.local, ...Object.values(S.data.tracks)];
  const localHits = known.filter(match).slice(0, 50);
  const plHits = S.data.playlists.filter((p) => p.name.toLowerCase().includes(ql));

  if (plHits.length) {
    const grid = h('div.grid');
    plHits.slice(0, 6).forEach((p) => grid.append(playlistCard(p)));
    wrap.append(h('div.view-pad', { style: { paddingTop: '0', paddingBottom: '0' } }, h('div.section-head', { html: '<h2>Playlisty</h2>' }), grid));
  }
  if (localHits.length) {
    wrap.append(h('div.view-pad', { style: { paddingTop: '16px', paddingBottom: '0' } }, h('div.section-head', { html: `<h2>W Twojej bibliotece</h2><span class="muted">${localHits.length}</span>` })));
    const lt = TrackList({ tracks: localHits.slice(0, 8), showAlbum: false });
    wrap.append(lt.el);
    cleanups.push(() => lt.destroy());
  }

  const ytHead = h('div.view-pad', { style: { paddingTop: '16px', paddingBottom: '8px' } });
  const actions = h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } });
  ytHead.append(h('div.section-head', null, h('h2', { html: `${icon('video')} YouTube`, style: { display: 'flex', alignItems: 'center', gap: '8px' } }), actions));
  wrap.append(ytHead);
  const results = h('div');
  wrap.append(results);
  const sk = h('div');
  for (let i = 0; i < 8; i++) sk.append(h('div.skeleton.sk-row'));
  results.append(sk);

  window.jm.yt.search(q, S.settings.youtube.results).then((list) => {
    if (!alive) return;
    results.replaceChildren();
    if (!list.length) {
      results.append(h('div.empty', { html: `${icon('search')}<h3>Brak wyników</h3><p>Spróbuj innego zapytania.</p>` }));
      return;
    }
    actions.append(
      btn('Odtwórz wszystko', { icon: 'play', cls: 'sm', onClick: () => playAll(list, { type: 'search', q }) }),
      btn('Zapisz jako playlistę', { icon: 'listPlus', cls: 'sm', onClick: () => createPlaylist({ name: q, tracks: list, open: true }) }),
      btn('Pobierz wszystko', { icon: 'download', cls: 'sm ghost', onClick: () => downloadTracks(list) }),
    );
    tl = TrackList({ tracks: list, showAlbum: false, context: { type: 'search', q } });
    results.append(tl.el);
  }).catch((e) => {
    if (!alive) return;
    results.replaceChildren(errorBox(e));
  });

  return () => { alive = false; tl?.destroy(); cleanups.forEach((f) => f()); };
});

function errorBox(e) {
  const missing = /YTDLP_MISSING/.test(e.message);
  const box = h('div.view-pad');
  const b = h('div.banner.warn', { html: `${icon('alert')}<div class="grow"><b>${missing ? 'Brak silnika YouTube (yt-dlp)' : 'Nie udało się pobrać wyników'}</b><br><span class="muted">${esc(missing ? 'Zainstaluj go jednym kliknięciem w ustawieniach.' : e.message)}</span></div>` });
  b.append(btn(missing ? 'Zainstaluj' : 'Ustawienia', { primary: true, onClick: () => navigate('settings', 'downloads') }));
  box.append(b);
  return box;
}

// ======================= BIBLIOTEKA =======================
const SORTS = [
  ['added', 'Ostatnio dodane'], ['title', 'Tytuł'], ['artist', 'Wykonawca'], ['album', 'Album'], ['duration', 'Długość'],
];
function sortTracks(list, by) {
  const a = list.slice();
  const cmp = (x, y) => (x || '').localeCompare(y || '', 'pl', { sensitivity: 'base' });
  if (by === 'title') a.sort((x, y) => cmp(x.title, y.title));
  else if (by === 'artist') a.sort((x, y) => cmp(x.artist, y.artist) || cmp(x.album, y.album) || (x.trackNo || 0) - (y.trackNo || 0));
  else if (by === 'album') a.sort((x, y) => cmp(x.album, y.album) || (x.trackNo || 0) - (y.trackNo || 0));
  else if (by === 'duration') a.sort((x, y) => (x.duration || 0) - (y.duration || 0));
  else a.sort((x, y) => (y.added || 0) - (x.added || 0));
  return a;
}

export function libraryTracks(filter = 'all') {
  const dlPaths = new Set(Object.values(S.data.downloads));
  const local = S.local.filter((t) => !dlPaths.has(t.path));
  const downloaded = Object.keys(S.data.downloads).map((id) => getTrack(id)).filter(Boolean);
  if (filter === 'local') return local;
  if (filter === 'downloaded') return downloaded;
  return [...downloaded, ...local];
}

const libState = { tab: 'tracks', filter: 'all', sort: 'added', q: '' };

registerView('library', (root) => {
  let tl = null;
  const pad = h('div.view-pad', { style: { paddingBottom: '8px' } });
  const status = h('span.muted');
  pad.append(
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' } },
      h('h1.page-title', { text: 'Biblioteka', style: { flex: '1', margin: '0' } }),
      status,
      btn('Dodaj pliki', { icon: 'file', cls: 'sm', onClick: addFilesDialog }),
      btn('Dodaj folder', { icon: 'folderPlus', cls: 'sm', onClick: addFolder }),
      iconBtn('refresh', 'Skanuj ponownie', () => rescan(true), 'sm')),
  );
  if (S.settings.library.folders.length) {
    pad.append(h('p.page-sub', { style: { margin: '6px 0 0', fontSize: '12px' }, text: 'Foldery: ' + S.settings.library.folders.join(' · ') }));
  }
  const tabs = h('div.tabs');
  const tabDefs = [['tracks', 'Utwory'], ['albums', 'Albumy'], ['artists', 'Wykonawcy']];
  for (const [k, l] of tabDefs) tabs.append(h('button.tab' + (libState.tab === k ? '.on' : ''), { text: l, on: { click: () => { libState.tab = k; refresh(); } } }));
  const body = h('div');
  root.append(pad, tabs, body);

  const drawTracks = () => {
    const bar = h('div.actions');
    const chips = h('div.chips');
    for (const [k, l] of [['all', 'Wszystkie'], ['local', 'Lokalne'], ['downloaded', 'Pobrane']]) {
      chips.append(h('button.chip' + (libState.filter === k ? '.on' : ''), { text: l, on: { click: () => { libState.filter = k; refresh(); } } }));
    }
    const filterInput = h('input.input.filter-input', { placeholder: 'Filtruj…', value: libState.q });
    const sortSel = select(SORTS, libState.sort, (v) => { libState.sort = v; update(); });
    bar.append(fabSmall(), chips, h('div.grow'), filterInput, sortSel);
    body.append(bar);
    const compute = () => {
      let list = libraryTracks(libState.filter);
      if (libState.q) {
        const terms = libState.q.toLowerCase().split(/\s+/);
        list = list.filter((t) => { const s = `${t.title} ${t.artist} ${t.album}`.toLowerCase(); return terms.every((w) => s.includes(w)); });
      }
      return sortTracks(list, libState.sort);
    };
    const update = () => {
      const list = compute();
      status.textContent = `${songs(list.length)} · ${fmtTotal(totalDur(list))}`;
      tl.update(list);
    };
    filterInput.addEventListener('input', debounce(() => { libState.q = filterInput.value.trim(); update(); }, 150));
    const list = compute();
    status.textContent = `${songs(list.length)} · ${fmtTotal(totalDur(list))}`;
    tl = TrackList({
      tracks: list, context: { type: 'library' },
      empty: 'Brak utworów. Dodaj folder z muzyką lub pobierz coś z YouTube.',
      onRemove: { label: 'Usuń z biblioteki', fn: async (tracks) => {
        for (const t of tracks) {
          if (t.source === 'local' && !S.settings.library.folders.some((f) => t.path.startsWith(f))) await window.jm.lib.remove(t.path);
          else if (S.data.downloads[t.id]) await deleteDownload(t);
        }
        await rescan(false);
      } },
    });
    body.append(tl.el);
    function fabSmall() {
      return h('button.play-fab', { title: 'Odtwórz losowo', html: icon('shuffle'), style: { width: '44px', height: '44px' }, on: { click: () => playAll(compute(), { type: 'library' }, true) } });
    }
  };

  const drawGroups = (kind) => {
    const groups = new Map();
    for (const t of libraryTracks('all')) {
      const key = kind === 'albums' ? (t.album || '') : (t.artist || '').split(',')[0].trim();
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, { key, tracks: [], artist: t.artist });
      groups.get(key).tracks.push(t);
    }
    const arr = [...groups.values()].sort((a, b) => a.key.localeCompare(b.key, 'pl'));
    status.textContent = `${arr.length} ${kind === 'albums' ? 'albumów' : 'wykonawców'}`;
    const grid = h('div.grid');
    for (const g of arr) {
      const card = h('div.card', { on: { click: () => navigate('collection', { type: kind === 'albums' ? 'album' : 'artist', key: g.key }) } });
      card.append(kind === 'albums' ? cover(g.tracks[0].thumb, '', 'disc') : mosaic(g.tracks.map((t) => t.thumb)),
        h('div.title', { text: g.key }), h('div.sub', { text: kind === 'albums' ? `${g.artist || ''} · ${g.tracks.length}` : songs(g.tracks.length) }),
        fab((e) => { e.stopPropagation(); playAll(sortTracks(g.tracks, 'album'), null); }));
      if (kind === 'artists') card.querySelector('.cover').classList.add('track-cover');
      grid.append(card);
    }
    if (!arr.length) body.append(h('div.empty', { html: `${icon('disc')}<p>Brak danych – dodaj folder z muzyką.</p>` }));
    body.append(h('div.view-pad', { style: { paddingTop: '8px' } }, grid));
  };

  if (libState.tab === 'tracks') drawTracks(); else drawGroups(libState.tab);

  const offs = [on('library', () => refresh()), on('downloaded', () => libState.tab === 'tracks' && tl && tl.update(sortTracks(libraryTracks(libState.filter), libState.sort)))];
  const offProg = window.jm.lib.onProgress((p) => { status.textContent = `Skanowanie… ${p.done}/${p.total}`; });
  return () => { tl?.destroy(); offs.forEach((f) => f()); offProg(); };
});

registerView('collection', (root, param) => {
  const all = libraryTracks('all');
  const tracks = sortTracks(all.filter((t) => (param.type === 'album' ? t.album === param.key : (t.artist || '').split(',')[0].trim() === param.key)), 'album');
  root.append(headBlock({
    eyebrow: param.type === 'album' ? 'Album' : 'Wykonawca',
    title: param.key,
    meta: `<b>${esc(param.type === 'album' ? tracks[0]?.artist || '' : '')}</b> ${songs(tracks.length)} · ${fmtTotal(totalDur(tracks))}`,
    coverEl: param.type === 'album' ? cover(tracks[0]?.thumb, '', 'disc') : mosaic(tracks.map((t) => t.thumb)),
  }));
  root.append(h('div.actions', null, fab(() => playAll(tracks, null)),
    btn('Losowo', { icon: 'shuffle', onClick: () => playAll(tracks, null, true) }),
    btn('Zapisz jako playlistę', { icon: 'listPlus', onClick: () => createPlaylist({ name: param.key, tracks, open: true }) }),
    btn(`Szukaj „${param.key}” na YouTube`, { icon: 'search', cls: 'ghost', onClick: () => navigate('search', { q: param.key }) })));
  const tl = TrackList({ tracks, showAlbum: param.type !== 'album' });
  root.append(tl.el);
  return () => tl.destroy();
});

// ======================= POLUBIONE =======================
registerView('liked', (root) => {
  const tracks = () => tracksOf(S.data.liked);
  const list = tracks();
  const c = h('div.cover', { html: icon('heartFill'), style: { background: 'linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 30%, #ff4fa0))', color: 'var(--accent-text)' } });
  const meta = h('span');
  root.append(headBlock({ eyebrow: 'Kolekcja', title: 'Polubione utwory', meta: '', coverEl: c }));
  root.querySelector('.view-head .meta').append(meta);
  const setMeta = (l) => (meta.innerHTML = `${songs(l.length)} · ${fmtTotal(totalDur(l))}`);
  setMeta(list);
  root.append(h('div.actions', null, fab(() => playAll(tracks(), { type: 'liked' })),
    btn('Losowo', { icon: 'shuffle', onClick: () => playAll(tracks(), { type: 'liked' }, true) }),
    btn('Pobierz wszystko', { icon: 'download', onClick: () => downloadTracks(tracks()) }),
    btn('Zapisz jako playlistę', { icon: 'listPlus', cls: 'ghost', onClick: () => createPlaylist({ name: 'Polubione', tracks: tracks(), open: true }) })));
  const tl = TrackList({ tracks: list, context: { type: 'liked' }, empty: 'Kliknij ♡ przy utworze, aby go tu dodać.' });
  root.append(tl.el);
  const off = on('liked', () => { const l = tracks(); setMeta(l); tl.update(l); });
  return () => { tl.destroy(); off(); };
});

// ======================= PLAYLISTA =======================
registerView('playlist', (root, id) => {
  const pl = getPlaylist(id);
  if (!pl) {
    root.append(h('div.empty', { html: `${icon('listMusic')}<h3>Nie znaleziono playlisty</h3>` }));
    return;
  }
  const tracks = () => tracksOf(pl.trackIds);
  const list = tracks();
  const thumbs = list.slice(0, 12).map((t) => t.thumb);
  const c = mosaic(thumbs);
  if (!thumbs.some(Boolean)) {
    c.style.background = `linear-gradient(135deg, ${pl.color}, color-mix(in srgb, ${pl.color} 30%, #000))`;
  }
  const head = headBlock({
    eyebrow: 'Playlista', title: pl.name, color: pl.color, coverEl: c, editable: true, onTitle: () => renamePlaylist(pl.id),
    meta: `${pl.desc ? `<span>${esc(pl.desc)}</span><br>` : ''}<b>${songs(list.length)}</b> · ${fmtTotal(totalDur(list))} · utworzono ${new Date(pl.created).toLocaleDateString('pl-PL')}`,
  });
  root.append(head);
  const bmBtn = iconBtn(findBookmark('playlist', pl.id) ? 'bookmarkFill' : 'bookmark', 'Zakładka', () => {
    bmBtn.innerHTML = icon(toggleBookmark('playlist', pl.id) ? 'bookmarkFill' : 'bookmark');
  });
  const moreBtn = iconBtn('more', 'Więcej', () => menuAt(moreBtn, [
    { label: 'Zmień nazwę', icon: 'edit', onClick: () => renamePlaylist(pl.id) },
    { label: 'Edytuj opis', icon: 'edit', onClick: () => editDescription(pl.id) },
    { label: 'Kolor okładki', icon: 'palette', submenu: ['#7c5cff', '#ff4fd8', '#38bdf8', '#4ade80', '#ff7a45', '#facc15', '#ff3d5e', '#14b8a6', '#94a3b8'].map((col) => ({
      label: col, icon: 'disc', onClick: () => { pl.color = col; saveData(); emit('playlists'); refresh(); },
    })) },
    { label: 'Duplikuj', icon: 'copy', onClick: () => duplicatePlaylist(pl.id) },
    { label: 'Dodaj wszystko do innej playlisty', icon: 'listPlus', submenu: playlistSubmenu(tracks()) },
    { label: 'Eksportuj (M3U)', icon: 'upload', onClick: () => exportPlaylist(pl.name, tracks()) },
    { label: 'Usuń duplikaty', icon: 'check', onClick: () => { const n = pl.trackIds.length; pl.trackIds = [...new Set(pl.trackIds)]; saveData(); toast(`Usunięto ${n - pl.trackIds.length} duplikatów`); refresh(); } },
    { sep: true },
    { label: 'Usuń playlistę', icon: 'trash', danger: true, onClick: () => deletePlaylist(pl.id) },
  ]));
  const filterInput = h('input.input.filter-input', { placeholder: 'Szukaj w playliście…' });
  root.append(h('div.actions', null,
    fab(() => playAll(tracks(), { type: 'playlist', id: pl.id, name: pl.name })),
    btn('Losowo', { icon: 'shuffle', onClick: () => playAll(tracks(), { type: 'playlist', id: pl.id }, true) }),
    btn('Pobierz', { icon: 'download', onClick: () => downloadTracks(tracks()) }),
    bmBtn, moreBtn, h('div.grow'), filterInput));
  const tl = TrackList({
    tracks: list, playlistId: pl.id, context: { type: 'playlist', id: pl.id, name: pl.name },
    empty: 'Playlista jest pusta. Przeciągnij tu utwory, użyj menu „Dodaj do playlisty” albo wyszukaj coś poniżej.',
  });
  root.append(tl.el);

  // szybkie dodawanie: wyszukiwarka wewnątrz playlisty
  const addBox = h('div.view-pad', { style: { paddingTop: '8px' } });
  const addInput = h('input.input', { placeholder: 'Szybko dodaj: wpisz tytuł i naciśnij Enter…', style: { width: '100%', maxWidth: '520px' } });
  const addResults = h('div');
  addBox.append(h('div.section-head', { html: '<h2>Dodaj utwory</h2>' }), addInput, addResults);
  root.append(addBox);
  let addTl = null;
  addInput.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || !addInput.value.trim()) return;
    addResults.replaceChildren(h('div.spinner-row', null, spinner(), 'Szukam…'));
    try {
      const res = await window.jm.yt.search(addInput.value.trim(), 10);
      addResults.replaceChildren();
      const listEl = h('div.bm-list', { style: { marginTop: '10px' } });
      for (const t of res) {
        const row = h('div.bm');
        row.append(cover(t.thumb, 'track-cover'), h('div.txt', { html: `<div class="t">${esc(t.title)}</div><div class="s">${esc(t.artist)} · ${fmtTime(t.duration)}</div>` }));
        const add = btn('Dodaj', { icon: 'plus', cls: 'sm', onClick: (ev) => { ev.stopPropagation(); import('./actions.js').then((a) => a.addToPlaylist(pl.id, [t])); add.disabled = true; } });
        row.append(add);
        row.addEventListener('dblclick', () => player.playTrack(t));
        listEl.append(row);
      }
      addResults.append(listEl);
    } catch (err) {
      addResults.replaceChildren(errorBox(err));
    }
  });

  filterInput.addEventListener('input', debounce(() => {
    const q = filterInput.value.trim().toLowerCase();
    const all = tracks();
    tl.update(q ? all.filter((t) => `${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(q)) : all);
  }, 120));

  const off = on('playlist:' + pl.id, () => {
    if (!getPlaylist(pl.id)) return;
    const l = tracks();
    tl.update(l);
    head.querySelector('h1').textContent = pl.name;
    head.querySelector('.meta').innerHTML = `${pl.desc ? `<span>${esc(pl.desc)}</span><br>` : ''}<b>${songs(l.length)}</b> · ${fmtTotal(totalDur(l))}`;
  });
  return () => { tl.destroy(); addTl?.destroy(); off(); };
});

// ======================= ZAKŁADKI =======================
function bookmarkRow(b) {
  const row = h('div.bm');
  let title = '', sub = '', act = null, thumb = null, ic = 'bookmark', badge = '';
  if (b.type === 'moment' || b.type === 'track') {
    const t = getTrack(b.ref);
    if (!t) return h('div');
    title = t.title;
    sub = `${t.artist || ''}${b.note ? ' · ' + b.note : ''}`;
    thumb = t.thumb;
    if (b.type === 'moment') badge = fmtTime(b.time);
    act = () => (b.type === 'moment' ? playMoment(b) : player.playTracks([t], 0));
  } else if (b.type === 'playlist') {
    const p = getPlaylist(b.ref);
    if (!p) return h('div');
    title = p.name; sub = `Playlista · ${songs(p.trackIds.length)}`; ic = 'listMusic';
    act = () => navigate('playlist', p.id);
  } else if (b.type === 'search') {
    title = b.ref; sub = 'Zapisane wyszukiwanie'; ic = 'search';
    act = () => navigate('search', { q: b.ref });
  } else if (b.type === 'link') {
    title = b.title || b.ref; sub = b.ref; ic = 'link';
    act = () => navigate('import', { url: b.ref });
  }
  row.append(thumb ? cover(thumb, 'track-cover') : h('div.ic', { html: icon(ic) }));
  row.append(h('div.txt', { html: `<div class="t">${esc(title)}</div><div class="s">${esc(sub)} · ${timeAgo(b.at)}</div>` }));
  if (badge) row.append(h('span.time', { text: badge }));
  if (b.type === 'moment') {
    row.append(iconBtn('edit', 'Edytuj notatkę', async (e) => {
      e.stopPropagation();
      const { promptDialog } = await import('./ui.js');
      const note = await promptDialog({ title: 'Notatka', value: b.note || '' });
      if (note === null) return;
      b.note = note; saveData(); emit('bookmarks');
    }, 'sm'));
  }
  row.append(iconBtn('trash', 'Usuń', (e) => { e.stopPropagation(); removeBookmark(b.id); }, 'sm'));
  row.addEventListener('click', act);
  return row;
}

registerView('bookmarks', (root) => {
  const pad = h('div.view-pad');
  root.append(pad);
  let filter = 'all';
  const draw = () => {
    pad.replaceChildren();
    pad.append(h('h1.page-title', { text: 'Zakładki' }), h('p.page-sub', { html: `Zapisuj momenty w utworach (<kbd class="k">Ctrl+B</kbd>), utwory, playlisty, wyszukiwania i linki.` }));
    const chips = h('div.chips', { style: { marginBottom: '16px' } });
    const defs = [['all', 'Wszystkie'], ['moment', 'Momenty'], ['track', 'Utwory'], ['playlist', 'Playlisty'], ['search', 'Wyszukiwania'], ['link', 'Linki']];
    for (const [k, l] of defs) {
      const n = k === 'all' ? S.data.bookmarks.length : S.data.bookmarks.filter((b) => b.type === k).length;
      chips.append(h('button.chip' + (filter === k ? '.on' : ''), { text: `${l}${n ? ' · ' + n : ''}`, on: { click: () => { filter = k; draw(); } } }));
    }
    pad.append(chips);
    const list = h('div.bm-list');
    const items = S.data.bookmarks.filter((b) => filter === 'all' || b.type === filter);
    for (const b of items) list.append(bookmarkRow(b));
    if (!items.length) list.append(h('div.empty', { html: `${icon('bookmark')}<h3>Brak zakładek</h3><p>Podczas słuchania naciśnij Ctrl+B lub ikonę zakładki w odtwarzaczu, aby zapisać moment utworu.</p>` }));
    pad.append(list);
  };
  draw();
  return on('bookmarks', draw);
});

// ======================= POBRANE =======================
registerView('downloads', (root) => {
  const pad = h('div.view-pad');
  root.append(pad);
  const cfg = S.settings.downloads;
  pad.append(
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
      h('h1.page-title', { text: 'Pobrane', style: { flex: '1', margin: '0' } }),
      btn('Otwórz folder', { icon: 'folder', cls: 'sm', onClick: () => window.jm.shell.open(cfg.dir) }),
      btn('Zmień folder', { icon: 'edit', cls: 'sm ghost', onClick: async () => {
        const d = await window.jm.dialog.folder('Folder na pobraną muzykę');
        if (d) { cfg.dir = d; saveSettings(); refresh(); }
      } })),
    h('p.page-sub', { html: `Zapis do: <span class="code">${esc(cfg.dir)}</span> · format: <b>${esc(cfg.format.toUpperCase())}</b>${S.ytStatus?.ffmpeg ? '' : ' <span class="muted">(bez ffmpeg: zawsze M4A)</span>'}` }),
  );
  const jobsBox = h('div');
  pad.append(jobsBox);
  const drawJobs = () => {
    const jobs = [...D.jobs.values()].sort((a, b) => b.at - a.at);
    jobsBox.replaceChildren();
    if (!jobs.length) return;
    jobsBox.append(h('div.section-head', null, h('h2', { text: 'Kolejka pobierania' }), h('button.link', { text: 'Wyczyść zakończone', on: { click: clearFinished } })));
    for (const j of jobs) {
      const st = {
        queued: 'W kolejce', starting: 'Uruchamianie…', resolving: 'Dopasowywanie…', downloading: `${(j.percent || 0).toFixed(0)}%${j.speed && j.speed !== 'NA' ? ' · ' + j.speed : ''}`,
        processing: 'Konwersja / tagi…', done: 'Gotowe', error: j.error || 'Błąd', canceled: 'Anulowano',
      }[j.status] || j.status;
      const row = h('div.dl-row');
      row.append(cover(j.track.thumb, 'track-cover'),
        h('div', { style: { minWidth: '0' }, html: `<div class="t">${esc(j.track.title)}</div><div class="a">${esc(j.track.artist || '')}</div>` }),
        h('div.progress', null, h('i', { style: { width: (j.status === 'done' ? 100 : j.percent || 0) + '%' } })),
        h('div.st' + (j.status === 'error' ? '.err' : ''), { text: st, title: j.error || '' }));
      if (['queued', 'downloading', 'starting', 'resolving'].includes(j.status)) row.append(iconBtn('x', 'Anuluj', () => cancelJob(j.id), 'sm'));
      else if (j.status === 'error' || j.status === 'canceled') row.append(iconBtn('refresh', 'Ponów', () => retryJob(j.id), 'sm'));
      else if (j.file) row.append(iconBtn('folder', 'Pokaż w folderze', () => window.jm.shell.show(j.file), 'sm'));
      else row.append(h('span'));
      jobsBox.append(row);
    }
  };
  drawJobs();
  const doneHead = h('div.section-head', { style: { marginTop: '28px' } });
  pad.append(doneHead);
  const list = () => Object.keys(S.data.downloads).map((id) => getTrack(id)).filter(Boolean).reverse();
  const tl = TrackList({
    tracks: list(), empty: 'Nic jeszcze nie pobrano. Kliknij ⋯ przy utworze → Pobierz.',
    onRemove: { label: 'Usuń plik z dysku', fn: (tracks) => tracks.forEach(deleteDownload) },
  });
  const drawHead = () => { doneHead.innerHTML = `<h2>Pobrane utwory</h2><span class="muted">${Object.keys(S.data.downloads).length}</span>`; };
  drawHead();
  root.append(tl.el);
  let raf = 0;
  const offs = [
    on('downloads', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(drawJobs); }),
    on('downloaded', () => { tl.update(list()); drawHead(); }),
  ];
  return () => { tl.destroy(); offs.forEach((f) => f()); };
});

// ======================= IMPORT =======================
registerView('import', (root, param) => {
  const url = param?.url?.trim();
  const tab = param?.tab || (url ? (/spotify/.test(url) ? 'spotify' : 'youtube') : 'youtube');
  const pad = h('div.view-pad');
  root.append(pad);
  pad.append(h('h1.page-title', { text: 'Import' }), h('p.page-sub', { text: 'Przenieś swoją muzykę z YouTube, YouTube Music, Spotify albo z pliku M3U.' }));
  const tabs = h('div.import-tabs');
  for (const [k, ic, label] of [['youtube', 'video', 'YouTube / YT Music'], ['spotify', 'link', 'Spotify'], ['m3u', 'file', 'Plik M3U']]) {
    tabs.append(h('button.import-tab' + (k === tab ? '.on' : ''), { html: `${icon(ic)}<span>${label}</span>`, on: { click: () => navigate('import', { tab: k }, { replace: true }) } }));
  }
  pad.append(tabs);
  const out = h('div');
  let tl = null;
  let alive = true;

  if (tab === 'm3u') {
    pad.append(h('div.banner', { html: `${icon('file')}<div class="grow"><b>Import playlisty z pliku M3U / M3U8</b><br><span class="muted">Obsługuje pliki z Winampa, VLC, foobar2000, AIMP i innych. Lokalne pliki trafią do biblioteki, a linki YouTube do playlisty.</span></div>` }),
      btn('Wybierz plik M3U', { primary: true, icon: 'upload', onClick: importM3U }));
    return;
  }

  const isYt = tab === 'youtube';
  const input = h(isYt ? 'textarea.input' : 'input.input', {
    placeholder: isYt
      ? 'https://www.youtube.com/playlist?list=…\nhttps://music.youtube.com/playlist?list=…\nhttps://www.youtube.com/@kanał\n(kilka linków = kilka playlist, jeden w linii)'
      : 'https://open.spotify.com/playlist/…  ·  /album/…  ·  /track/…  ·  /artist/…',
    style: { flex: '1', ...(isYt ? { fontFamily: 'inherit', fontSize: '14px', minHeight: '96px' } : {}) },
    rows: isYt ? 4 : undefined,
  });
  input.value = url || '';
  const normalize = (u) => {
    u = u.trim();
    if (/^@[\w.-]+$/.test(u)) return `https://www.youtube.com/${u}/videos`;
    if (/youtube\.com\/@[\w.-]+\/?$/.test(u)) return u.replace(/\/?$/, '/videos');
    return u;
  };
  const go = async () => {
    const links = input.value.split(/\s*\n\s*/).map(normalize).filter(Boolean);
    if (!links.length) return;
    if (links.length === 1) return navigate('import', { url: links[0], tab }, { replace: true });
    // import wielu playlist naraz
    out.replaceChildren(h('div.view-pad', { style: { paddingTop: '0' } }, h('div.spinner-row', null, spinner(), h('span', { text: `Importowanie 0/${links.length}…` }))));
    let ok = 0;
    for (const [i, l] of links.entries()) {
      try {
        const res = await window.jm.yt.fromUrl(l);
        if (res.tracks.length) { await createPlaylist({ name: res.name, tracks: res.tracks, silent: true }); ok++; }
      } catch (e) { toast(`${l}: ${e.message}`, { error: true }); }
      if (!alive) return;
      out.querySelector('.spinner-row span').textContent = `Importowanie ${i + 1}/${links.length}…`;
    }
    out.replaceChildren(h('div.view-pad', { style: { paddingTop: '0' } }, h('div.banner', { html: `${icon('check')}<div class="grow"><b>Zaimportowano ${ok} z ${links.length} playlist</b><br><span class="muted">Znajdziesz je w menu po lewej.</span></div>` })));
  };
  if (!isYt) input.addEventListener('keydown', (e) => e.key === 'Enter' && go());
  else input.addEventListener('keydown', (e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && go());
  pad.append(h('div', { style: { display: 'flex', gap: '10px', marginBottom: '10px', alignItems: 'flex-start' } }, input,
    btn('Wczytaj', { primary: true, icon: 'link', onClick: go })));

  if (isYt) {
    // szybki import z konta (wymaga cookies przeglądarki, w której jesteś zalogowany)
    const y = S.settings.youtube;
    const cookieSel = select([['', 'Wybierz przeglądarkę…'], ['firefox', 'Firefox'], ['chrome', 'Chrome'], ['chromium', 'Chromium'], ['brave', 'Brave'], ['edge', 'Edge'], ['opera', 'Opera'], ['vivaldi', 'Vivaldi'], ['safari', 'Safari']], y.cookiesBrowser, (v) => {
      y.cookiesBrowser = v; saveSettings(); window.jm.yt.config(y);
    });
    const quick = (label, ic, link) => btn(label, { icon: ic, cls: 'sm', onClick: () => {
      if (!y.cookiesBrowser) return toast('Najpierw wybierz przeglądarkę, w której jesteś zalogowany do YouTube', { error: true });
      navigate('import', { url: link, tab }, { replace: true });
    } });
    pad.append(h('div.group', { style: { marginTop: '6px' } },
      h('div.setting', null,
        h('div.lbl', { html: '<b>Z Twojego konta YouTube</b><small>JustMusic użyje sesji z przeglądarki (cookies) – nie podajesz hasła. Działa tylko lokalnie, przez yt-dlp.</small>' }),
        h('div.ctl', null, cookieSel)),
      h('div.setting', null, h('div.quick-links', { style: { margin: '0' } },
        quick('Polubione filmy', 'heart', 'https://www.youtube.com/playlist?list=LL'),
        quick('Polubione w YT Music', 'music', 'https://music.youtube.com/playlist?list=LM'),
        quick('Do obejrzenia później', 'clock', 'https://www.youtube.com/playlist?list=WL'))),
    ));
  }
  root.append(out);

  if (!url) {
    if (!isYt) {
      out.append(h('div.view-pad', { style: { paddingTop: '0' } }, h('div.banner', { html: `${icon('info')}<div class="grow"><b>Jak działa Spotify w JustMusic?</b><br><span class="muted">Pobieramy listę utworów (tytuł, wykonawca, długość) i automatycznie dopasowujemy każdy utwór do nagrania na YouTube – bez konta Premium. Bez kluczy API działa do ~50 utworów na playlistę; dla dłuższych dodaj darmowe klucze w Ustawieniach → Spotify.</span></div>` })));
    }
    setTimeout(() => input.focus(), 30);
    return () => { alive = false; };
  }

  out.append(h('div.spinner-row', { style: { padding: '24px 28px' } }, spinner(), 'Wczytywanie…'));
  const isSpotify = /spotify/.test(url);
  const p = isSpotify ? window.jm.spotify.fetch(url, S.settings.spotify) : window.jm.yt.fromUrl(url);
  p.then((res) => {
    if (!alive) return;
    out.replaceChildren();
    res.tracks.forEach((t) => (t.album = t.album || ''));
    const head = headBlock({
      eyebrow: `${isSpotify ? 'Spotify' : 'YouTube'} · ${{ playlist: 'Playlista', album: 'Album', track: 'Utwór', artist: 'Wykonawca' }[res.kind] || ''}`,
      title: res.name, coverEl: cover(res.cover, '', 'listMusic'),
      meta: `${res.author ? `<b>${esc(res.author)}</b> · ` : ''}${songs(res.tracks.length)} · ${fmtTotal(totalDur(res.tracks))}${res.limited ? ' · <span title="Dodaj klucze Spotify API w ustawieniach, by wczytać wszystkie">(może być niepełna)</span>' : ''}`,
    });
    out.append(head);
    const bm = findBookmark('link', url);
    const bmBtn = iconBtn(bm ? 'bookmarkFill' : 'bookmark', 'Zapisz link w zakładkach', () => {
      bmBtn.innerHTML = icon(toggleBookmark('link', url, { title: res.name }) ? 'bookmarkFill' : 'bookmark');
    });
    out.append(h('div.actions', null,
      fab(() => playAll(res.tracks, { type: 'import', url })),
      btn('Zapisz jako playlistę', { primary: false, icon: 'listPlus', onClick: () => createPlaylist({ name: res.name, tracks: res.tracks, open: true }) }),
      btn('Pobierz wszystko', { icon: 'download', onClick: () => downloadTracks(res.tracks) }),
      bmBtn));
    tl = TrackList({ tracks: res.tracks });
    out.append(tl.el);
  }).catch((e) => {
    if (!alive) return;
    out.replaceChildren(errorBox(e));
  });
  return () => { alive = false; tl?.destroy(); };
});
