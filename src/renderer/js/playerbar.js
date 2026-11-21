// Pasek odtwarzacza, panel kolejki i popover korektora.
import { S, on, emit, isLiked, toggleLike, getTrack, saveSettings } from './state.js';
import { h, esc, iconBtn, cover, fmtTime, rangeFill, popover, contextMenu, select, switchEl, toast } from './ui.js';
import { icon } from './icons.js';
import * as player from './player.js';
import { P, EQ_FREQS, EQ_PRESETS } from './player.js';
import { navigate } from './router.js';
import { bookmarkMoment, trackMenu, createPlaylist } from './actions.js';
import { toggleQueue, makeDropTarget } from './shell.js';
import { updateDynamicAccent, setAmbient } from './theme.js';
import { downloadTracks } from './downloads.js';

export const playerButtons = new Map(); // przyciski dodane przez pluginy

const bigThumb = (t) => (t?.thumb ? t.thumb.replace('/mqdefault.jpg', '/hqdefault.jpg') : null);

export function renderPlayer() {
  const el = document.getElementById('player');
  const audio = P.audio;

  // --- lewa część: aktualny utwór ---
  const np = h('div.np');
  const likeBtn = iconBtn('heart', 'Polub (L)', () => P.current && toggleLike(P.current), 'sm');
  const drawNp = () => {
    const t = P.current;
    np.replaceChildren();
    if (!t) {
      np.append(h('div.cover', { html: icon('music'), style: { width: 'calc(var(--player-h) - 28px)', height: 'calc(var(--player-h) - 28px)' } }),
        h('div.txt', { html: '<div class="t muted">Nic nie gra</div><div class="a">Wybierz coś do posłuchania</div>' }));
      return;
    }
    const c = cover(t.thumb, 'track-cover');
    c.title = 'Pokaż kolejkę';
    c.addEventListener('click', () => toggleQueue());
    const txt = h('div.txt');
    const title = h('div.t', { text: t.title, title: t.title });
    title.addEventListener('click', () => {
      if (P.context?.type === 'playlist') navigate('playlist', P.context.id);
      else if (!S.settings.layout.queue) toggleQueue();
    });
    const artist = h('div.a', { text: t.artist || '', title: t.artist });
    artist.addEventListener('click', () => t.artist && navigate('search', { q: t.artist.split(',')[0].trim() }));
    txt.append(title, artist);
    np.append(c, txt, likeBtn);
    drawLike();
  };
  np.addEventListener('contextmenu', (e) => P.current && contextMenu(e, trackMenu([P.current])));
  const drawLike = () => {
    const liked = P.current && isLiked(P.current.id);
    likeBtn.innerHTML = icon(liked ? 'heartFill' : 'heart');
    likeBtn.classList.toggle('on', !!liked);
  };

  // --- środek: sterowanie + pasek postępu ---
  const shuffleBtn = iconBtn('shuffle', 'Losowo (S)', () => player.toggleShuffle(), 'sm');
  const prevBtn = iconBtn('prev', 'Poprzedni (Ctrl+←)', () => player.prev());
  const playBtn = h('button.main-play', { title: 'Odtwórz / Pauza (Spacja)', html: icon('play'), on: { click: () => player.toggle() } });
  const nextBtn = iconBtn('next', 'Następny (Ctrl+→)', () => player.next());
  const repeatBtn = iconBtn('repeat', 'Powtarzanie (R)', () => player.cycleRepeat(), 'sm');
  const controls = h('div.controls', null, shuffleBtn, prevBtn, playBtn, nextBtn, repeatBtn);

  const cur = h('span.time', { text: '0:00' });
  const dur = h('span.time', { text: '0:00' });
  const fill = h('div.fill');
  const buf = h('div.buf');
  const knob = h('div.knob');
  const marks = h('div.marks');
  const hoverTime = h('div.hover-time');
  const bar = h('div.bar', null, h('div.track', null, buf, fill), marks, knob, hoverTime);
  const seek = h('div.seek', null, cur, bar, dur);
  const center = h('div.center', null, controls, seek);

  let dragging = false;
  const ratioAt = (x) => {
    const r = bar.getBoundingClientRect();
    return Math.max(0, Math.min(1, (x - r.left) / r.width));
  };
  bar.addEventListener('pointerdown', (e) => {
    if (!audio.duration) return;
    dragging = true;
    bar.setPointerCapture(e.pointerId);
    setProgress(ratioAt(e.clientX));
  });
  bar.addEventListener('pointermove', (e) => {
    const ratio = ratioAt(e.clientX);
    if (audio.duration) {
      hoverTime.textContent = fmtTime(ratio * audio.duration);
      hoverTime.style.left = ratio * 100 + '%';
    }
    if (dragging) setProgress(ratio);
  });
  bar.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    player.seek(ratioAt(e.clientX) * audio.duration);
  });
  function setProgress(ratio) {
    fill.style.width = ratio * 100 + '%';
    knob.style.left = ratio * 100 + '%';
    cur.textContent = fmtTime(ratio * (audio.duration || 0));
  }
  const drawTime = () => {
    const d = audio.duration;
    const fin = Number.isFinite(d) && d > 0;
    dur.textContent = fin ? fmtTime(d) : P.current?.duration ? fmtTime(P.current.duration) : '0:00';
    if (!dragging) setProgress(fin ? audio.currentTime / d : 0);
    if (fin && audio.buffered.length) buf.style.width = (audio.buffered.end(audio.buffered.length - 1) / d) * 100 + '%';
  };
  const drawMarks = () => {
    marks.replaceChildren();
    const d = audio.duration;
    if (!P.current || !Number.isFinite(d) || !d) return;
    for (const b of S.data.bookmarks) {
      if (b.type === 'moment' && b.ref === P.current.id) {
        const i = h('i', { title: b.note || fmtTime(b.time) });
        i.style.left = (b.time / d) * 100 + '%';
        marks.append(i);
      }
    }
  };

  // --- prawa część ---
  const volBtn = iconBtn('volume', 'Wycisz (M)', () => player.toggleMute(), 'sm');
  const vol = h('input.range', { type: 'range', min: 0, max: 1, step: 0.01, title: 'Głośność (Ctrl+↑/↓)' });
  vol.addEventListener('input', () => { player.setVolume(Number(vol.value)); rangeFill(vol); });
  vol.addEventListener('wheel', (e) => { e.preventDefault(); player.setVolume(S.settings.playback.volume + (e.deltaY < 0 ? 0.05 : -0.05)); }, { passive: false });
  const drawVol = () => {
    const pb = S.settings.playback;
    vol.value = pb.muted ? 0 : pb.volume;
    rangeFill(vol);
    volBtn.innerHTML = icon(pb.muted || pb.volume === 0 ? 'mute' : pb.volume < 0.5 ? 'volumeLow' : 'volume');
  };
  const bmBtn = iconBtn('bookmarkPlus', 'Zapisz moment (Ctrl+B) · PPM: z notatką', () => bookmarkMoment(false), 'sm');
  bmBtn.addEventListener('contextmenu', (e) => { e.preventDefault(); bookmarkMoment(true); });
  const dlBtn = iconBtn('download', 'Pobierz utwór', () => P.current && downloadTracks([P.current]), 'sm');
  const eqBtn = iconBtn('sliders', 'Korektor (EQ)', () => openEq(eqBtn), 'sm');
  const bassBtn = h('button.icon-btn.sm.bass-btn', { title: 'Bas · kółko myszy: zmiana, PPM: wyłącz', 'aria-label': 'Bas', on: { click: () => popover(bassBtn, bassPanel(), { align: 'right' }) } });
  bassBtn.addEventListener('wheel', (e) => { e.preventDefault(); player.setBass((S.settings.playback.bass || 0) + (e.deltaY < 0 ? 1 : -1)); }, { passive: false });
  bassBtn.addEventListener('contextmenu', (e) => { e.preventDefault(); player.setBass(0); });
  const drawBass = () => {
    const b = S.settings.playback.bass || 0;
    bassBtn.innerHTML = icon('bass') + (b ? `<span class="bass-badge">${b > 0 ? '+' : ''}${b}</span>` : '');
    bassBtn.classList.toggle('on', b !== 0);
  };
  const queueBtn = iconBtn('queue', 'Kolejka (Q)', () => toggleQueue(), 'sm');
  const miniBtn = iconBtn('pip', 'Mini odtwarzacz', () => window.jm.mini?.toggle(), 'sm');
  const pluginSlot = h('div', { style: { display: 'contents' } });
  const right = h('div.right', null, pluginSlot, bmBtn, dlBtn, bassBtn, eqBtn, miniBtn, queueBtn, volBtn, h('div.vol', null, vol));

  el.replaceChildren(np, center, right);

  const drawState = () => {
    if (P.loading && P.current) playBtn.innerHTML = '<div class="loading-spin"></div>';
    else playBtn.innerHTML = icon(P.playing ? 'pause' : 'play');
    document.body.classList.toggle('paused', !P.playing);
  };
  const drawModes = () => {
    const pb = S.settings.playback;
    shuffleBtn.classList.toggle('on', pb.shuffle);
    repeatBtn.classList.toggle('on', pb.repeat !== 'off');
    repeatBtn.innerHTML = icon(pb.repeat === 'one' ? 'repeat1' : 'repeat');
    repeatBtn.title = pb.repeat === 'off' ? 'Powtarzanie: wyłączone' : pb.repeat === 'all' ? 'Powtarzanie: wszystko' : 'Powtarzanie: jeden utwór';
    eqBtn.classList.toggle('on', pb.eq.enabled);
    queueBtn.classList.toggle('on', S.settings.layout.queue);
  };
  const drawExtras = () => {
    const t = P.current;
    dlBtn.style.display = t && t.source !== 'local' && !S.data.downloads[t.id] ? '' : 'none';
  };
  const drawPluginButtons = () => {
    pluginSlot.replaceChildren(...[...playerButtons.values()].map((b) => b.el));
  };

  on('track', (t) => {
    drawNp(); drawTime(); drawExtras(); drawMarks();
    updateDynamicAccent(bigThumb(t));
    setAmbient(bigThumb(t));
    document.title = t ? `${t.title} · ${t.artist} — JustMusic` : 'JustMusic';
  });
  on('time', drawTime);
  on('state', drawState);
  on('loading', drawState);
  on('volume', drawVol);
  on('bass', drawBass);
  on('modes', drawModes);
  on('settings', () => { drawModes(); drawVol(); drawBass(); });
  on('queuePanel', drawModes);
  on('liked', drawLike);
  on('downloaded', drawExtras);
  on('bookmarks', drawMarks);
  on('player:buttons', drawPluginButtons);
  audio.addEventListener('loadedmetadata', drawMarks);
  audio.addEventListener('progress', drawTime);

  drawNp(); drawState(); drawModes(); drawVol(); drawBass(); drawTime(); drawExtras();
}

// ---------------- bas ----------------
const BASS_PRESETS = [[0, 'Wył.'], [4, 'Lekki'], [8, 'Mocny'], [12, 'Max']];
const fmtBass = (v) => (v > 0 ? '+' : '') + v + ' dB';

/** Suwak basu (używany w okienku basu i w korektorze) */
export function bassSlider({ compact = false } = {}) {
  const input = h('input.range.bass-range', { type: 'range', min: player.BASS_MIN, max: player.BASS_MAX, step: 1, title: 'Bas (dwuklik: 0)' });
  const val = h('span.bass-val', { text: '' });
  const draw = () => {
    const b = S.settings.playback.bass || 0;
    if (document.activeElement !== input) input.value = b;
    val.textContent = fmtBass(b);
    rangeFill(input);
  };
  input.addEventListener('input', () => { player.setBass(Number(input.value)); val.textContent = fmtBass(Number(input.value)); rangeFill(input); });
  input.addEventListener('dblclick', () => player.setBass(0));
  const off = on('bass', draw);
  draw();
  const row = h('div.bass-row' + (compact ? '.compact' : ''), null, h('span.bass-lbl', { html: icon('bass') + '<span>Bas</span>' }), input, val);
  row._dispose = off;
  return row;
}

function bassPanel() {
  const wrap = h('div.bass-panel');
  const slider = bassSlider();
  const chips = h('div.bass-chips');
  const drawChips = () => {
    const b = S.settings.playback.bass || 0;
    chips.replaceChildren(...BASS_PRESETS.map(([v, label]) => h('button.chip' + (b === v ? '.on' : ''), { text: label, on: { click: () => player.setBass(v) } })));
  };
  const off = on('bass', drawChips);
  drawChips();
  wrap.append(
    h('div.bass-head', null, h('b', { text: 'Bas' }), h('small', { text: 'Działa niezależnie od korektora' })),
    slider, chips,
    h('small.bass-hint', { text: 'Kółko myszy na ikonie zmienia bas, prawy przycisk go wyłącza.' }));
  // sprzątanie nasłuchów po zamknięciu okienka
  const mo = new MutationObserver(() => { if (!wrap.isConnected) { off(); slider._dispose?.(); mo.disconnect(); } });
  setTimeout(() => mo.observe(document.body, { childList: true, subtree: true }), 0);
  return wrap;
}

// ---------------- korektor ----------------
export function eqPanel() {
  const eq = S.settings.playback.eq;
  const wrap = h('div', { style: { width: '440px' } });
  const sliders = [];
  const presetSel = select([...Object.entries(EQ_PRESETS).map(([k, v]) => [k, v.name]), ['custom', 'Własny']], eq.preset, (v) => {
    if (v === 'custom') return;
    eq.preset = v;
    eq.gains = EQ_PRESETS[v].g.slice();
    sliders.forEach((s, i) => { s.input.value = eq.gains[i]; s.val.textContent = fmtDb(eq.gains[i]); });
    commit();
  });
  const commit = () => {
    player.applyEq();
    saveSettings();
    emit('modes');
  };
  const fmtDb = (v) => (v > 0 ? '+' : '') + v;
  const head = h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' } },
    h('b', { text: 'Korektor', style: { flex: '1', fontSize: '15px' } }),
    presetSel,
    switchEl(eq.enabled, (v) => { eq.enabled = v; commit(); }));
  const bands = h('div.eq');
  EQ_FREQS.forEach((f, i) => {
    const input = h('input', { type: 'range', min: -12, max: 12, step: 1, title: `${f} Hz` });
    input.value = eq.gains[i] || 0;
    const val = h('span.val', { text: fmtDb(eq.gains[i] || 0) });
    input.addEventListener('input', () => {
      eq.gains[i] = Number(input.value);
      val.textContent = fmtDb(eq.gains[i]);
      eq.preset = 'custom';
      presetSel.value = 'custom';
      if (!eq.enabled) { eq.enabled = true; head.querySelector('input[type=checkbox]').checked = true; }
      commit();
    });
    input.addEventListener('dblclick', () => { input.value = 0; input.dispatchEvent(new Event('input')); });
    sliders.push({ input, val });
    bands.append(h('div.band', null, val, input, h('span', { text: f >= 1000 ? f / 1000 + 'k' : String(f) })));
  });
  const pre = h('input.range', { type: 'range', min: -12, max: 6, step: 1 });
  pre.value = eq.preamp || 0;
  rangeFill(pre);
  const preVal = h('span', { text: fmtDb(eq.preamp || 0) + ' dB', style: { width: '48px', textAlign: 'right', fontSize: '12px' } });
  pre.addEventListener('input', () => { eq.preamp = Number(pre.value); preVal.textContent = fmtDb(eq.preamp) + ' dB'; rangeFill(pre); commit(); });
  const bass = bassSlider({ compact: true });
  wrap.append(head, bands, h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '10px', fontSize: '12px', color: 'var(--text-dim)' } }, h('span', { text: 'Przedwzmacniacz' }), pre, preVal), bass);
  const mo = new MutationObserver(() => { if (!wrap.isConnected) { bass._dispose?.(); mo.disconnect(); } });
  setTimeout(() => mo.observe(document.body, { childList: true, subtree: true }), 0);
  return wrap;
}

function openEq(anchor) {
  popover(anchor, eqPanel(), { align: 'right' });
}

// ---------------- panel kolejki ----------------
export function renderQueue() {
  const el = document.getElementById('queue');
  let tab = 'queue';

  const draw = () => {
    if (!S.settings.layout.queue) return;
    const headEl = h('div.q-head', null,
      h('h3', { text: tab === 'queue' ? 'Kolejka' : 'Historia' }),
      iconBtn('listPlus', 'Zapisz kolejkę jako playlistę', () => {
        if (!P.queue.length) return toast('Kolejka jest pusta');
        createPlaylist({ tracks: player.queueTracks(), name: `Kolejka ${new Date().toLocaleDateString('pl-PL')}`, open: true });
      }, 'sm'),
      iconBtn('trash', 'Wyczyść kolejkę', () => player.clearQueue(), 'sm'),
      iconBtn('x', 'Zamknij', () => toggleQueue(), 'sm'));
    const tabs = h('div.q-tabs', null,
      h('button.chip' + (tab === 'queue' ? '.on' : ''), { text: 'Kolejka', on: { click: () => { tab = 'queue'; draw(); } } }),
      h('button.chip' + (tab === 'history' ? '.on' : ''), { text: 'Historia', on: { click: () => { tab = 'history'; draw(); } } }));
    const body = h('div.scroll', { style: { flex: '1' } });

    if (tab === 'history') {
      const list = h('div.q-list');
      const seen = new Set();
      for (const hst of S.data.history) {
        if (seen.size >= 100) break;
        if (seen.has(hst.id)) continue;
        seen.add(hst.id);
        const t = getTrack(hst.id);
        if (t) list.append(qItem(t, -1));
      }
      if (!seen.size) list.append(h('div.empty', { html: `${icon('history')}<p>Historia jest pusta</p>` }));
      body.append(list);
    } else {
      const t = P.current;
      if (t) {
        const now = h('div.q-now');
        const c = cover(bigThumb(t), 'track-cover');
        now.append(c, h('div.t', { text: t.title }), h('div.a', { text: t.artist || '' }));
        body.append(now);
      }
      const upcoming = P.queue.slice(P.index + 1);
      body.append(h('div.q-label', null, h('span', { text: upcoming.length ? `Następne · ${upcoming.length}` : 'Następne' })));
      const list = h('div.q-list');
      upcoming.slice(0, 300).forEach((id, k) => {
        const tr = getTrack(id);
        if (tr) list.append(qItem(tr, P.index + 1 + k));
      });
      if (!upcoming.length) list.append(h('div.muted', { style: { padding: '8px 12px', fontSize: '13px' }, text: 'Przeciągnij tu utwory lub użyj „Dodaj do kolejki”.' }));
      if (upcoming.length > 300) list.append(h('div.muted', { style: { padding: '8px 12px', fontSize: '12px' }, text: `…i ${upcoming.length - 300} więcej` }));
      body.append(list);
      makeDropTarget(body, (tracks) => { player.enqueue(tracks); toast('Dodano do kolejki'); });
    }
    el.replaceChildren(headEl, tabs, body);
  };

  let dragIdx = -1;
  function qItem(t, i) {
    const isCur = i === P.index;
    const item = h('div.q-item' + (isCur ? '.current' : ''), { draggable: i >= 0 });
    if (i >= 0) item.append(h('span.grip', { html: icon('grip') }));
    item.append(cover(t.thumb, 'track-cover'), h('div.txt', { html: `<div class="tt">${esc(t.title)}</div><div class="aa">${esc(t.artist || '')}</div>` }));
    if (i >= 0) item.append(iconBtn('x', 'Usuń z kolejki', (e) => { e.stopPropagation(); player.removeFromQueue(i); }, 'sm'));
    item.addEventListener('dblclick', () => (i >= 0 ? player.playAt(i) : player.playTracks([t], 0)));
    item.addEventListener('click', (e) => { if (e.target.closest('button')) return; if (i < 0) player.playTracks([t], 0); else player.playAt(i); });
    item.addEventListener('contextmenu', (e) => contextMenu(e, trackMenu([t], i >= 0 ? { onRemove: { label: 'Usuń z kolejki', fn: () => player.removeFromQueue(i) } } : {})));
    if (i >= 0) {
      item.addEventListener('dragstart', (e) => { dragIdx = i; item.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t.title); });
      item.addEventListener('dragend', () => { dragIdx = -1; item.classList.remove('dragging'); });
      item.addEventListener('dragover', (e) => { if (dragIdx < 0) return; e.preventDefault(); item.classList.add('drop-before'); });
      item.addEventListener('dragleave', () => item.classList.remove('drop-before'));
      item.addEventListener('drop', (e) => {
        if (dragIdx < 0) return;
        e.preventDefault();
        e.stopPropagation();
        item.classList.remove('drop-before');
        player.moveInQueue(dragIdx, i);
        dragIdx = -1;
      });
    }
    return item;
  }

  let pending = 0;
  const schedule = () => { cancelAnimationFrame(pending); pending = requestAnimationFrame(draw); };
  ['queue', 'track', 'queuePanel', 'settings'].forEach((ev) => on(ev, schedule));
  on('track', () => { if (tab === 'history') schedule(); });
  draw();
}
