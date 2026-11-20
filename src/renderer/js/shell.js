// Pasek tytułu (nawigacja + wyszukiwarka) i panel boczny.
import { S, on, emit, getTrack, tracksOf, saveSettings, toggleLike } from './state.js';
import { h, esc, iconBtn, mosaic, contextMenu, debounce, toast } from './ui.js';
import { icon } from './icons.js';
import { navigate, goBack, goForward, canBack, canForward, route } from './router.js';
import * as player from './player.js';
import { createPlaylist, addToPlaylist, renamePlaylist, deletePlaylist, duplicatePlaylist, exportPlaylist, importM3U, playMoment, removeBookmark, toggleBookmark, findBookmark } from './actions.js';
import { DRAG_TYPE, dragTracks } from './tracklist.js';
import { downloadTracks, activeCount } from './downloads.js';
import { applyLayout, windowButtonsStyle } from './theme.js';

export const titlebarItems = new Map(); // elementy statusu dodane przez pluginy (np. AFK)

// Przyciski okna rysowane w stylu aplikacji
function windowControls(style) {
  const wrap = h('div.win-ctrls.' + style);
  const btn = (kind, title, fn) => h('button.win-btn.' + kind, { title, 'aria-label': title, html: style === 'left' ? '' : icon(kind === 'max' ? 'winMax' : kind === 'min' ? 'winMin' : 'winClose'), on: { click: fn } });
  const min = btn('min', 'Minimalizuj', () => window.jm.window.minimize());
  const max = btn('max', 'Maksymalizuj', () => window.jm.window.toggleMaximize());
  const close = btn('close', 'Zamknij', () => window.jm.window.close());
  if (style === 'left') wrap.append(close, min, max);
  else wrap.append(min, max, close);
  const setState = (st) => {
    if (!st) return;
    document.documentElement.classList.toggle('win-maximized', !!st.maximized);
    document.documentElement.classList.toggle('win-blurred', st.focused === false);
    max.title = st.maximized ? 'Przywróć' : 'Maksymalizuj';
    if (style !== 'left') max.innerHTML = icon(st.maximized ? 'winRestore' : 'winMax');
  };
  window.jm.window.state().then(setState).catch(() => {});
  window.jm.window.onState(setState);
  return wrap;
}

// ---------------- pasek tytułu ----------------
export function renderTitlebar() {
  const tb = document.getElementById('titlebar');
  const backBtn = iconBtn('chevronLeft', 'Wstecz (Alt+←)', goBack, 'sm');
  const fwdBtn = iconBtn('chevronRight', 'Dalej (Alt+→)', goForward, 'sm');
  const input = h('input', { type: 'text', placeholder: 'Szukaj utworów, wykonawców lub wklej link YouTube / Spotify…', spellcheck: false, id: 'search-input' });
  const box = h('div.searchbox', null, h('span', { html: icon('search') }), input, h('kbd', { text: S.platform === 'darwin' ? '⌘K' : 'Ctrl K' }));
  const dlBadge = h('span.badge', { style: { display: 'none' } });
  const dlBtn = iconBtn('download', 'Pobrane', () => navigate('downloads'), 'badge-btn');
  dlBtn.append(dlBadge);
  const sideBtn = iconBtn('sidebar', 'Pokaż/ukryj panel boczny', () => {
    const L = S.settings.layout;
    L.sidebarHidden = !L.sidebarHidden;
    applyLayout();
    saveSettings();
  }, 'sm');
  const queueBtn = iconBtn('queue', 'Kolejka (Q)', () => toggleQueue(), 'sm');
  const status = h('div.tb-status');
  const drawStatus = () => status.replaceChildren(...[...titlebarItems.values()].map((i) => i.el));
  on('titlebar:items', drawStatus);
  const feedbackBtn = iconBtn('message', 'Wyślij opinię / zgłoś błąd', () => import('./feedback.js').then((f) => f.openFeedback()), 'sm');
  const wbStyle = windowButtonsStyle();
  tb.replaceChildren(...[
    wbStyle === 'left' ? windowControls('left') : null,
    h('div.brand', { html: `<div class="logo">${icon('logo')}</div>JustMusic` }),
    sideBtn,
    h('div.nav-btns', null, backBtn, fwdBtn),
    box,
    h('div.spacer'),
    status,
    dlBtn,
    queueBtn,
    feedbackBtn,
    iconBtn('settings', 'Ustawienia (Ctrl+,)', () => navigate('settings'), 'sm'),
    wbStyle === 'right' ? windowControls('right') : null,
  ].filter(Boolean));
  document.documentElement.classList.toggle('mac-native', wbStyle === 'system' && S.platform === 'darwin');

  const go = debounce((q) => {
    if (!q.trim()) return;
    navigate('search', { q: q.trim() }, { replace: route.name === 'search' });
  }, 380);
  input.addEventListener('input', () => go(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { go(input.value); }
    if (e.key === 'Escape') input.blur();
  });
  input.addEventListener('focus', () => input.select());

  const upd = () => {
    backBtn.disabled = !canBack();
    fwdBtn.disabled = !canForward();
    queueBtn.classList.toggle('on', S.settings.layout.queue);
    if (route.name === 'search' && route.param?.q && document.activeElement !== input) input.value = route.param.q;
    if (route.name !== 'search' && document.activeElement !== input) input.value = '';
  };
  on('route', upd);
  on('settings', upd);
  on('queuePanel', upd);
  on('downloads', () => {
    const n = activeCount();
    dlBadge.style.display = n ? '' : 'none';
    dlBadge.textContent = n;
  });
  upd();
}

export function toggleQueue() {
  S.settings.layout.queue = !S.settings.layout.queue;
  applyLayout();
  saveSettings();
  emit('queuePanel');
}

export function focusSearch() {
  const i = document.getElementById('search-input');
  i.focus();
  i.select();
}

// ---------------- panel boczny ----------------
const NAV = [
  ['home', 'home', 'Start'],
  ['search', 'search', 'Szukaj'],
  ['library', 'library', 'Biblioteka'],
  ['liked', 'heart', 'Polubione'],
  ['bookmarks', 'bookmark', 'Zakładki'],
  ['downloads', 'download', 'Pobrane'],
  ['import', 'link', 'Import (Spotify/YT)'],
];

export const pluginNav = new Map(); // id -> { icon, label, view }

export function renderSidebar() {
  const sb = document.getElementById('sidebar');

  const draw = () => {
    const L = S.settings.layout;
    const nav = h('nav');
    for (const [name, ic, label] of NAV) {
      let count = '';
      if (name === 'liked') count = S.data.liked.length || '';
      if (name === 'bookmarks') count = S.data.bookmarks.length || '';
      const item = h('button.nav-item' + (route.name === name ? '.on' : ''), {
        title: label,
        html: `${icon(ic)}<span>${esc(label)}</span>${count ? `<span class="count">${count}</span>` : ''}`,
        on: { click: () => navigate(name, name === 'search' ? { q: '' } : null) },
      });
      if (name === 'liked') makeDropTarget(item, (tracks) => {
        tracks.forEach((t) => { if (!S.data.liked.includes(t.id)) toggleLike(t); });
        toast('Polubiono');
      });
      nav.append(item);
    }

    const parts = [nav];

    // pluginy z własnym widokiem
    if (pluginNav.size && L.sidebarSections.plugins !== false) {
      const pl = h('div.side-section', null, h('div.side-head', { html: '<h4>Pluginy</h4>' }));
      const list = h('nav', { style: { paddingTop: '0' } });
      for (const [id, p] of pluginNav) {
        list.append(h('button.nav-item' + (route.name === 'plugin' && route.param === id ? '.on' : ''), {
          title: p.label, html: `${icon(p.icon || 'puzzle')}<span>${esc(p.label)}</span>`, on: { click: () => navigate('plugin', id) },
        }));
      }
      pl.append(list);
      parts.push(pl);
    }

    // zakładki (skrót)
    if (L.sidebarSections.bookmarks && S.data.bookmarks.length) {
      const sec = h('div.side-section', null, h('div.side-head', null, h('h4', { text: 'Zakładki' })));
      const list = h('div.side-list');
      for (const b of S.data.bookmarks.slice(0, 3)) list.append(bookmarkItem(b));
      sec.append(list);
      parts.push(sec);
    }

    // playlisty
    if (L.sidebarSections.playlists) {
      const sec = h('div.side-section.grow');
      sec.append(h('div.side-head', null,
        h('h4', { text: 'Playlisty' }),
        iconBtn('upload', 'Importuj M3U', importM3U, 'sm'),
        iconBtn('plus', 'Nowa playlista (Ctrl+N)', () => createPlaylist({ open: true }), 'sm keep'),
      ));
      const list = h('div.side-list.scroll', { style: { flex: '1' } });
      if (!S.data.playlists.length) {
        list.append(h('div.muted', { style: { padding: '6px 12px', fontSize: '12px' }, text: 'Brak playlist. Kliknij +, aby utworzyć, albo przeciągnij tu utwory.' }));
        makeDropTarget(list, (tracks) => createPlaylist({ tracks, name: tracks[0].artist ? `Mix: ${tracks[0].artist}` : 'Nowa playlista' }));
      }
      for (const p of S.data.playlists) list.append(playlistItem(p));
      sec.append(list);
      parts.push(sec);
    }

    sb.replaceChildren(...parts);
  };

  function bookmarkItem(b) {
    let title = '', sub = '', thumb = null, ic = 'bookmark', act;
    if (b.type === 'moment' || b.type === 'track') {
      const t = getTrack(b.ref);
      if (!t) return h('div');
      title = t.title;
      sub = b.type === 'moment' ? `⏱ ${fmt(b.time)}${b.note ? ' · ' + b.note : ''}` : t.artist;
      thumb = t.thumb;
      act = () => (b.type === 'moment' ? playMoment(b) : player.playTracks([t], 0));
    } else if (b.type === 'playlist') {
      const p = S.data.playlists.find((x) => x.id === b.ref);
      if (!p) return h('div');
      title = p.name; sub = 'Playlista'; ic = 'listMusic';
      act = () => navigate('playlist', p.id);
    } else if (b.type === 'search') {
      title = b.ref; sub = 'Wyszukiwanie'; ic = 'search';
      act = () => navigate('search', { q: b.ref });
    } else if (b.type === 'link') {
      title = b.title || b.ref; sub = 'Link'; ic = 'link';
      act = () => navigate('import', { url: b.ref });
    }
    const el = h('div.pl-item', { title: `${title} — ${sub}`, on: { click: act, contextmenu: (e) => contextMenu(e, [{ label: 'Usuń zakładkę', icon: 'trash', danger: true, onClick: () => removeBookmark(b.id) }]) } });
    el.append(thumb ? mosaic([thumb], 'mini-cover') : h('div.cover.mini-cover', { html: icon(ic) }));
    el.append(h('div.meta', { html: `<div class="name">${esc(title)}</div><div class="sub">${esc(sub)}</div>` }));
    return el;
  }

  function playlistItem(p) {
    const playing = player.P.context?.type === 'playlist' && player.P.context.id === p.id;
    const el = h('div.pl-item' + (route.name === 'playlist' && route.param === p.id ? '.on' : '') + (playing ? '.playing' : ''), {
      title: p.name,
      on: {
        click: () => navigate('playlist', p.id),
        contextmenu: (e) => contextMenu(e, [
          { label: 'Odtwórz', icon: 'play', onClick: () => player.playTracks(tracksOf(p.trackIds), 0, { type: 'playlist', id: p.id }) },
          { label: 'Dodaj do kolejki', icon: 'queue', onClick: () => player.enqueue(tracksOf(p.trackIds)) },
          { sep: true },
          { label: 'Zmień nazwę', icon: 'edit', onClick: () => renamePlaylist(p.id) },
          { label: 'Duplikuj', icon: 'copy', onClick: () => duplicatePlaylist(p.id) },
          { label: findBookmark('playlist', p.id) ? 'Usuń z zakładek' : 'Dodaj do zakładek', icon: 'bookmark', onClick: () => toggleBookmark('playlist', p.id) },
          { label: 'Pobierz wszystko', icon: 'download', onClick: () => downloadTracks(tracksOf(p.trackIds)) },
          { label: 'Eksportuj (M3U)', icon: 'upload', onClick: () => exportPlaylist(p.name, tracksOf(p.trackIds)) },
          { sep: true },
          { label: 'Usuń playlistę', icon: 'trash', danger: true, onClick: () => deletePlaylist(p.id) },
        ]),
      },
    });
    const thumbs = p.trackIds.slice(0, 12).map((id) => getTrack(id)?.thumb);
    const c = mosaic(thumbs, 'mini-cover');
    if (!thumbs.some(Boolean)) c.style.background = `linear-gradient(135deg, ${p.color}, color-mix(in srgb, ${p.color} 40%, #000))`;
    el.append(c, h('div.meta', { html: `<div class="name">${esc(p.name)}</div><div class="sub">Playlista · ${p.trackIds.length}</div>` }));
    makeDropTarget(el, (tracks) => addToPlaylist(p.id, tracks));
    return el;
  }

  const redraw = debounce(draw, 30);
  ['route', 'playlists', 'bookmarks', 'liked', 'settings', 'plugins:nav', 'queue'].forEach((ev) => on(ev, redraw));
  draw();
}

function fmt(s) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

// Cel upuszczenia utworów przeciąganych z list
export function makeDropTarget(el, onDrop) {
  let depth = 0;
  el.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
    depth++;
    el.classList.add('drop');
  });
  el.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) el.classList.remove('drop');
  });
  el.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  el.addEventListener('drop', (e) => {
    if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
    e.preventDefault();
    e.stopPropagation();
    depth = 0;
    el.classList.remove('drop');
    const ids = JSON.parse(e.dataTransfer.getData(DRAG_TYPE) || '[]');
    const tracks = dragTracks && dragTracks.length ? dragTracks : tracksOf(ids);
    if (tracks.length) onDrop(tracks);
  });
}
