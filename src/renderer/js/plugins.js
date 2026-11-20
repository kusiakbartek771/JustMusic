// Host pluginów. Plugin = folder z manifest.json + modułem ES eksportującym
// domyślną funkcję activate(api). Może zwrócić funkcję sprzątającą.
// Aplikacja nie ma wbudowanych pluginów – instaluje się je ze sklepu (Ustawienia → Pluginy).
import { S, on, emit, saveSettings, getTrack, tracksOf } from './state.js';
import { h, esc, toast, modal, btn, iconBtn, popover, contextMenu, fmtTime, promptDialog, confirmDialog, switchEl, select, rangeFill } from './ui.js';
import { icon } from './icons.js';
import * as player from './player.js';
import { registerView, navigate, route } from './router.js';
import { pluginNav, titlebarItems } from './shell.js';
import { playerButtons } from './playerbar.js';
import { registerTrackMenuItem, createPlaylist, addToPlaylist } from './actions.js';
import { registerCommand, listCommands, runCommand, shortcutState } from './commands.js';
import { registerTheme, PRESETS, themeVars } from './theme.js';

export const plugins = { list: [], active: new Map(), settingsRenderers: new Map(), errors: new Map() };
const pluginViews = new Map(); // viewId -> { render, pluginId }

// Szyna zdarzeń między pluginami (np. GoToSleep → Discord: status AFK)
const busListeners = new Map();
const busState = new Map();
const bus = {
  emit(ev, payload) {
    busState.set(ev, payload);
    for (const fn of busListeners.get(ev) || []) { try { fn(payload); } catch (e) { console.error(e); } }
  },
  on(ev, fn) {
    if (!busListeners.has(ev)) busListeners.set(ev, new Set());
    busListeners.get(ev).add(fn);
    return () => busListeners.get(ev)?.delete(fn);
  },
  last: (ev) => busState.get(ev),
};

registerView('plugin', (root, id) => {
  const v = pluginViews.get(id);
  if (!v) {
    root.append(h('div.empty', { html: `${icon('puzzle')}<h3>Plugin wyłączony</h3><p>Włącz go w Ustawienia → Pluginy.</p>` }));
    return;
  }
  const el = h('div.plugin-view');
  root.append(el);
  try {
    return v.render(el) || null;
  } catch (e) {
    el.textContent = 'Błąd pluginu: ' + e.message;
  }
});

// Pomocnicze kontrolki dla paneli ustawień pluginów
function settingRow(label, hint, ...ctl) {
  return h('div.setting', null, h('div.lbl', { html: `<b>${esc(label)}</b>${hint ? `<small>${hint}</small>` : ''}` }), h('div.ctl', null, ...ctl));
}

function makeApi(p, disposers) {
  const track = (off) => { disposers.push(off); return off; };
  const data = () => (S.settings.plugins.data[p.id] ||= {});

  const api = {
    id: p.id,
    version: 2,
    manifest: p,
    h, icon, esc, fmtTime,
    player: {
      get current() { return player.P.current; },
      get playing() { return player.P.playing; },
      get time() { return player.P.audio.currentTime || 0; },
      get duration() { return player.P.audio.duration || player.P.current?.duration || 0; },
      get audio() { return player.P.audio; },
      get queue() { return tracksOf(player.P.queue); },
      play: (tracks, start = 0) => player.playTracks(Array.isArray(tracks) ? tracks : [tracks], start),
      enqueue: (tracks, next = false) => player.enqueue(Array.isArray(tracks) ? tracks : [tracks], next),
      toggle: () => player.toggle(),
      pause: () => player.pause(),
      resume: () => player.play(),
      next: () => player.next(),
      prev: () => player.prev(),
      seek: (t) => player.seek(t),
      setVolume: (v) => player.setVolume(v),
      get volume() { return S.settings.playback.volume; },
      /** Tymczasowy mnożnik głośności (np. ściszanie) – nie zmienia ustawienia użytkownika. */
      duck: (factor, ms = 300) => player.setDuck(p.id, factor, ms),
      /** zdarzenia: track, state, time, queue, volume, loading */
      on: (ev, fn) => track(on(ev, fn)),
    },
    audio: { getAnalyser: () => player.getAnalyser() },
    library: {
      getTrack,
      get local() { return S.local; },
      get liked() { return tracksOf(S.data.liked); },
      get history() { return S.data.history; },
      get playlists() { return S.data.playlists; },
      createPlaylist: (name, tracks) => createPlaylist({ name, tracks }),
      addToPlaylist,
      search: (q, n = 20) => window.jm.yt.search(q, n),
    },
    commands: {
      list: () => listCommands(),
      run: (id, ...args) => runCommand(id, ...args),
      register: (cmd) => track(registerCommand({ group: p.name, ...cmd, id: cmd.id.includes('.') ? cmd.id : `${p.id}.${cmd.id}` })),
      /** Włącza/wyłącza domyślne skróty klawiszowe aplikacji */
      setDefaultShortcuts: (v) => { shortcutState.defaults = !!v; if (!v) track(() => { shortcutState.defaults = true; }); },
    },
    themes: {
      add: (id, def) => track(registerTheme(id, def)),
      get current() { return S.settings.theme.preset; },
      get vars() { return themeVars(); },
      get all() { return PRESETS; },
      apply: (id) => { S.settings.theme.preset = id; S.settings.theme.custom = {}; saveSettings(); emit('settings'); },
      applyCustom: (vars) => { S.settings.theme.custom = { ...vars }; saveSettings(); emit('settings'); },
    },
    system: {
      idle: () => window.jm.system.idle(),
      globalShortcut: async (accelerator, commandId) => {
        const ok = await window.jm.system.globalRegister(accelerator, commandId);
        if (ok) track(() => window.jm.system.globalUnregister(accelerator));
        return ok;
      },
      unregisterGlobal: (accelerator) => window.jm.system.globalUnregister(accelerator),
      get platform() { return S.platform; },
    },
    discord: {
      connect: (id) => window.jm.discord.connect(id),
      disconnect: () => window.jm.discord.disconnect(),
      setActivity: (a) => window.jm.discord.activity(a),
      status: () => window.jm.discord.status(),
      voice: (opts) => window.jm.discord.voice(opts),
      forgetAuth: () => window.jm.discord.forget(),
      on: (fn) => track(window.jm.discord.onEvent(fn)),
    },
    bus: {
      emit: (ev, payload) => bus.emit(ev, payload),
      on: (ev, fn) => track(bus.on(ev, fn)),
      last: (ev) => bus.last(ev),
    },
    ui: {
      toast, modal, prompt: promptDialog, confirm: confirmDialog, popover, contextMenu,
      button: btn, iconButton: iconBtn, switch: switchEl, select, rangeFill, settingRow,
      navigate,
      addView({ id, title, icon: ic, render, sidebar = true }) {
        const vid = `${p.id}:${id}`;
        pluginViews.set(vid, { render, pluginId: p.id });
        if (sidebar) pluginNav.set(vid, { label: title, icon: ic });
        emit('plugins:nav');
        track(() => {
          pluginViews.delete(vid);
          pluginNav.delete(vid);
          emit('plugins:nav');
          if (route.name === 'plugin' && route.param === vid) navigate('home', null, { replace: true });
        });
        return vid;
      },
      openView(id) { navigate('plugin', `${p.id}:${id}`); },
      addPlayerButton({ id, icon: ic, title, onClick }) {
        const key = `${p.id}:${id}`;
        const el = iconBtn(ic || 'puzzle', title || p.name, (e) => onClick(e, el), 'sm');
        playerButtons.set(key, { el });
        emit('player:buttons');
        track(() => { playerButtons.delete(key); emit('player:buttons'); });
        return {
          el,
          setActive: (v) => el.classList.toggle('on', !!v),
          setIcon: (name) => (el.innerHTML = icon(name)),
          setTitle: (t) => (el.title = t),
        };
      },
      /** Znacznik statusu w pasku tytułu (np. „AFK”) */
      addTitlebarItem({ id, icon: ic, text, title, onClick }) {
        const key = `${p.id}:${id}`;
        const el = h('button.tb-chip', { title: title || '', on: onClick ? { click: onClick } : undefined });
        const set = ({ icon: i2 = ic, text: t2 = text, title: ti } = {}) => { el.innerHTML = `${i2 ? icon(i2) : ''}<span>${esc(t2 || '')}</span>`; if (ti !== undefined) el.title = ti; };
        set();
        titlebarItems.set(key, { el });
        emit('titlebar:items');
        const remove = () => { titlebarItems.delete(key); emit('titlebar:items'); };
        track(remove);
        return { el, set, remove, show: (v) => (el.style.display = v ? '' : 'none') };
      },
      addTrackMenuItem(item) { return track(registerTrackMenuItem(item)); },
      addStyle(css) {
        const s = h('style', { text: css, dataset: { plugin: p.id } });
        document.head.append(s);
        track(() => s.remove());
        return s;
      },
      addSettings(render) {
        plugins.settingsRenderers.set(p.id, render);
        track(() => plugins.settingsRenderers.delete(p.id));
      },
    },
    storage: {
      get: (k, def) => (k in data() ? data()[k] : def),
      set: (k, v) => { data()[k] = v; saveSettings(); },
    },
    http: {
      text: (url) => window.jm.http.get(url, 'text'),
      json: (url) => window.jm.http.get(url, 'json'),
    },
    onDispose: (fn) => track(fn),
  };
  return api;
}

async function activate(p) {
  if (plugins.active.has(p.id)) return;
  const disposers = [];
  plugins.active.set(p.id, { disposers });
  try {
    if (p.style) {
      const styleEl = h('link', { rel: 'stylesheet', href: `jm://app/plugins/${p.id}/${p.style}?v=${Date.now()}` });
      document.head.append(styleEl);
      disposers.push(() => styleEl.remove());
    }
    const mod = await import(`jm://app/plugins/${p.id}/${p.main}?v=${Date.now()}`);
    const ret = await mod.default?.(makeApi(p, disposers));
    if (typeof ret === 'function') disposers.push(ret);
    plugins.errors.delete(p.id);
  } catch (e) {
    console.error('[plugin]', p.id, e);
    for (const d of disposers.reverse()) { try { d(); } catch {} }
    plugins.active.delete(p.id);
    plugins.errors.set(p.id, e.message);
    toast(`Plugin „${p.name}” nie uruchomił się: ${e.message}`, { error: true });
  }
}

function deactivate(id) {
  const a = plugins.active.get(id);
  if (!a) return;
  for (const d of a.disposers.slice().reverse()) {
    try { d(); } catch (e) { console.error(e); }
  }
  plugins.active.delete(id);
  player.setDuck(id, 1, 0);
}

export async function loadPlugins() {
  try {
    plugins.list = await window.jm.plugins.list();
  } catch {
    plugins.list = [];
  }
  for (const p of plugins.list) {
    if (S.settings.plugins.enabled[p.id]) await activate(p);
  }
  emit('plugins');
}

export async function setPluginEnabled(id, enabled) {
  S.settings.plugins.enabled[id] = enabled;
  saveSettings();
  const p = plugins.list.find((x) => x.id === id);
  if (enabled && p) await activate(p);
  else deactivate(id);
  emit('plugins');
}

export async function reloadPlugins() {
  for (const id of [...plugins.active.keys()]) deactivate(id);
  await loadPlugins();
}

// ---------------- sklep ----------------
export async function storeCatalog() {
  return window.jm.plugins.catalog();
}

export async function installPlugin(id, { enable = true } = {}) {
  const wasActive = plugins.active.has(id);
  if (wasActive) deactivate(id);
  plugins.list = await window.jm.plugins.install(id);
  if (enable || wasActive) {
    S.settings.plugins.enabled[id] = true;
    saveSettings();
    const p = plugins.list.find((x) => x.id === id);
    if (p) await activate(p);
  }
  emit('plugins');
}

export async function uninstallPlugin(id) {
  deactivate(id);
  plugins.list = await window.jm.plugins.uninstall(id);
  delete S.settings.plugins.enabled[id];
  delete S.settings.plugins.data[id];
  saveSettings();
  emit('plugins');
}
