// Plugin „WhatIsThatSong?” – widżety na pulpicie z tym, co teraz gra.
// Każdy widżet to osobne, przezroczyste okno zawsze na wierzchu. Wygląd, elementy
// i położenie ustawia się w edytorze z podglądem na żywo.
import { defaultWidget, normalize, normalizePopup, LAYOUTS, FONTS, ELEMENTS, PRESETS, ANIMS } from './defaults.js';

const PAGE = 'widget.html';
const ANCHORS = [
  ['top-left', 'Lewy górny róg'], ['top', 'Góra, środek'], ['top-right', 'Prawy górny róg'],
  ['left', 'Lewa krawędź'], ['center', 'Środek ekranu'], ['right', 'Prawa krawędź'],
  ['bottom-left', 'Lewy dolny róg'], ['bottom', 'Dół, środek'], ['bottom-right', 'Prawy dolny róg'],
];
// kotwica → nazwa używana przez proces główny („góra” = top-center itd.)
const anchorKey = (a) => ({ top: 'top-center', bottom: 'bottom-center', left: 'center-left', right: 'center-right' }[a] || a);
const anchorUi = (a) => ({ 'top-center': 'top', 'bottom-center': 'bottom', 'center-left': 'left', 'center-right': 'right' }[a] || a);

export default async function activate(api) {
  const { h, icon } = api;
  if (!api.widgets) {
    api.ui.toast('WhatIsThatSong? wymaga JustMusic 1.4.0 – zaktualizuj aplikację (Ustawienia → O aplikacji).', { error: true, duration: 8000 });
    return;
  }
  let list = (api.storage.get('widgets', null) || [defaultWidget(1)]).map((w, i) => normalize(w, i + 1));
  let hidden = api.storage.get('hidden', false);
  let caps = { onTop: true, position: true, displays: [], backend: '' };
  try { caps = await api.widgets.caps(); } catch {}

  const handles = new Map(); // id widżetu -> uchwyt okna
  const opening = new Map(); // id -> Promise (żeby nie otworzyć dwa razy)
  const visibleNow = new Map();
  const previews = new Set(); // { win: contentWindow, id }
  let saveTimer = null;
  const save = (now) => {
    clearTimeout(saveTimer);
    if (now) api.storage.set('widgets', list);
    else saveTimer = setTimeout(() => api.storage.set('widgets', list), 300);
  };
  api.onDispose(() => { if (saveTimer) { clearTimeout(saveTimer); api.storage.set('widgets', list); } });

  // ---------- stan odtwarzacza → widżety ----------
  function theme() {
    const cs = getComputedStyle(document.documentElement);
    const v = (k) => cs.getPropertyValue('--' + k).trim();
    return { bg: v('bg'), surface: v('surface'), text: v('text'), dim: v('text-dim'), accent: v('accent'), accentText: v('accent-text'), font: getComputedStyle(document.body).fontFamily };
  }

  function nextTrack() {
    const cur = api.player.current;
    const q = api.player.queue || [];
    if (!cur || !q.length) return null;
    const i = q.findIndex((t) => t?.id === cur.id);
    const n = i >= 0 ? q[i + 1] : null;
    return n ? { title: n.title, artist: n.artist } : null;
  }

  function stateMsg() {
    const t = api.player.current;
    return {
      t: 'state',
      track: t ? { title: t.title, artist: t.artist, album: t.album, thumb: t.thumb || null } : null,
      playing: !!api.player.playing,
      time: api.player.time,
      duration: api.player.duration || 0,
      liked: !!(t && api.library.liked.some((x) => x?.id === t.id)),
      next: nextTrack(),
    };
  }
  const configMsg = (w) => ({ t: 'config', w, theme: theme() });

  function post(id, msg) {
    if (id === 'popup') popHd?.post(msg).catch(() => {});
    handles.get(id)?.post(msg).catch(() => {});
    for (const p of previews) if (p.id === id) p.send(msg);
  }

  function shouldShow(w) {
    if (!w.enabled || hidden) return false;
    const t = api.player.current;
    if (w.behavior.hideIdle && !t) return false;
    if (w.behavior.hidePaused && (!t || !api.player.playing)) return false;
    return true;
  }

  function winOpts(w) {
    return {
      page: PAGE,
      anchor: w.pos.anchor,
      marginX: Number(w.pos.marginX) || 0,
      marginY: Number(w.pos.marginY) || 0,
      display: w.pos.display || '',
      x: w.pos.x ?? undefined,
      y: w.pos.y ?? undefined,
      onTop: w.behavior.onTop,
      allDesktops: w.behavior.allDesktops,
      clickThrough: w.behavior.clickThrough,
      opacity: w.behavior.opacity / 100,
      visible: shouldShow(w),
    };
  }

  async function sync(w) {
    const want = w.enabled && !hidden;
    if (opening.has(w.id)) await opening.get(w.id);
    let hd = handles.get(w.id);
    if (!want) {
      if (hd) { handles.delete(w.id); hd.close(); }
      return;
    }
    const opts = winOpts(w);
    visibleNow.set(w.id, opts.visible);
    if (!hd) {
      const p = api.widgets.open(w.id, { ...opts, width: 360, height: 120 }).then((handle) => {
        handles.set(w.id, handle);
        handle.on((ev) => onWidgetEvent(w.id, ev));
        return handle;
      });
      opening.set(w.id, p);
      try { hd = await p; } catch (e) { api.ui.toast('Nie udało się otworzyć widżetu: ' + e.message, { error: true }); return; } finally { opening.delete(w.id); }
    } else {
      await hd.update(opts);
    }
    hd.post(configMsg(w)).catch(() => {});
    hd.post(stateMsg()).catch(() => {});
  }

  const syncAll = () => Promise.all(list.map(sync));
  // usunięte widżety
  function prune() {
    for (const [id, hd] of handles) if (!list.some((w) => w.id === id)) { handles.delete(id); hd.close(); }
  }

  function onWidgetEvent(id, ev) {
    const w = list.find((x) => x.id === id);
    if (!w) return;
    if (ev.type === 'message') handleCmd(w, ev.msg || {});
    else if (ev.type === 'moved') {
      w.pos = { ...w.pos, anchor: 'free', x: ev.x, y: ev.y };
      save();
      handles.get(id)?.update({ anchor: 'free', x: ev.x, y: ev.y });
      refreshEditor?.('pos');
    } else if (ev.type === 'closed') {
      // okno zamknięte spoza aplikacji (np. Alt+F4) – wyłączamy ten widżet
      if (handles.has(id)) {
        handles.delete(id);
        w.enabled = false;
        save(true);
        refreshEditor?.('list');
      }
    }
  }

  function handleCmd(w, m) {
    const p = api.player;
    switch (m.cmd) {
      case 'ready': post(w.id, configMsg(w)); post(w.id, stateMsg()); break;
      case 'toggle': if (p.current) p.toggle(); else api.ui.toast('Wybierz coś do odtworzenia w JustMusic'); break;
      case 'next': p.next(); break;
      case 'prev': p.prev(); break;
      case 'like': if (p.current) api.commands.run('track.like'); break;
      case 'seek': if (p.duration && Number.isFinite(m.ratio)) p.seek(Math.max(0, Math.min(1, m.ratio)) * p.duration); break;
      case 'volume': if (Number.isFinite(m.delta)) p.setVolume(Math.max(0, Math.min(1, p.volume + m.delta))); break;
    }
  }

  function broadcastState() {
    const msg = stateMsg();
    post('popup', msg);
    for (const w of list) {
      post(w.id, msg);
      const vis = shouldShow(w);
      if (handles.has(w.id) && visibleNow.get(w.id) !== vis) {
        visibleNow.set(w.id, vis);
        handles.get(w.id).update({ visible: vis });
      }
    }
  }
  let lastTimeSent = 0;
  for (const ev of ['track', 'state', 'queue', 'liked']) api.player.on(ev, () => broadcastState());
  api.player.on('time', () => {
    if (Date.now() - lastTimeSent < 1000) return;
    lastTimeSent = Date.now();
    const msg = { t: 'state', time: api.player.time, duration: api.player.duration || 0, playing: !!api.player.playing };
    for (const w of list) post(w.id, msg);
    post('popup', msg);
  });

  // kolory aplikacji (także dynamiczny akcent z okładki)
  let themeTimer = null;
  const themeChanged = () => {
    clearTimeout(themeTimer);
    themeTimer = setTimeout(() => { for (const w of [...list, pop]) if (w.style.colors !== 'custom' || w.style.font === 'app') post(w.id, configMsg(w)); }, 150);
  };
  const mo = new MutationObserver(themeChanged);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-scheme'] });
  api.onDispose(() => { mo.disconnect(); clearTimeout(themeTimer); });

  // ---------- popupy ----------
  let pop = normalizePopup(api.storage.get('popup', null));
  let popSaveTimer = null;
  const savePop = (now) => {
    clearTimeout(popSaveTimer);
    if (now) api.storage.set('popup', pop);
    else popSaveTimer = setTimeout(() => api.storage.set('popup', pop), 300);
  };
  api.onDispose(() => { if (popSaveTimer) { clearTimeout(popSaveTimer); api.storage.set('popup', pop); } });

  let popHd = null;
  let popOpening = null;
  let popReady = Promise.resolve();
  let popReadyResolve = null;
  let popShown = false;
  let popKind = null;
  const popupOn = () => pop.pop.track || pop.pop.hotkey || pop.pop.osd;
  const sideOf = (a) => (a.endsWith('left') ? 'left' : a.endsWith('right') ? 'right' : a.startsWith('bottom') ? 'bottom' : 'top');
  const popWinOpts = () => ({
    anchor: pop.pos.anchor, marginX: Number(pop.pos.marginX) || 0, marginY: Number(pop.pos.marginY) || 0,
    display: pop.pos.display || '', onTop: true, allDesktops: true, clickThrough: false, opacity: 1,
  });
  const appInBackground = () => document.hidden || !document.hasFocus();

  function popupHandle() {
    if (popHd && !popHd.closed) return Promise.resolve(popHd);
    if (!popOpening) {
      popReady = new Promise((r) => { popReadyResolve = r; });
      popOpening = api.widgets.open('popup', { page: 'popup.html', ...popWinOpts(), visible: false, width: 400, height: 130 })
        .then((hd) => { popHd = hd; popShown = false; hd.on(onPopupEvent); return hd; })
        .finally(() => { popOpening = null; });
    }
    return popOpening;
  }

  function onPopupEvent(ev) {
    if (ev.type === 'closed') { popHd = null; popShown = false; return; }
    if (ev.type !== 'message') return;
    const m = ev.msg || {};
    if (m.cmd === 'ready') {
      popHd?.post(configMsg(pop)).catch(() => {});
      popHd?.post(stateMsg()).catch(() => {});
      popReadyResolve?.();
    } else if (m.cmd === 'popupDone') {
      popShown = false;
      popKind = null;
      popHd?.update({ visible: false });
    } else handleCmd(pop, m);
  }

  async function showPopup(kind, osd) {
    let hd;
    try { hd = await popupHandle(); } catch (e) { console.warn('[whatisthatsong] popup', e); return; }
    await Promise.race([popReady, new Promise((r) => setTimeout(r, 3000))]);
    if (hd.closed) return;
    const dur = kind === 'osd' ? pop.pop.osdDur : kind === 'hotkey' ? pop.pop.hotkeyDur : pop.pop.trackDur;
    hd.post(configMsg(pop)).catch(() => {});
    if (kind !== 'osd') hd.post(stateMsg()).catch(() => {});
    hd.post({ t: 'show', kind, osd, duration: dur * 1000, anim: pop.pop.anim, from: sideOf(pop.pos.anchor) }).catch(() => {});
    popKind = kind;
    if (!popShown) { popShown = true; hd.update({ visible: true }); }
  }
  const hidePopup = () => popHd?.post({ t: 'hide' }).catch(() => {});

  // --- skrót klawiszowy ---
  let regAccel = null;
  async function applyHotkey() {
    if (regAccel) { await api.system.unregisterGlobal(regAccel).catch(() => {}); regAccel = null; }
    if (!pop.pop.hotkey || !pop.pop.accel) return true;
    const ok = await api.system.globalShortcut(pop.pop.accel, `${api.id}.popup`).catch(() => false);
    if (ok) regAccel = pop.pop.accel;
    return ok;
  }
  api.commands.register({
    id: 'popup', label: 'Popup: co teraz gra',
    run: () => { if (popShown && popKind === 'hotkey') hidePopup(); else showPopup('hotkey'); },
  });

  function changePopup(fn, { now, reopen }) {
    const before = `${pop.pop.hotkey}|${pop.pop.accel}`;
    fn(pop);
    savePop(now);
    post('popup', configMsg(pop));
    if (!popupOn()) { popHd?.close(); popHd = null; popShown = false; }
    else if (reopen) popHd?.update(popWinOpts());
    if (`${pop.pop.hotkey}|${pop.pop.accel}` !== before) {
      applyHotkey().then((ok) => { if (!ok) api.ui.toast(`Nie udało się ustawić skrótu ${pop.pop.accel} – może zajmuje go inny program.`, { error: true }); });
    }
  }

  // --- kiedy pokazywać ---
  let pendingTrack = null;
  let loading = false;
  let lastPlaying = !!api.player.playing;
  let lastTrackId = api.player.current?.id || null;
  let lastT = api.player.time;
  let lastTAt = Date.now();
  let lastVol = api.player.volume;
  let pauseTimer = null;
  const osdAllowed = (k) => pop.pop.osd && pop.pop[k] && !(pop.pop.background && !appInBackground());
  const trackLine = (t) => (t ? `${t.title || ''}${t.artist ? ' – ' + t.artist : ''}` : '');

  function checkTrack() {
    const t = api.player.current;
    if (!pendingTrack || !t || t.id !== pendingTrack || !api.player.playing) return;
    pendingTrack = null;
    lastPlaying = true;
    if (pop.pop.background && !appInBackground()) return;
    showPopup('track');
  }
  api.player.on('loading', (v) => { loading = !!v; });
  api.player.on('track', (t) => {
    if (!t || t.id === lastTrackId) return;
    lastTrackId = t.id;
    lastT = 0;
    lastTAt = Date.now();
    pendingTrack = pop.pop.track ? t.id : null;
    checkTrack();
  });
  api.player.on('state', () => {
    lastT = api.player.time;
    lastTAt = Date.now();
    if (pendingTrack) { checkTrack(); if (!pendingTrack) return; }
    clearTimeout(pauseTimer);
    const id = api.player.current?.id;
    // krótkie pauzy przy zmianie utworu / ładowaniu nie są „pauzą”
    pauseTimer = setTimeout(() => {
      const now = !!api.player.playing;
      if (now === lastPlaying || loading || api.player.current?.id !== id || !id) { lastPlaying = now; return; }
      lastPlaying = now;
      if (!osdAllowed('osdPause')) return;
      showPopup('osd', { icon: now ? 'play' : 'pause', text: now ? 'Odtwarzanie' : 'Pauza', sub: trackLine(api.player.current) });
    }, 350);
  });
  api.onDispose(() => clearTimeout(pauseTimer));
  api.player.on('volume', () => {
    const v = api.player.volume;
    if (Math.abs(v - lastVol) < 0.001) return;
    lastVol = v;
    if (!osdAllowed('osdVolume')) return;
    showPopup('osd', { icon: v <= 0 ? 'mute' : v < 0.5 ? 'volumeLow' : 'volume', text: `Głośność ${Math.round(v * 100)}%`, value: v });
  });
  api.player.on('time', () => {
    const t = api.player.time;
    const now = Date.now();
    const expected = lastT + (api.player.playing ? (now - lastTAt) / 1000 : 0);
    const jump = t - expected;
    const same = api.player.current?.id === lastTrackId;
    lastT = t;
    lastTAt = now;
    if (!same || loading || Math.abs(jump) < 2.5 || !osdAllowed('osdSeek')) return;
    const d = api.player.duration;
    showPopup('osd', { icon: jump > 0 ? 'seek' : 'back', text: `${api.fmtTime(t)} / ${api.fmtTime(d)}`, sub: trackLine(api.player.current), value: d ? t / d : undefined });
  });

  // ---------- zmiany ustawień ----------
  function change(w, fn, { now = false, reopen = true } = {}) {
    if (w === pop) { changePopup(fn, { now, reopen }); return; }
    fn(w);
    save(now);
    post(w.id, configMsg(w));
    if (reopen) sync(w);
  }

  function setHidden(v) {
    hidden = !!v;
    api.storage.set('hidden', hidden);
    syncAll();
    btn?.setActive(!hidden && list.some((w) => w.enabled));
    refreshEditor?.('list');
  }

  api.commands.register({ id: 'toggle', label: 'Widżety: pokaż / ukryj', run: () => setHidden(!hidden) });
  api.commands.register({ id: 'editor', label: 'Widżety: otwórz edytor', run: () => api.ui.openView('editor') });

  let btn = null;
  if (api.storage.get('playerButton', true)) {
    btn = api.ui.addPlayerButton({
      id: 'toggle', icon: 'monitor', title: 'Widżety na pulpicie (WhatIsThatSong?)',
      onClick: () => {
        if (!list.some((w) => w.enabled)) { api.ui.openView('editor'); return; }
        setHidden(!hidden);
        api.ui.toast(hidden ? 'Widżety ukryte' : 'Widżety widoczne');
      },
    });
    btn.setActive(!hidden && list.some((w) => w.enabled));
  }

  // ---------- edytor ----------
  let refreshEditor = null;
  let selected = list[0]?.id || null;

  api.ui.addView({
    id: 'editor',
    title: 'Widżety',
    icon: 'monitor',
    render(el) {
      const root = h('div.wits');
      el.append(root);
      let stop = false;
      let preview = null;
      let tab = 'widgets';

      const draw = () => {
        if (stop) return;
        if (preview) previews.delete(preview);
        preview = null;
        root.replaceChildren(header(), body());
      };
      refreshEditor = (what) => {
        if (what === 'pos' && root.querySelector('.wits-pos')) {
          const w = tab === 'popup' ? pop : list.find((x) => x.id === selected);
          if (w) root.querySelector('.wits-pos').replaceWith(posSection(w, tab === 'popup'));
          return;
        }
        draw();
      };

      function header() {
        const warn = !caps.onTop
          ? h('div.wits-warn', { html: `${icon('alert')}<span>Twój pulpit (Wayland bez KDE) nie pozwala aplikacjom trzymać okien zawsze na wierzchu ani ustawiać ich położenia. Widżety i popupy będą działać, ale mogą chować się pod innymi oknami.</span>` })
          : null;
        const tabs = h('div.wits-tabs', null,
          ...[['widgets', 'Widżety'], ['popup', 'Popupy']].map(([k, label]) =>
            h('button.wits-tab' + (tab === k ? '.on' : ''), { text: label, on: { click: () => { tab = k; draw(); } } })));
        return h('div.wits-head', null,
          h('div.wits-title', null,
            h('h1', { text: 'WhatIsThatSong?' }),
            h('p', { text: tab === 'popup'
              ? 'Popupy wyskakują na chwilę: przy nowym utworze, po skrócie klawiszowym oraz przy zmianie głośności, pauzie i przewijaniu.'
              : 'Widżety na pulpicie z tym, co teraz gra. Przeciągnij widżet myszką, żeby go przesunąć.' })),
          tab === 'widgets' ? h('div.wits-head-actions', null,
            h('label.wits-inline', null, h('span', { text: hidden ? 'Ukryte' : 'Widoczne' }), api.ui.switch(!hidden, (v) => setHidden(!v))),
            api.ui.button('Nowy widżet', { icon: 'plus', primary: true, onClick: addWidget })) : null,
          tabs,
          warn);
      }

      function addWidget() {
        const w = defaultWidget(list.length + 1);
        // nowy widżet w innym rogu niż poprzednie, żeby nie nachodziły na siebie
        const used = new Set(list.map((x) => x.pos.anchor));
        w.pos.anchor = ['bottom-right', 'top-right', 'bottom-left', 'top-left', 'top-center', 'bottom-center'].find((a) => !used.has(a)) || 'center';
        list.push(w);
        selected = w.id;
        save(true);
        sync(w);
        draw();
      }

      function body() {
        if (tab === 'popup') return popupBody();
        if (!list.length) {
          return h('div.empty', { html: `${icon('monitor')}<h3>Brak widżetów</h3><p>Dodaj pierwszy widżet przyciskiem „Nowy widżet”.</p>` });
        }
        if (!list.some((w) => w.id === selected)) selected = list[0].id;
        const w = list.find((x) => x.id === selected);
        return h('div.wits-body', null, sidebar(), h('div.wits-edit', null, previewBox(w), editor(w)));
      }

      function sidebar() {
        return h('div.wits-list', null, ...list.map((w) => {
          const item = h('div.wits-item' + (w.id === selected ? '.on' : ''), { on: { click: () => { selected = w.id; draw(); } } },
            h('div.wits-item-main', null,
              h('b', { text: w.name }),
              h('small', { text: `${(LAYOUTS.find(([k]) => k === w.layout) || [, ''])[1]} · ${w.pos.anchor === 'free' ? 'własne położenie' : (ANCHORS.find(([k]) => anchorKey(k) === w.pos.anchor) || [, ''])[1]}` })),
            api.ui.switch(w.enabled, (v) => { change(w, (x) => { x.enabled = v; }, { now: true }); btn?.setActive(!hidden && list.some((x) => x.enabled)); }));
          item.querySelector('.switch')?.addEventListener('click', (e) => e.stopPropagation());
          return item;
        }));
      }

      function previewBox(w, page = PAGE) {
        const frame = h('iframe.wits-frame', { src: `jm://app/plugins/${api.id}/${page}?preview=1&v=${Date.now()}`, title: 'Podgląd' });
        const stage = h('div.wits-stage', null, frame, h('span.wits-stage-label', { text: 'Podgląd na żywo' }));
        const p = {
          id: w.id,
          send: (msg) => { try { frame.contentWindow?.postMessage({ src: 'wits-host', ...msg }, '*'); } catch {} },
        };
        const onMsg = (e) => {
          if (e.source !== frame.contentWindow || e.data?.src !== 'wits') return;
          const d = e.data;
          if (d.size) { frame.style.width = d.size.w + 'px'; frame.style.height = d.size.h + 'px'; }
          else if (d.cmd === 'ready') { p.send(configMsg(w)); p.send(stateMsg()); }
          else if (d.cmd === 'popupDone') { /* podgląd się nie chowa */ }
          else if (d.cmd) handleCmd(w, d);
        };
        addEventListener('message', onMsg);
        previews.add(p);
        preview = p;
        frame.addEventListener('load', () => { p.send(configMsg(w)); p.send(stateMsg()); });
        // sprzątanie, gdy podgląd zniknie z dokumentu
        const mo2 = new MutationObserver(() => { if (!frame.isConnected) { removeEventListener('message', onMsg); previews.delete(p); mo2.disconnect(); } });
        mo2.observe(root, { childList: true, subtree: true });
        return stage;
      }

      // --- kontrolki ---
      const row = (label, hint, ...ctl) => api.ui.settingRow(label, hint, ...ctl);
      const range = (w, get, set, min, max, step, unit, opts) => {
        const r = h('input.range', { type: 'range', min, max, step });
        r.value = get(w);
        api.ui.rangeFill(r);
        const v = h('span.wits-val', { text: r.value + unit });
        r.addEventListener('input', () => { v.textContent = r.value + unit; api.ui.rangeFill(r); change(w, (x) => set(x, Number(r.value)), { reopen: !!opts?.reopen }); });
        r.addEventListener('change', () => change(w, (x) => set(x, Number(r.value)), { now: true, reopen: !!opts?.reopen }));
        return [r, v];
      };
      const color = (w, get, set) => {
        const c = h('input.wits-color', { type: 'color' });
        c.value = get(w);
        c.addEventListener('input', () => change(w, (x) => set(x, c.value), { reopen: false }));
        c.addEventListener('change', () => change(w, (x) => set(x, c.value), { now: true, reopen: false }));
        return c;
      };
      const chips = (options, value, onPick) => {
        const box = h('div.wits-chips');
        for (const [k, label] of options) {
          const b = h('button.wits-chip' + (String(k) === String(value) ? '.on' : ''), { text: label, on: { click: () => { box.querySelectorAll('.on').forEach((x) => x.classList.remove('on')); b.classList.add('on'); onPick(k); } } });
          box.append(b);
        }
        return box;
      };
      const toggle = (w, get, set, opts) => api.ui.switch(get(w), (v) => change(w, (x) => set(x, v), { now: true, reopen: opts?.reopen !== false }));
      const section = (title, cls, ...rows) => h('section.wits-sec' + (cls ? '.' + cls : ''), null, h('h3', { text: title }), ...rows.filter(Boolean));

      function editor(w) {
        const name = h('input.input.wits-name', { value: w.name, maxlength: 40, placeholder: 'Nazwa widżetu' });
        name.addEventListener('change', () => { change(w, (x) => { x.name = name.value.trim() || 'Widżet'; }, { now: true, reopen: false }); draw(); });

        return h('div.wits-form', null,
          h('div.wits-name-row', null, name,
            api.ui.button('Duplikuj', { icon: 'copy', cls: 'sm', onClick: () => {
              const c = normalize(JSON.parse(JSON.stringify(w)));
              c.id = defaultWidget().id;
              c.name = w.name + ' (kopia)';
              c.pos = { ...c.pos, anchor: w.pos.anchor === 'free' ? 'free' : w.pos.anchor, x: (w.pos.x ?? 0) + 30, y: (w.pos.y ?? 0) + 30, marginY: (Number(w.pos.marginY) || 0) + 40 };
              list.push(c); selected = c.id; save(true); sync(c); draw();
            } }),
            api.ui.button('Usuń', { icon: 'trash', cls: 'sm', onClick: async () => {
              const ok = await api.ui.confirm({ title: 'Usunąć widżet?', text: `„${w.name}” zniknie z pulpitu.`, ok: 'Usuń', danger: true });
              if (!ok) return;
              list = list.filter((x) => x.id !== w.id);
              save(true); prune(); draw();
            } })),

          ...lookSections(w),

          posSection(w),

          section('Zachowanie', null,
            row('Zawsze na wierzchu', caps.onTop ? 'Widżet jest nad innymi oknami.' : 'Niedostępne na tym pulpicie.', toggle(w, (x) => x.behavior.onTop, (x, v) => { x.behavior.onTop = v; })),
            row('Na wszystkich pulpitach', 'Widżet nie znika po przełączeniu wirtualnego pulpitu.', toggle(w, (x) => x.behavior.allDesktops, (x, v) => { x.behavior.allDesktops = v; })),
            row('Przepuszczaj kliknięcia', 'Klikasz „przez” widżet w okna pod nim (przyciski widżetu przestają działać). Wyłączysz to tutaj.', toggle(w, (x) => x.behavior.clickThrough, (x, v) => { x.behavior.clickThrough = v; })),
            row('Zablokuj położenie', 'Widżetu nie da się przypadkiem przeciągnąć.', toggle(w, (x) => x.behavior.locked, (x, v) => { x.behavior.locked = v; }, { reopen: false })),
            row('Przezroczystość okna', null, ...range(w, (x) => x.behavior.opacity, (x, v) => { x.behavior.opacity = v; }, 20, 100, 5, '%', { reopen: true })),
            row('Ukryj, gdy nic nie gra', null, toggle(w, (x) => x.behavior.hideIdle, (x, v) => { x.behavior.hideIdle = v; })),
            row('Ukryj podczas pauzy', null, toggle(w, (x) => x.behavior.hidePaused, (x, v) => { x.behavior.hidePaused = v; }))),
        );
      }

      function lookSections(w) {
        const s = w.style;
        const custom = s.colors === 'custom';
        return [
          section('Układ', null,
            chips(LAYOUTS, w.layout, (k) => change(w, (x) => { x.layout = k; }, { now: true, reopen: false }))),

          section('Gotowe style', null,
            chips(PRESETS.map((p) => [p.id, p.name]), '', (k) => {
              const p = PRESETS.find((x) => x.id === k);
              change(w, (x) => { x.style = { ...x.style, ...p.style }; }, { now: true, reopen: false });
              draw();
            })),

          section('Co pokazuje', 'wits-grid',
            ...ELEMENTS.map(([k, label]) => h('label.wits-check', null,
              (() => { const c = h('input', { type: 'checkbox' }); c.checked = !!w.show[k]; c.addEventListener('change', () => change(w, (x) => { x.show[k] = c.checked; }, { now: true, reopen: false })); return c; })(),
              h('span', { text: label })))),

          section('Kolory', null,
            row('Kolory', 'Motyw aplikacji zmienia się razem z JustMusic (także kolor z okładki).',
              chips([['app', 'Z motywu aplikacji'], ['custom', 'Własne']], s.colors, (k) => { change(w, (x) => { x.style.colors = k; }, { now: true, reopen: false }); draw(); })),
            custom && row('Tło', null, color(w, (x) => x.style.bg, (x, v) => { x.style.bg = v; })),
            custom && row('Tekst', null, color(w, (x) => x.style.text, (x, v) => { x.style.text = v; }), color(w, (x) => x.style.dim, (x, v) => { x.style.dim = v; })),
            custom && row('Akcent', 'Pasek postępu, przycisk odtwarzania, napis „Teraz gra”.', color(w, (x) => x.style.accent, (x, v) => { x.style.accent = v; })),
            row('Krycie tła', '0% = sam tekst na pulpicie.', ...range(w, (x) => x.style.bgOpacity, (x, v) => { x.style.bgOpacity = v; }, 0, 100, 1, '%')),
            row('Tło z okładki', 'Rozmyta okładka utworu pod treścią widżetu.', toggle(w, (x) => x.style.coverBg, (x, v) => { x.style.coverBg = v; }, { reopen: false }))),

          section('Styl', null,
            row('Rozmiar', null, ...range(w, (x) => x.style.scale, (x, v) => { x.style.scale = v; }, 60, 220, 5, '%')),
            row('Szerokość', null, ...range(w, (x) => x.style.width, (x, v) => { x.style.width = v; }, 180, 640, 10, ' px')),
            row('Zaokrąglenie rogów', null, ...range(w, (x) => x.style.radius, (x, v) => { x.style.radius = v; }, 0, 40, 1, ' px')),
            row('Czcionka', null, api.ui.select(Object.entries(FONTS).map(([k, [label]]) => [k, label]), s.font, (v) => change(w, (x) => { x.style.font = v; }, { now: true, reopen: false }))),
            row('Pogrubiony tytuł', null, toggle(w, (x) => x.style.bold, (x, v) => { x.style.bold = v; }, { reopen: false })),
            row('Wyrównanie tekstu', null, chips([['left', 'Do lewej'], ['center', 'Środek'], ['right', 'Do prawej']], s.align, (k) => change(w, (x) => { x.style.align = k; }, { now: true, reopen: false }))),
            row('Kształt okładki', null, chips([['rounded', 'Zaokrąglona'], ['square', 'Kwadrat'], ['circle', 'Koło'], ['vinyl', 'Płyta (kręci się)']], s.coverShape, (k) => change(w, (x) => { x.style.coverShape = k; }, { now: true, reopen: false }))),
            row('Przyciski', null, chips([['always', 'Zawsze widoczne'], ['hover', 'Po najechaniu']], s.controls, (k) => change(w, (x) => { x.style.controls = k; }, { now: true, reopen: false }))),
            row('Cień', null, toggle(w, (x) => x.style.shadow, (x, v) => { x.style.shadow = v; }, { reopen: false })),
            row('Obramowanie', null, toggle(w, (x) => x.style.border, (x, v) => { x.style.border = v; }, { reopen: false })),
            row('Cień pod tekstem', 'Czytelność na jasnej tapecie, gdy tło jest przezroczyste.', toggle(w, (x) => x.style.textShadow, (x, v) => { x.style.textShadow = v; }, { reopen: false })),
            row('Przewijanie długich tytułów', null, toggle(w, (x) => x.style.marquee, (x, v) => { x.style.marquee = v; }, { reopen: false }))),
        ];
      }

      function accelOf(e) {
        if (['Control', 'Alt', 'Shift', 'Meta', 'OS', 'AltGraph'].includes(e.key)) return null;
        const parts = [];
        if (e.ctrlKey) parts.push('Control');
        if (e.altKey) parts.push('Alt');
        if (e.shiftKey) parts.push('Shift');
        if (e.metaKey) parts.push('Super');
        const c = e.code;
        const named = { Space: 'Space', Enter: 'Enter', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Backquote: '`', Minus: '-', Equal: '=', Slash: '/', Backslash: '\\', Period: '.', Comma: ',', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Insert: 'Insert', Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown' };
        const key = c.startsWith('Key') ? c.slice(3) : c.startsWith('Digit') ? c.slice(5) : /^F\d+$/.test(c) ? c : named[c];
        if (!key) return null;
        if (!parts.length && !/^F\d+$/.test(key)) return null; // sam klawisz bez Ctrl/Alt – za łatwo o przypadek
        return [...parts, key].join('+');
      }
      const accelLabel = (a) => (a || '').replace('Control', 'Ctrl').split('+').join(' + ');

      function hotkeyInput() {
        const inp = h('input.input.wits-accel', { readonly: true, value: accelLabel(pop.pop.accel), placeholder: 'Kliknij i naciśnij skrót' });
        inp.addEventListener('focus', () => { inp.value = ''; inp.placeholder = 'Naciśnij kombinację klawiszy…'; });
        inp.addEventListener('blur', () => { inp.value = accelLabel(pop.pop.accel); inp.placeholder = 'Kliknij i naciśnij skrót'; });
        inp.addEventListener('keydown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (e.key === 'Escape') { inp.blur(); return; }
          const a = accelOf(e);
          if (!a) return;
          change(pop, (x) => { x.pop.accel = a; }, { now: true, reopen: false });
          inp.blur();
        });
        return inp;
      }

      function popupBody() {
        const w = pop;
        const check = (key, label) => h('label.wits-check', null,
          (() => { const c = h('input', { type: 'checkbox' }); c.checked = !!w.pop[key]; c.addEventListener('change', () => change(w, (x) => { x.pop[key] = c.checked; }, { now: true, reopen: false })); return c; })(),
          h('span', { text: label }));
        const t = api.player.current;
        const v = api.player.volume;
        return h('div.wits-edit.wits-popedit', null,
          previewBox(w, 'popup.html'),
          h('div.wits-form', null,
            section('Kiedy pokazywać', null,
              row('Nowy utwór', 'Gdy zaczyna grać kolejna piosenka.', toggle(w, (x) => x.pop.track, (x, val) => { x.pop.track = val; }, { reopen: false })),
              w.pop.track && row('Czas wyświetlania', null, ...range(w, (x) => x.pop.trackDur, (x, val) => { x.pop.trackDur = val; }, 2, 15, 0.5, ' s')),
              row('Skrót klawiszowy', 'Działa w każdym programie. Ponowne naciśnięcie chowa popup.', toggle(w, (x) => x.pop.hotkey, (x, val) => { x.pop.hotkey = val; }, { reopen: false })),
              w.pop.hotkey && row('Kombinacja', 'Kliknij pole i naciśnij nowy skrót (np. Ctrl + Alt + W).', hotkeyInput()),
              w.pop.hotkey && row('Czas wyświetlania', 'Najechanie myszką na popup zatrzymuje chowanie.', ...range(w, (x) => x.pop.hotkeyDur, (x, val) => { x.pop.hotkeyDur = val; }, 2, 30, 1, ' s')),
              row('Głośność, pauza i przewijanie', 'Mały wskaźnik w stylu systemowym.', toggle(w, (x) => x.pop.osd, (x, val) => { x.pop.osd = val; }, { reopen: false })),
              w.pop.osd && h('div.wits-checks', null, check('osdVolume', 'Głośność'), check('osdPause', 'Pauza / odtwarzanie'), check('osdSeek', 'Przewijanie')),
              w.pop.osd && row('Czas wyświetlania', null, ...range(w, (x) => x.pop.osdDur, (x, val) => { x.pop.osdDur = val; }, 0.8, 5, 0.2, ' s')),
              row('Tylko gdy JustMusic jest w tle', 'Nie pokazuj popupów, kiedy korzystasz z okna JustMusic (skrót działa zawsze).', toggle(w, (x) => x.pop.background, (x, val) => { x.pop.background = val; }, { reopen: false })),
              row('Wypróbuj', 'Popup pojawi się na pulpicie.', h('div.wits-chips', null,
                api.ui.button('Nowy utwór', { cls: 'sm', onClick: () => showPopup('track') }),
                api.ui.button('Głośność', { cls: 'sm', onClick: () => showPopup('osd', { icon: v < 0.5 ? 'volumeLow' : 'volume', text: `Głośność ${Math.round(v * 100)}%`, value: v }) }),
                api.ui.button('Pauza', { cls: 'sm', onClick: () => showPopup('osd', { icon: 'pause', text: 'Pauza', sub: trackLine(t) }) })))),
            section('Animacja', null,
              chips(ANIMS, w.pop.anim, (k) => change(w, (x) => { x.pop.anim = k; }, { now: true, reopen: false }))),
            ...lookSections(w),
            posSection(w, true)));
      }

      function posSection(w, isPop = false) {
        const grid = h('div.wits-anchors');
        const cur = anchorUi(w.pos.anchor);
        for (const [k, label] of ANCHORS) {
          grid.append(h('button.wits-anchor' + (cur === k ? '.on' : ''), {
            title: label, 'aria-label': label,
            on: { click: () => { change(w, (x) => { x.pos = { ...x.pos, anchor: anchorKey(k) }; }, { now: true }); refreshEditor('pos'); } },
          }, h('i')));
        }
        const free = w.pos.anchor === 'free';
        const displays = caps.displays || [];
        return section('Położenie', 'wits-pos',
          h('div.wits-pos-row', null, grid,
            h('div.wits-pos-info', null,
              h('b', { text: free ? 'Własne położenie' : (ANCHORS.find(([k]) => k === cur) || [, ''])[1] }),
              h('small', { text: isPop ? 'Tu będą wyskakiwać popupy.' : free ? 'Ustawione przez przeciągnięcie widżetu. Kliknij punkt na siatce, żeby przypiąć go do krawędzi ekranu.' : (caps.position ? 'Możesz też po prostu przeciągnąć widżet myszką.' : 'Na tym pulpicie system sam ustawia okna.') }))),
          !free && row('Odstęp od krawędzi', null,
            ...range(w, (x) => Number(x.pos.marginX) || 0, (x, v) => { x.pos = { ...x.pos, marginX: v }; }, 0, 400, 2, ' px', { reopen: true })),
          !free && row('Odstęp pionowy', null,
            ...range(w, (x) => Number(x.pos.marginY) || 0, (x, v) => { x.pos = { ...x.pos, marginY: v }; }, 0, 400, 2, ' px', { reopen: true })),
          displays.length > 1 && !free && row('Ekran', null, api.ui.select([['', 'Główny'], ...displays.map((d) => [d.id, `${d.label}${d.primary ? ' (główny)' : ''} – ${d.workArea.width}×${d.workArea.height}`])], w.pos.display, (v) => change(w, (x) => { x.pos = { ...x.pos, display: v }; }, { now: true }))));
      }

      draw();
      return () => { stop = true; refreshEditor = null; if (preview) previews.delete(preview); };
    },
  });

  api.ui.addSettings((el) => {
    el.append(
      api.ui.settingRow('Edytor widżetów', 'Dodawaj widżety, zmieniaj ich wygląd i położenie.', api.ui.button('Otwórz edytor', { icon: 'monitor', cls: 'sm', onClick: () => api.ui.openView('editor') })),
      api.ui.settingRow('Pokazuj widżety', null, api.ui.switch(!hidden, (v) => setHidden(!v))),
      api.ui.settingRow('Przycisk w odtwarzaczu', 'Szybkie pokazywanie/ukrywanie widżetów. Zmiana po ponownym włączeniu pluginu.', api.ui.switch(api.storage.get('playerButton', true), (v) => api.storage.set('playerButton', v))),
    );
  });

  // pierwsze uruchomienie – pokaż edytor, żeby było wiadomo, gdzie są ustawienia
  if (!api.storage.get('welcomed', false)) {
    api.storage.set('welcomed', true);
    save(true);
    setTimeout(() => api.ui.toast('WhatIsThatSong?: widżet jest już na pulpicie. Wygląd zmienisz w menu „Widżety”.', { duration: 6000 }), 800);
  }

  await syncAll();
  if (popupOn()) {
    popupHandle().catch(() => {}); // okno popupu gotowe wcześniej = popup pojawia się od razu
    applyHotkey().then((ok) => { if (!ok && pop.pop.hotkey) console.warn('[whatisthatsong] skrót', pop.pop.accel, 'zajęty'); });
  }
  return () => { for (const hd of handles.values()) hd.close(); handles.clear(); popHd?.close(); popHd = null; };
}
