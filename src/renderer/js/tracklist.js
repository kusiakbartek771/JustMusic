// Lista utworów z wirtualizacją (renderuje tylko widoczne wiersze),
// zaznaczaniem wielu (Ctrl/Shift), przeciąganiem i menu kontekstowym.
import { S, on, isLiked, toggleLike, isDownloaded } from './state.js';
import { h, esc, fmtTime, cover, contextMenu } from './ui.js';
import { icon } from './icons.js';
import * as player from './player.js';
import { trackMenu, reorderPlaylist } from './actions.js';
import { navigate } from './router.js';

export const DRAG_TYPE = 'application/x-justmusic-tracks';
export let dragTracks = null; // aktualnie przeciągane utwory (w obrębie aplikacji)

function rowHeight() {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--row-h')) || 56;
}

function srcBadge(t) {
  const dl = t.source !== 'local' && isDownloaded(t.id);
  const base = t.source === 'local' ? '<span class="src loc" title="Plik lokalny">LOC</span>'
    : t.source === 'spotify' ? '<span class="src sp" title="Spotify (odtwarzane przez YouTube)">SP</span>'
      : '<span class="src yt" title="YouTube">YT</span>';
  return base + (dl ? `<span class="src dl" title="Pobrane">${icon('download')}</span>` : '');
}

/**
 * @param {object} o
 * @param {Array} o.tracks
 * @param {HTMLElement} o.scroller element przewijany (domyślnie #view)
 * @param {string} [o.playlistId] – włącza zmianę kolejności i "usuń z playlisty"
 * @param {object} [o.context] – kontekst odtwarzania
 * @param {boolean} [o.showAlbum]
 * @param {object} [o.onRemove] – { label, fn(tracks) }
 * @param {string} [o.empty] – tekst przy pustej liście
 */
export function TrackList(o) {
  let tracks = o.tracks || [];
  const scroller = o.scroller || document.getElementById('view');
  const el = h('div.tl');
  // kolumna albumu: wymuszona przez o.showAlbum lub automatycznie, gdy jakikolwiek utwór ma album
  const albumVisible = () => (o.showAlbum !== undefined ? o.showAlbum : tracks.some((t) => t.album));
  const head = h('div.tl-head', {
    html: `<span style="text-align:center">#</span><span>Tytuł</span><span class="c-album">Album</span><span style="text-align:center">Źródło</span><span style="text-align:right">${icon('clock')}</span><span></span>`,
  });
  const body = h('div.tl-body');
  const emptyEl = h('div.empty', { html: `${icon('music')}<p>${esc(o.empty || 'Brak utworów')}</p>` });
  el.append(head, body);

  let rh = rowHeight();
  const rendered = new Map(); // index -> row
  let sel = new Set();
  let anchor = -1;
  let raf = 0;

  function layout() {
    rh = rowHeight();
    el.classList.toggle('no-album', !albumVisible());
    body.style.height = tracks.length * rh + 'px';
    emptyEl.remove();
    if (!tracks.length) el.append(emptyEl);
    head.style.display = tracks.length ? '' : 'none';
    for (const r of rendered.values()) r.remove();
    rendered.clear();
    draw();
  }

  function visibleRange() {
    const sr = scroller.getBoundingClientRect();
    const br = body.getBoundingClientRect();
    const top = sr.top - br.top;
    const start = Math.max(0, Math.floor(top / rh) - 8);
    const end = Math.min(tracks.length, Math.ceil((top + sr.height) / rh) + 8);
    return [start, end];
  }

  function draw() {
    raf = 0;
    const [start, end] = visibleRange();
    for (const [i, r] of rendered) {
      if (i < start || i >= end) { r.remove(); rendered.delete(i); }
    }
    const curId = player.P.current?.id;
    const frag = document.createDocumentFragment();
    for (let i = start; i < end; i++) {
      let r = rendered.get(i);
      if (!r) {
        r = buildRow(i);
        rendered.set(i, r);
        frag.append(r);
      }
      r.classList.toggle('sel', sel.has(i));
      r.classList.toggle('current', tracks[i]?.id === curId);
    }
    body.append(frag);
  }

  function schedule() {
    if (!raf) raf = requestAnimationFrame(draw);
  }

  function buildRow(i) {
    const t = tracks[i];
    const liked = isLiked(t.id);
    const isCur = player.P.current?.id === t.id;
    const r = h('div.row', { draggable: true, dataset: { i } });
    r.style.top = i * rh + 'px';
    const idx = isCur && player.P.playing
      ? '<span class="n"><span class="eq-anim"><i></i><i></i><i></i></span></span>'
      : `<span class="n">${i + 1}</span>`;
    r.innerHTML = `
      <div class="c-idx">${idx}<button class="icon-btn sm pbtn" data-act="play" title="Odtwórz">${icon(isCur && player.P.playing ? 'pause' : 'play')}</button></div>
      <div class="c-main"></div>
      <div class="c-album" title="${esc(t.album || '')}">${esc(t.album || '')}</div>
      <div class="c-src">${srcBadge(t)}</div>
      <div class="c-dur">${t.duration ? fmtTime(t.duration) : '—'}</div>
      <div class="c-act">
        <button class="icon-btn sm ${liked ? 'on' : ''}" data-act="like" title="${liked ? 'Usuń z polubionych' : 'Polub'}">${icon(liked ? 'heartFill' : 'heart')}</button>
        <button class="icon-btn sm" data-act="more" title="Więcej">${icon('more')}</button>
      </div>`;
    const main = r.querySelector('.c-main');
    main.append(cover(t.thumb, 'track-cover'));
    main.append(h('div.txt', { html: `<div class="t-title" title="${esc(t.rawTitle || t.title)}">${esc(t.title)}</div><div class="t-artist"><span data-act="artist">${esc(t.artist || '')}</span></div>` }));
    return r;
  }

  function idxOf(e) {
    const r = e.target.closest('.row');
    return r ? Number(r.dataset.i) : -1;
  }

  function selected() {
    return [...sel].sort((a, b) => a - b).map((i) => tracks[i]).filter(Boolean);
  }

  function playFrom(i) {
    if (o.onPlay) return o.onPlay(tracks, i);
    if (player.P.current?.id === tracks[i].id && player.P.queue[player.P.index] === tracks[i].id) return player.toggle();
    player.playTracks(tracks, i, o.context || null);
  }

  body.addEventListener('click', (e) => {
    const i = idxOf(e);
    if (i < 0) return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'play') return playFrom(i);
    if (act === 'like') { toggleLike(tracks[i]); return; }
    if (act === 'more') {
      if (!sel.has(i)) { sel = new Set([i]); anchor = i; schedule(); }
      const b = e.target.closest('button').getBoundingClientRect();
      return contextMenu({ clientX: b.left - 180, clientY: b.bottom }, trackMenu(selected(), { playlistId: o.playlistId, onRemove: o.onRemove }));
    }
    if (act === 'artist' && tracks[i].artist) return navigate('artist', { name: tracks[i].artist.split(',')[0].trim() });
    if (e.shiftKey && anchor >= 0) {
      const [a, b] = [Math.min(anchor, i), Math.max(anchor, i)];
      if (!e.ctrlKey && !e.metaKey) sel = new Set();
      for (let k = a; k <= b; k++) sel.add(k);
    } else if (e.ctrlKey || e.metaKey) {
      sel.has(i) ? sel.delete(i) : sel.add(i);
      anchor = i;
    } else {
      sel = new Set([i]);
      anchor = i;
    }
    schedule();
  });

  body.addEventListener('dblclick', (e) => {
    const i = idxOf(e);
    if (i >= 0 && !e.target.closest('button')) playFrom(i);
  });

  body.addEventListener('contextmenu', (e) => {
    const i = idxOf(e);
    if (i < 0) return;
    if (!sel.has(i)) { sel = new Set([i]); anchor = i; schedule(); }
    contextMenu(e, trackMenu(selected(), { playlistId: o.playlistId, onRemove: o.onRemove }));
  });

  // ---- przeciąganie ----
  let dragFrom = null;
  body.addEventListener('dragstart', (e) => {
    const i = idxOf(e);
    if (i < 0) return;
    if (!sel.has(i)) { sel = new Set([i]); anchor = i; schedule(); }
    const list = selected();
    dragTracks = list;
    dragFrom = [...sel];
    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(list.map((t) => t.id)));
    e.dataTransfer.setData('text/plain', list.map((t) => `${t.artist} - ${t.title}`).join('\n'));
    const ghost = h('div', { style: { position: 'fixed', top: '-100px', padding: '6px 12px', background: 'var(--accent)', color: 'var(--accent-text)', borderRadius: '99px', fontWeight: '700', fontSize: '13px' } },
      list.length === 1 ? list[0].title : `${list.length} utworów`);
    document.body.append(ghost);
    e.dataTransfer.setDragImage(ghost, 10, 10);
    setTimeout(() => ghost.remove(), 0);
  });
  body.addEventListener('dragend', () => {
    dragTracks = null;
    dragFrom = null;
    body.querySelectorAll('.drop-before,.drop-after').forEach((n) => n.classList.remove('drop-before', 'drop-after'));
  });
  if (o.playlistId && o.reorderable !== false) {
    let dropAt = -1;
    body.addEventListener('dragover', (e) => {
      if (!dragFrom) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const br = body.getBoundingClientRect();
      const pos = Math.max(0, Math.min(tracks.length, Math.round((e.clientY - br.top) / rh)));
      if (pos === dropAt) return;
      dropAt = pos;
      body.querySelectorAll('.drop-before,.drop-after').forEach((n) => n.classList.remove('drop-before', 'drop-after'));
      const target = rendered.get(pos) || rendered.get(pos - 1);
      if (target) target.classList.add(rendered.get(pos) ? 'drop-before' : 'drop-after');
    });
    body.addEventListener('drop', (e) => {
      if (!dragFrom || dropAt < 0) return;
      e.preventDefault();
      const from = dragFrom;
      dragFrom = null;
      reorderPlaylist(o.playlistId, from, dropAt);
      sel = new Set();
      dropAt = -1;
    });
  }

  // ---- klawiatura (gdy fokus nie jest w polu tekstowym) ----
  const onKey = (e) => {
    if (!el.isConnected || e.target.closest('input,textarea,select') || !sel.size) return;
    if (e.key === 'Enter') { e.preventDefault(); playFrom(Math.min(...sel)); }
    else if ((e.key === 'a' || e.key === 'A') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sel = new Set(tracks.map((_, i) => i)); schedule(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      const cur = anchor >= 0 ? anchor : 0;
      const n = Math.max(0, Math.min(tracks.length - 1, cur + (e.key === 'ArrowDown' ? 1 : -1)));
      if (e.shiftKey) sel.add(n); else sel = new Set([n]);
      anchor = n;
      const top = body.offsetTop + n * rh;
      const st = scroller.scrollTop, sh = scroller.clientHeight;
      if (top < st + 40) scroller.scrollTop = top - 40;
      else if (top + rh > st + sh - 10) scroller.scrollTop = top + rh - sh + 10;
      schedule();
    } else if (e.key === 'Delete' && o.playlistId) {
      import('./actions.js').then((a) => a.removeFromPlaylist(o.playlistId, selected().map((t) => t.id)));
      sel = new Set();
    }
  };
  document.addEventListener('keydown', onKey);

  const onScroll = () => schedule();
  scroller.addEventListener('scroll', onScroll, { passive: true });
  const ro = new ResizeObserver(() => schedule());
  ro.observe(scroller);

  const refreshRows = () => {
    for (const r of rendered.values()) r.remove();
    rendered.clear();
    schedule();
  };
  const offs = [
    on('track', refreshRows),
    on('state', refreshRows),
    on('liked', refreshRows),
    on('downloaded', refreshRows),
    on('settings', () => requestAnimationFrame(layout)),
  ];

  requestAnimationFrame(layout);

  return {
    el,
    get tracks() { return tracks; },
    selected,
    update(next) {
      tracks = next;
      sel = new Set();
      anchor = -1;
      layout();
    },
    destroy() {
      scroller.removeEventListener('scroll', onScroll);
      document.removeEventListener('keydown', onKey);
      ro.disconnect();
      offs.forEach((f) => f());
      cancelAnimationFrame(raf);
    },
  };
}
